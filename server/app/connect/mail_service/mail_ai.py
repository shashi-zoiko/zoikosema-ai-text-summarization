"""AI thread summaries + reply drafts, L1-L2 — Phase 3 slice 8.

Spec §13.1 Phase 3 AI workflow row / §13.2. Mail's equivalent of Phase 2
slice 8: same AI entry point (core/ai.py), same governance wiring, applied
to threads instead of calendar events. Governance decisions live here, not
in core/ai.py — that file stays "call Claude, get structured JSON back."

Autonomy gating only applies to draft-and-stage, matching Phase 2 slice
8's own split:
- Summarization is a pure read — nothing is written, so no autonomy check,
  same "L1... only reads" framing availability.py/generate_meeting_brief
  established.
- A drafted reply is agent-composed content; DLP-scanned (slice 6) BEFORE
  it's ever staged or returned — spec §13.2: "Agent-composed mail is
  DLP-scanned before queueing." A "fail" verdict blocks the draft from
  reaching a reviewer at all (same hard-block precedent slice 9's
  stage_send established), not just from being sent later.
- At mail autonomy ceiling >= L2, the draft stages in the Action Review
  Queue instead of returning directly — same threshold native_events.py
  and calendar ai_workflows.py use. No approve-applies executor is built
  (same deliberate omission generate_agenda's docstring explains): a
  reviewer approves a mail draft to acknowledge/hand it off; sending it is
  a distinct, separate action through slice 9's real send path, which
  re-scans the (possibly-edited) content again before it ever leaves.
"""
from __future__ import annotations

from html.parser import HTMLParser
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.action_review import service as action_review
from app.connect.dlp import service as dlp
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.mail_service import service as mail_service
from app.connect.mail_service.models import MailMessage
from app.connect.policy_engine import service as policy_engine
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import Invalid
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext
from app.core.ai import ai_draft_reply, ai_summarize_thread

MAIL_DRAFT_PROPOSE_ACTION = "mail.draft.prepare.v1"
_STAGE_AT_LEVEL = 2  # same threshold native_events.create_event() uses
_MAX_THREAD_MESSAGES = 10  # most recent N — enough context without an unbounded live-fetch fan-out


class _TextExtractor(HTMLParser):
    """Minimal tag-stripper for AI context assembly — not a rendering
    surface (MailBodyView's DOMPurify/nh3 pipeline is what's ever shown to
    a human), so no HTML sanitization library is needed here, only enough
    to turn sanitized HTML into readable plain text for the model."""

    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def text(self) -> str:
        return " ".join(p.strip() for p in self._parts if p.strip())


def _html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    return parser.text()


async def _thread_context(db: DbSession, ctx: TenantContext, *, thread_id: str) -> list[dict[str, Any]]:
    messages = (
        db.query(MailMessage)
        .filter(
            MailMessage.tenant_id == ctx.tenant_id, MailMessage.user_id == ctx.user_id,
            MailMessage.thread_id == thread_id,
        )
        .order_by(MailMessage.received_at.asc())
        .all()
    )
    if not messages:
        raise Invalid("No synced messages found for this thread")

    recent = messages[-_MAX_THREAD_MESSAGES:]
    context: list[dict[str, Any]] = []
    for m in recent:
        body_text = m.snippet or ""
        try:
            body = await mail_service.get_message_body(db, ctx, m.id)
            if body.get("text"):
                body_text = body["text"]
            elif body.get("html"):
                body_text = _html_to_text(body["html"])
        except Exception:  # noqa: BLE001 — best-effort context; fall back to the snippet already have
            pass
        context.append({"from_email": m.from_email, "subject": m.subject, "body_text": body_text})
    return context


async def summarize_thread(db: DbSession, ctx: TenantContext, *, thread_id: str) -> dict[str, Any]:
    context = await _thread_context(db, ctx, thread_id=thread_id)
    summary = ai_summarize_thread(context)
    return {**summary, "agent_generated": True}


async def draft_reply(db: DbSession, ctx: TenantContext, *, thread_id: str, instruction: str) -> dict[str, Any]:
    if not instruction or not instruction.strip():
        raise Invalid("instruction is required")

    context = await _thread_context(db, ctx, thread_id=thread_id)
    thread_text = "\n\n".join(
        f"From: {m['from_email']}\nSubject: {m['subject'] or '(no subject)'}\n{m['body_text']}" for m in context
    )
    draft = ai_draft_reply(thread_text, instruction)

    mail_settings = policy_engine.get_effective_mail_governance_settings(db, ctx)
    dlp_verdict = dlp.scan(
        body_text=draft.get("body_text", ""),
        sensitive_keywords=tuple(mail_settings["sensitive_keywords"]),
    )
    if dlp_verdict.verdict == "fail":
        raise Invalid(
            "Drafted reply failed DLP preflight — regenerate with a different instruction",
            details={"matched_rules": dlp_verdict.matched_rules},
        )

    resolved = policy_engine.resolve_effective_autonomy(db, ctx, category="mail")
    payload = {
        "thread_id": thread_id, "subject": draft.get("subject", ""), "body_text": draft.get("body_text", ""),
        "dlp_verdict": dlp_verdict.verdict,
    }

    env = EventEnvelope(
        type=etypes.MAIL_DRAFT_PREPARED, tenant_id=ctx.tenant_id, correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id, payload={"thread_id": thread_id, "dlp_verdict": dlp_verdict.verdict},
    )
    enqueue(db, env)

    if resolved.level >= _STAGE_AT_LEVEL:
        staged = await action_review.stage_action(
            db, ctx,
            action_type=MAIL_DRAFT_PROPOSE_ACTION,
            action_payload=payload,
            policy_verdicts={"autonomy": resolved.level, "dlp_verdict": dlp_verdict.verdict},
            reasoning_trace={
                "rationale": f"Drafted a reply on thread {thread_id} per instruction: {instruction[:200]!r}",
                "source_nodes": [{"node_type": "email", "node_id": thread_id}],
                "tool_chain": ["core.ai.ai_draft_reply", "mail_service.mail_ai.draft_reply"],
                "model": draft.get("_model"),
                "uncertainty_markers": (
                    ["dlp_warn"] if dlp_verdict.verdict == "warn" else []
                ),
            },
            rollback_descriptor="no_rollback",  # acknowledging/staging a draft mutates nothing to roll back
            proposed_by_agent="ai_draft_reply",
            policy_version_id=policy_engine.get_current_version_id(db, ctx, category="mail"),
        )
        db.commit()
        await publish(env, topic=f"tenant:{ctx.tenant_id}")
        return {"staged": True, "review_item": staged, "agent_generated": True}

    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    return {
        "staged": False, "subject": draft.get("subject", ""), "body_text": draft.get("body_text", ""),
        "dlp_verdict": dlp_verdict.verdict, "agent_generated": True, "_error": draft.get("_error"),
    }
