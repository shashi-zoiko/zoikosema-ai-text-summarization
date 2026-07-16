"""Policy Engine MVP — autonomy ceiling versioning + effective-autonomy resolution.

Spec §4.1: effective autonomy is the minimum of every applicable input,
computed deterministically with the resolved inputs logged. Originally
scoped to the Calendar category only; "mail" joined in Phase 3 slice 9
(mail send, L3) once that had a real mutation to govern. Mail's DLP input
was a static stub until Phase 3 slice 6 (DLP MVP) replaced it below with a
real per-call scan — see `dlp_scan_input` on `resolve_effective_autonomy`.

Inputs with a real signal today: tenant category ceiling (this module's own
versioned table), workspace policy (same table — no separate
workspace-override table exists yet, so workspace policy == tenant ceiling
until one is built), user preference (no per-user override storage yet
either, so it also equals the tenant ceiling — per spec §4 users may only
*lower*, never raise, so "no override set" correctly means "inherit the
ceiling," not "unrestricted"), and now `dlp_verdict` for mail calls that
pass `dlp_scan_input` (Phase 3 slice 6). Sensitivity class, recipient/
domain risk, MCP server ceiling, and incident brake are still stubbed as
always-pass (4 = no restriction) since none of those features exist yet to
produce a real verdict — building a real check against a nonexistent
signal source would just be guessing.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.audit import service as audit
from app.connect.dlp import service as dlp
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.policy_engine.models import CATEGORIES, PolicyVersion
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import Invalid
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext

# Conservative default when no PolicyVersion row exists yet for a tenant —
# L1 (Suggest) matches every Phase 1 feature built so far (read + L1
# suggestions only). Defaulting new tenants any higher would grant L2+
# direct-mutation rights before Action Review Queue (slice 2) exists to
# govern them.
DEFAULT_AUTONOMY_CEILING = 1
MAX_AUTONOMY_LEVEL = 4

# Stubbed inputs with no real signal source yet — always resolve to "no
# restriction" until the feature that produces a real verdict exists.
# dlp_verdict is NOT here anymore (Phase 3 slice 6 gave it a real signal,
# see resolve_effective_autonomy's dlp_scan_input handling below) — it only
# falls back to this stub value when no scan input is provided.
_UNIMPLEMENTED_INPUTS = {
    "sensitivity_class_limit": MAX_AUTONOMY_LEVEL,
    "recipient_domain_risk": MAX_AUTONOMY_LEVEL,
    "mcp_server_ceiling": MAX_AUTONOMY_LEVEL,
    "incident_brake": MAX_AUTONOMY_LEVEL,
}

# DLP verdict -> autonomy level (Phase 3 slice 6). "fail" drops effective
# autonomy to 0 (Observe) regardless of tenant ceiling — a hard leakage
# signal must not be overridable by a high configured ceiling, matching
# spec §4.1's "minimum of every input" model. "warn" caps at L2 (Prepare) —
# still stageable for human review, not a silent direct execute. "pass" is
# unrestricted, same value the old static stub always returned.
_DLP_VERDICT_LEVELS: dict[str, int] = {"pass": MAX_AUTONOMY_LEVEL, "warn": 2, "fail": 0}


@dataclass(frozen=True)
class ResolvedAutonomy:
    level: int
    inputs: dict[str, int] = field(default_factory=dict)
    # Raw DLP verdict (verdict + matched rule names, never matched
    # content), populated only when the caller passed dlp_scan_input.
    # Callers needing to hard-gate on a "fail" specifically (rather than
    # just noticing effective level dropped) read this instead of
    # re-deriving it from inputs["dlp_verdict"].
    dlp_verdict: dlp.DlpVerdict | None = None


def _validate_category(category: str) -> None:
    if category not in CATEGORIES:
        raise Invalid(f"Unknown policy category: {category}")


def _latest_version_row(db: DbSession, tenant_id: str, category: str) -> PolicyVersion | None:
    return (
        db.query(PolicyVersion)
        .filter(PolicyVersion.tenant_id == tenant_id, PolicyVersion.category == category)
        .order_by(PolicyVersion.version.desc())
        .first()
    )


def get_current_ceiling(db: DbSession, ctx: TenantContext, *, category: str) -> int:
    _validate_category(category)
    row = _latest_version_row(db, ctx.tenant_id, category)
    return row.autonomy_ceiling if row else DEFAULT_AUTONOMY_CEILING


def list_policy_history(db: DbSession, ctx: TenantContext, *, category: str) -> list[PolicyVersion]:
    _validate_category(category)
    return (
        db.query(PolicyVersion)
        .filter(PolicyVersion.tenant_id == ctx.tenant_id, PolicyVersion.category == category)
        .order_by(PolicyVersion.version.desc())
        .all()
    )


async def set_autonomy_ceiling(
    db: DbSession, ctx: TenantContext, *, category: str, autonomy_ceiling: int, diff_ref: str | None = None,
) -> PolicyVersion:
    _validate_category(category)
    if not (0 <= autonomy_ceiling <= MAX_AUTONOMY_LEVEL):
        raise Invalid(f"autonomy_ceiling must be between 0 and {MAX_AUTONOMY_LEVEL}")

    prior = _latest_version_row(db, ctx.tenant_id, category)
    next_version = (prior.version + 1) if prior else 1

    row = PolicyVersion(
        id=uuid7_str(),
        tenant_id=ctx.tenant_id,
        category=category,
        version=next_version,
        autonomy_ceiling=autonomy_ceiling,
        author_user_id=ctx.user_id,
        diff_ref=diff_ref,
        correlation_id=get_correlation_id(),
    )
    db.add(row)
    db.flush()

    audit.log(
        db, type="settings.policy.versioned", tenant_id=ctx.tenant_id,
        actor_user_id=ctx.user_id, resource_type="policy_version", resource_id=row.id,
        metadata={
            "category": category, "version": next_version,
            "autonomy_ceiling": autonomy_ceiling,
            "prior_ceiling": prior.autonomy_ceiling if prior else None,
            "diff_ref": diff_ref,
        },
    )
    env = EventEnvelope(
        type=etypes.SETTINGS_POLICY_VERSIONED,
        tenant_id=ctx.tenant_id,
        correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={"policy_version_id": row.id, "category": category, "version": next_version, "autonomy_ceiling": autonomy_ceiling},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    return row


def resolve_effective_autonomy(
    db: DbSession, ctx: TenantContext, *, category: str, dlp_scan_input: dict[str, Any] | None = None,
) -> ResolvedAutonomy:
    """Deterministic minimum-of-inputs resolution (spec §4.1).

    Every call is itself an audited `policy.evaluated` event with the
    resolved inputs recorded, per §4.1's "must... log the resolved inputs."
    Commits that audit row itself (unlike a plain read) — this function is
    meant to be callable standalone (e.g. a status check with no surrounding
    mutation), and `get_db()` never auto-commits, so a self-contained commit
    is the only way the audit trail isn't silently dropped on such a call.
    Creates no PolicyVersion row; the audit event's own transaction is
    independent of whatever mutation a caller evaluates this ahead of.

    `dlp_scan_input` (Phase 3 slice 6): pass `{"body_text": ..., "attachments": ...}`
    for a mail-category call that has real outbound content to scan — the
    dlp_verdict input then reflects a real `dlp.service.scan()` result
    instead of the always-pass stub. Omit for calendar calls (DLP is scoped
    to mail only) or a mail call with no content yet (e.g. a bare ceiling
    check). Spec §10.2: "DLP unavailability fails closed for governed
    sends" — if the scan itself errors, dlp_verdict resolves to 0 (fail),
    never silently falls back to pass.
    """
    _validate_category(category)
    tenant_ceiling = get_current_ceiling(db, ctx, category=category)

    inputs: dict[str, int] = {
        "tenant_category_ceiling": tenant_ceiling,
        # No separate workspace-policy override table exists yet — inherits
        # the tenant ceiling until one is built.
        "workspace_policy": tenant_ceiling,
        # No per-user preference storage exists yet. Spec §4: users may only
        # lower, never raise, the effective level — "unset" must resolve to
        # "inherit the ceiling," not "unrestricted."
        "user_preference": tenant_ceiling,
        **_UNIMPLEMENTED_INPUTS,
    }

    dlp_verdict: dlp.DlpVerdict | None = None
    if category == "mail" and dlp_scan_input is not None:
        try:
            dlp_verdict = dlp.scan(
                body_text=dlp_scan_input.get("body_text", ""),
                attachments=dlp_scan_input.get("attachments"),
            )
        except Exception:  # noqa: BLE001 — "DLP unavailability fails closed", never silently pass
            dlp_verdict = dlp.DlpVerdict(verdict="fail", matched_rules=["dlp_scan_error"])
        inputs["dlp_verdict"] = _DLP_VERDICT_LEVELS[dlp_verdict.verdict]
    else:
        inputs["dlp_verdict"] = MAX_AUTONOMY_LEVEL

    effective = min(inputs.values())

    audit.log(
        db, type="policy.evaluated", tenant_id=ctx.tenant_id,
        actor_user_id=ctx.user_id, resource_type="policy_evaluation", resource_id=category,
        metadata={
            "category": category, "effective_level": effective, "inputs": inputs,
            "dlp_matched_rules": dlp_verdict.matched_rules if dlp_verdict else None,
        },
    )
    db.commit()
    return ResolvedAutonomy(level=effective, inputs=inputs, dlp_verdict=dlp_verdict)
