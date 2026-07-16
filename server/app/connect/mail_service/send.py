"""Mail send/reply/forward with a cancellable delayed-send buffer, L3.

Spec §4 (L3 row) / §5.2 (rollback: cancel buffered send) / §5.3 (Delayed-
Send Buffer). Phase 3 slice 9 — the first L3 feature in the whole build.
Everything through Phase 2 and Phase 3 slice 8 tops out at L2 (stage, human
approves, something else executes); this adds L3: the agent (or a human, at
lower autonomy) sends, but within a cancellable delay window — spec's
"honest" rollback for external email (cancelable only while the buffer
hasn't expired, no false recall after provider delivery).

Gated on a tenant's mail autonomy ceiling being explicitly raised to >= L3
(Policy Engine's DEFAULT_AUTONOMY_CEILING = 1, so this is inert until an
admin opts a tenant in — same precedent native_events.py established for
its own L2 staging gate). No L2-staged fallback path is built for a mail
ceiling below L3 in this MVP — spec's own scope note ("MVP always uses the
buffer") extends to "MVP only ships the L3 path"; add an L2 mail-drafting
fallback if a real caller needs sends gated lower.

DLP preflight is stubbed as always-pass, same precedent as policy_engine's
own `_UNIMPLEMENTED_INPUTS` (see policy_engine/service.py) — Phase 3 slice 6
(DLP MVP) doesn't exist yet, so there is no real verdict to compute.
`check_outbound_dlp` here is a placeholder for that slice's real scanner;
building a fake check with nothing real to verify it against would be
guessing, exactly what policy_engine's own docstring warns against.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.audit import service as audit
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.mail_service.models import MailSend
from app.connect.policy_engine import service as policy_engine
from app.connect.provider_connections import service as provider_connections_service
from app.connect.provider_connections.adapters import get_adapter
from app.connect.provider_connections.models import ProviderConnection
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import Conflict, Forbidden, Invalid, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext

DEFAULT_BUFFER_MINUTES = 5
MIN_BUFFER_MINUTES = 0
MAX_BUFFER_MINUTES = 30

# Autonomy floor required for this feature to run at all (spec §4's L3 row).
_REQUIRED_AUTONOMY = 3


def check_outbound_dlp(*, body_text: str) -> dict[str, Any]:
    """Stub — see module docstring. Always 'pass' until Phase 3 slice 6
    (DLP MVP) replaces this with a real rule-based scan. Kept as a function
    (not an inline constant) so slice 6 can swap the implementation without
    changing this module's call site."""
    return {"verdict": "pass", "matched_rules": [], "note": "dlp_mvp_not_yet_built"}


def _validate_buffer(buffer_minutes: int) -> None:
    if not (MIN_BUFFER_MINUTES <= buffer_minutes <= MAX_BUFFER_MINUTES):
        raise Invalid(f"buffer_minutes must be between {MIN_BUFFER_MINUTES} and {MAX_BUFFER_MINUTES}")


async def stage_send(
    db: DbSession, ctx: TenantContext, *,
    provider: str, to_emails: list[str], subject: str, body_text: str,
    thread_id: str | None = None, in_reply_to_message_id: str | None = None,
    buffer_minutes: int = DEFAULT_BUFFER_MINUTES,
) -> dict[str, Any]:
    if not to_emails:
        raise Invalid("to_emails is required")
    if not body_text or not body_text.strip():
        raise Invalid("body_text is required")
    _validate_buffer(buffer_minutes)

    resolved = policy_engine.resolve_effective_autonomy(db, ctx, category="mail")
    if resolved.level < _REQUIRED_AUTONOMY:
        raise Forbidden(
            f"Mail send at L3 requires an autonomy ceiling >= {_REQUIRED_AUTONOMY} "
            f"(currently {resolved.level}) — ask a workspace admin to raise the mail policy ceiling",
        )

    dlp = check_outbound_dlp(body_text=body_text)
    if dlp["verdict"] == "fail":
        raise Invalid("Outbound message failed DLP preflight", details={"dlp": dlp})

    connection = (
        db.query(ProviderConnection)
        .filter(
            ProviderConnection.tenant_id == ctx.tenant_id,
            ProviderConnection.user_id == ctx.user_id,
            ProviderConnection.provider == provider,
            ProviderConnection.status == "active",
        )
        .first()
    )
    if connection is None:
        raise NotFound("No active provider connection for this provider")

    scheduled_release_at = datetime.now(timezone.utc) + timedelta(minutes=buffer_minutes)
    draft_payload = {
        "to_emails": to_emails, "subject": subject, "body_text": body_text,
        "thread_id": thread_id, "in_reply_to_message_id": in_reply_to_message_id,
    }
    send = MailSend(
        id=uuid7_str(), tenant_id=ctx.tenant_id, user_id=ctx.user_id,
        provider_connection_id=connection.id, provider=provider,
        draft_payload=draft_payload, dlp_verdict=dlp,
        scheduled_release_at=scheduled_release_at, status="buffered",
        correlation_id=get_correlation_id(),
    )
    db.add(send)
    db.flush()

    audit.log(
        db, type="mail.send.buffered", tenant_id=ctx.tenant_id, actor_user_id=ctx.user_id,
        resource_type="mail_send", resource_id=send.id,
        metadata={
            "provider": provider, "scheduled_release_at": scheduled_release_at.isoformat(),
            "dlp_verdict": dlp["verdict"], "autonomy": resolved.level,
        },
    )
    env = EventEnvelope(
        type=etypes.MAIL_SEND_BUFFERED, tenant_id=ctx.tenant_id, correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={"send_id": send.id, "scheduled_release_at": scheduled_release_at.isoformat()},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    return to_dict(send)


def _get_send(db: DbSession, ctx: TenantContext, send_id: str) -> MailSend:
    send = db.query(MailSend).filter(MailSend.tenant_id == ctx.tenant_id, MailSend.id == send_id).first()
    if send is None:
        raise NotFound("Mail send not found")
    return send


def get_send(db: DbSession, ctx: TenantContext, send_id: str) -> MailSend:
    return _get_send(db, ctx, send_id)


def list_sends(db: DbSession, ctx: TenantContext, *, status: str | None = None) -> list[MailSend]:
    q = db.query(MailSend).filter(MailSend.tenant_id == ctx.tenant_id, MailSend.user_id == ctx.user_id)
    if status:
        q = q.filter(MailSend.status == status)
    return q.order_by(MailSend.created_at.desc()).all()


async def cancel_send(db: DbSession, ctx: TenantContext, send_id: str) -> dict[str, Any]:
    """Rollback executor for the Action Review Queue's `cancel_buffered_send`
    descriptor (Phase 2 slice 2's contract — defined with no executor until
    now). Callable only while status == 'buffered' AND the buffer window
    hasn't expired — spec's hard rule that expiry is irreversible for
    external recipients (no false recall after provider delivery)."""
    send = _get_send(db, ctx, send_id)
    if send.status != "buffered":
        raise Conflict(f"Send is '{send.status}', not 'buffered' — cannot cancel")
    if send.scheduled_release_at <= datetime.now(timezone.utc):
        raise Conflict("Buffer window has already expired — cannot cancel")

    send.status = "cancelled"
    db.flush()
    audit.log(
        db, type="mail.send.cancelled", tenant_id=ctx.tenant_id, actor_user_id=ctx.user_id,
        resource_type="mail_send", resource_id=send.id, metadata={},
    )
    env = EventEnvelope(
        type=etypes.MAIL_SEND_CANCELLED, tenant_id=ctx.tenant_id, correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id, payload={"send_id": send.id},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    return to_dict(send)


async def release_due_sends(db: DbSession) -> dict[str, int]:
    """Background dispatcher tick — same "separate process reads pending
    rows" shape events/outbox.py's own (not-yet-built, see that module's
    docstring) dispatcher anticipates. Not wired to a scheduler in this
    slice; that's a real deployment follow-up (a cron/worker invoking this
    function periodically), same category of gap as every other
    not-yet-provisioned piece of infra this build has flagged rather than
    silently skipped.

    Re-running the DLP preflight if the draft changed after staging (spec
    §13.2) is a no-op here: this MVP has no edit-after-stage endpoint, so a
    buffered draft never changes before release, and the condition never
    triggers. Add it if an edit path is built later.
    """
    now = datetime.now(timezone.utc)
    due = (
        db.query(MailSend)
        .filter(MailSend.status == "buffered", MailSend.scheduled_release_at <= now)
        .all()
    )
    released, failed = 0, 0
    for send in due:
        try:
            await _release_one(db, send)
            released += 1
        except Exception as exc:  # noqa: BLE001 — one failed send must not block the rest of the tick
            send.status = "failed"
            send.failure_reason = str(exc)
            db.flush()
            audit.log(
                db, type="mail.send.failed", tenant_id=send.tenant_id, actor_user_id=send.user_id,
                resource_type="mail_send", resource_id=send.id, metadata={"error": str(exc)},
            )
            env = EventEnvelope(
                type=etypes.MAIL_SEND_FAILED, tenant_id=send.tenant_id, correlation_id=get_correlation_id(),
                actor_user_id=send.user_id, payload={"send_id": send.id, "error": str(exc)},
            )
            enqueue(db, env)
            db.commit()
            await publish(env, topic=f"tenant:{send.tenant_id}")
            failed += 1
    return {"released": released, "failed": failed}


async def _release_one(db: DbSession, send: MailSend) -> None:
    connection = db.get(ProviderConnection, send.provider_connection_id)
    if connection is None or connection.status != "active":
        raise Invalid("Provider connection is no longer active")
    adapter = get_adapter(send.provider)
    access_token = await provider_connections_service.ensure_valid_access_token(db, connection, adapter)
    payload = send.draft_payload
    provider_message_id = await adapter.send_message(
        access_token,
        to_emails=payload["to_emails"], subject=payload["subject"], body_text=payload["body_text"],
        thread_id=payload.get("thread_id"), in_reply_to_message_id=payload.get("in_reply_to_message_id"),
    )
    send.status = "released"
    send.provider_message_id = provider_message_id or None
    db.flush()

    audit.log(
        db, type="mail.send.released", tenant_id=send.tenant_id, actor_user_id=send.user_id,
        resource_type="mail_send", resource_id=send.id, metadata={"provider_message_id": provider_message_id},
    )
    env = EventEnvelope(
        type=etypes.MAIL_SEND_RELEASED, tenant_id=send.tenant_id, correlation_id=get_correlation_id(),
        actor_user_id=send.user_id, payload={"send_id": send.id, "provider_message_id": provider_message_id},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{send.tenant_id}")


def to_dict(send: MailSend) -> dict[str, Any]:
    return {
        "id": send.id,
        "provider": send.provider,
        "status": send.status,
        "scheduled_release_at": send.scheduled_release_at.isoformat(),
        "dlp_verdict": send.dlp_verdict,
        "provider_message_id": send.provider_message_id,
        "failure_reason": send.failure_reason,
        "draft_payload": send.draft_payload,
        "created_at": send.created_at.isoformat() if send.created_at else None,
    }
