"""Email-to-meeting/task governed conversions — Phase 3 slice 10.

"Convert this email into a meeting/task" — a governed, provenance-tracked
creation, not a copy-paste convenience (spec §11, Mail Connector Service).

Reuse, not a second creation path:
- `native_events.create_event()` (Phase 2 slice 3) for email->meeting —
  same autonomy gating, same L2 staging path. `source_message_id` (added
  to that function for this slice) carries the provenance link through
  staging so the Work Graph edge is still written once an L2 proposal is
  approved, not only on direct create.
- `calendar_service.tasks.create_task()` (Phase 2 slice 8) for email->task
  — a human explicitly converting their own email needs no autonomy gate,
  same "human creates their own task" precedent ai_workflows.py's own
  docstring already established (gating there is for AGENT-generated
  tasks specifically).
- `app/connect/work_graph/` (slice 7) — every conversion writes a real
  derived_from edge at creation time; no "backfill later" deferral needed
  here, unlike Phase 2 slice 8's Task->CalendarEvent edges (which predated
  Work Graph).

Email->channel-message conversion is explicitly out of scope (depends on
messaging_service's own cross-posting conventions — smaller, lower
priority, defer until named as needed).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.calendar_service import native_events
from app.connect.calendar_service import tasks as tasks_service
from app.connect.mail_service.models import MailMessage
from app.connect.shared.errors import NotFound
from app.connect.shared.tenant import TenantContext
from app.connect.work_graph import service as work_graph


def _get_message(db: DbSession, ctx: TenantContext, message_id: str) -> MailMessage:
    message = (
        db.query(MailMessage)
        .filter(MailMessage.tenant_id == ctx.tenant_id, MailMessage.id == message_id)
        .first()
    )
    if message is None:
        raise NotFound("Mail message not found")
    return message


async def convert_to_meeting(
    db: DbSession, ctx: TenantContext, *, message_id: str,
    title: str, start_at: datetime, end_at: datetime, timezone_name: str = "UTC",
    description: str | None = None, location: str | None = None,
    attendees: list[dict[str, Any]] | None = None, resources: list[dict[str, Any]] | None = None,
    confidentiality_class: str = "standard", rrule: str | None = None,
) -> dict[str, Any]:
    """Same return shape as native_events.create_event() ({"staged": bool,
    ...}) — a caller staged at L2 sees the same review_item shape any other
    calendar create proposal does; the Work Graph edge lands once that
    proposal is approved and materialized (see create_event's
    source_message_id handling)."""
    _get_message(db, ctx, message_id)  # 404s early if the email isn't real/tenant-scoped
    return await native_events.create_event(
        db, ctx, title=title, start_at=start_at, end_at=end_at, timezone_name=timezone_name,
        description=description, location=location, attendees=attendees, resources=resources,
        confidentiality_class=confidentiality_class, rrule=rrule, source_message_id=message_id,
    )


def convert_to_task(
    db: DbSession, ctx: TenantContext, *, message_id: str,
    title: str, priority: str = "med", assignee_email: str | None = None,
) -> dict[str, Any]:
    """No autonomy gating — see module docstring. assignee_email defaults
    to the email's own sender when the caller doesn't specify one, since
    "follow up on this email" most often means following up WITH whoever
    sent it."""
    message = _get_message(db, ctx, message_id)
    task = tasks_service.create_task(
        db, ctx, title=title, priority=priority, assignee_email=assignee_email or message.from_email,
    )
    work_graph.create_edge(
        db, ctx, edge_type="derived_from",
        from_node_type="task", from_node_id=task.id,
        to_node_type="email", to_node_id=message.id,
    )
    db.commit()
    return tasks_service.to_dict(task)
