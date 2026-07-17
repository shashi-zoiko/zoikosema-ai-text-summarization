"""Executive briefing across Work Graph — Phase 4 slice 4.

Spec §13.1 Phase 4 AI workflow row. The first AI feature that reads a
cross-category context (calendar + tasks + mail) rather than one node type
at a time — every earlier AI feature (agenda, brief, thread summary) reads
one calendar event or one thread. Pure L1 read: nothing is staged or
mutated, same governance-free framing generate_meeting_brief established
for read-only AI features.

Real Work Graph provenance is threaded through the context (a task that
came from an email, a mail item derived from nothing) via
work_graph.query_subgraph — this is what makes the feature genuinely
"across Work Graph" rather than three unrelated list calls dressed up as
one. Scoped to the requesting user's own view ("my briefing"), same
scoping precedent native_events.list_events already uses.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.calendar_service import native_events
from app.connect.calendar_service import tasks as tasks_service
from app.connect.mail_service import assignments as mail_assignments
from app.connect.mail_service.models import MailMessage
from app.connect.shared.tenant import TenantContext
from app.connect.work_graph import service as work_graph
from app.core.ai import ai_generate_executive_briefing

_BRIEFING_WINDOW = timedelta(days=7)


def _event_provenance_line(db: DbSession, ctx: TenantContext, version_chain_id: str) -> str:
    try:
        sub = work_graph.query_subgraph(db, ctx, node_type="calendar_event", node_id=version_chain_id)
    except Exception:  # noqa: BLE001 — provenance is enrichment, never blocks the briefing
        return ""
    # calendar_event's own derived_from edges point outward to its source
    # (from=calendar_event, to=email) — see native_events.py's
    # _link_email_conversion_to_work_graph — so rooted at the event, that's
    # the "outgoing" direction, not "incoming".
    sources = [e["node"] for e in sub["edges"] if e["edge_type"] == "derived_from" and e["direction"] == "outgoing"]
    if not sources:
        return ""
    return " (derived from: " + ", ".join(s.get("subject") or s.get("node_id", "?") for s in sources) + ")"


def _task_provenance_line(db: DbSession, ctx: TenantContext, task_id: str) -> str:
    try:
        sub = work_graph.query_subgraph(db, ctx, node_type="task", node_id=task_id)
    except Exception:  # noqa: BLE001
        return ""
    sources = [e["node"] for e in sub["edges"] if e["edge_type"] == "derived_from"]
    if not sources:
        return ""
    labels = [s.get("title") or s.get("subject") or s.get("node_id", "?") for s in sources]
    return " (derived from: " + ", ".join(labels) + ")"


def _assemble_context(db: DbSession, ctx: TenantContext) -> str:
    now = datetime.now(timezone.utc)
    events = native_events.list_events(db, ctx, time_min=now, time_max=now + _BRIEFING_WINDOW)
    open_tasks = [t for t in tasks_service.list_tasks(db, ctx, status="open")]
    my_assignments = mail_assignments.list_assignments(db, ctx, assigned_to_user_id=ctx.user_id, status="open")

    lines: list[str] = []

    lines.append(f"Upcoming events (next {_BRIEFING_WINDOW.days} days):")
    if events:
        for e in events:
            lines.append(f"- {e.title} at {e.start_at.isoformat()}{_event_provenance_line(db, ctx, e.version_chain_id)}")
    else:
        lines.append("- none")

    lines.append("\nOpen tasks:")
    if open_tasks:
        for t in open_tasks:
            lines.append(f"- {t.title} (priority: {t.priority}){_task_provenance_line(db, ctx, t.id)}")
    else:
        lines.append("- none")

    lines.append("\nMail assigned to me (open):")
    if my_assignments:
        message_ids = [a.message_id for a in my_assignments]
        messages = {
            m.id: m for m in db.query(MailMessage).filter(
                MailMessage.tenant_id == ctx.tenant_id, MailMessage.id.in_(message_ids),
            ).all()
        }
        for a in my_assignments:
            msg = messages.get(a.message_id)
            subject = msg.subject if msg else "(message not found)"
            lines.append(f"- {subject}")
    else:
        lines.append("- none")

    return "\n".join(lines)


def generate_executive_briefing(db: DbSession, ctx: TenantContext) -> dict[str, Any]:
    context = _assemble_context(db, ctx)
    briefing = ai_generate_executive_briefing(context)
    return {**briefing, "agent_generated": True}
