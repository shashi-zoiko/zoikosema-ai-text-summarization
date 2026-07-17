"""Assignment + internal notes on mail items — Phase 4 slice 2.

Spec §1.2 explicit non-goal: "Sema shall not become a helpdesk, CRM,
billing inbox product... Assignment and shared inbox primitives are
allowed; ticketing/SLA productisation is not." Status is exactly
open/done — no priority, due date, SLA timer, or auto-escalation. If a
field would only make sense on a support ticket, it doesn't belong here;
re-check this line before extending this module.

Both tables here are ordinary connect_* tables gated by the SAME
mailbox-access check reading already uses (shared_mailboxes.
accessible_connection_ids) — a teammate can't assign or leave a note on a
message they couldn't otherwise read.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.audit import service as audit
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.mail_service.models import ASSIGNMENT_STATUSES, MailAssignment, MailMessage, MailNote
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import Invalid, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext
from app.connect.shared_mailboxes import service as shared_mailboxes


def _get_accessible_message(db: DbSession, ctx: TenantContext, message_id: str) -> MailMessage:
    ids = shared_mailboxes.accessible_connection_ids(db, ctx)
    message = (
        db.query(MailMessage)
        .filter(
            MailMessage.tenant_id == ctx.tenant_id, MailMessage.id == message_id,
            MailMessage.provider_connection_id.in_(ids),
        )
        .first()
        if ids else None
    )
    if message is None:
        raise NotFound("Mail message not found")
    return message


async def assign_message(
    db: DbSession, ctx: TenantContext, *, message_id: str, assigned_to_user_id: int,
) -> dict[str, Any]:
    _get_accessible_message(db, ctx, message_id)

    existing = db.query(MailAssignment).filter(
        MailAssignment.tenant_id == ctx.tenant_id, MailAssignment.message_id == message_id,
    ).first()
    if existing is not None:
        existing.assigned_to_user_id = assigned_to_user_id
        existing.assigned_by_user_id = ctx.user_id
        existing.status = "open"
        assignment = existing
    else:
        assignment = MailAssignment(
            id=uuid7_str(), tenant_id=ctx.tenant_id, message_id=message_id,
            assigned_to_user_id=assigned_to_user_id, assigned_by_user_id=ctx.user_id, status="open",
            correlation_id=get_correlation_id(),
        )
        db.add(assignment)
    db.flush()

    audit.log(
        db, type="mail.assignment.created", tenant_id=ctx.tenant_id, actor_user_id=ctx.user_id,
        resource_type="mail_assignment", resource_id=assignment.id,
        metadata={"message_id": message_id, "assigned_to_user_id": assigned_to_user_id},
    )
    env = EventEnvelope(
        type=etypes.MAIL_ASSIGNMENT_CREATED, tenant_id=ctx.tenant_id, correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id, payload={"assignment_id": assignment.id, "message_id": message_id},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    return to_dict(assignment)


async def update_assignment_status(db: DbSession, ctx: TenantContext, *, message_id: str, status: str) -> dict[str, Any]:
    if status not in ASSIGNMENT_STATUSES:
        raise Invalid(f"Unknown status: {status}")
    _get_accessible_message(db, ctx, message_id)
    assignment = db.query(MailAssignment).filter(
        MailAssignment.tenant_id == ctx.tenant_id, MailAssignment.message_id == message_id,
    ).first()
    if assignment is None:
        raise NotFound("This message has no assignment yet")

    assignment.status = status
    db.flush()

    audit.log(
        db, type="mail.assignment.status_changed", tenant_id=ctx.tenant_id, actor_user_id=ctx.user_id,
        resource_type="mail_assignment", resource_id=assignment.id, metadata={"status": status},
    )
    env = EventEnvelope(
        type=etypes.MAIL_ASSIGNMENT_STATUS_CHANGED, tenant_id=ctx.tenant_id, correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id, payload={"assignment_id": assignment.id, "status": status},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    return to_dict(assignment)


def list_assignments(
    db: DbSession, ctx: TenantContext, *, assigned_to_user_id: int | None = None, status: str | None = None,
) -> list[MailAssignment]:
    """Scoped to the tenant only, not accessible_connection_ids — "my
    assigned items" must show items assigned TO me even across mailboxes I
    don't otherwise have standing delegate access to list/browse (an admin
    assigning outside the delegate model is a real, deliberate case this
    allows; the underlying message read still goes through
    _get_accessible_message's check everywhere else)."""
    q = db.query(MailAssignment).filter(MailAssignment.tenant_id == ctx.tenant_id)
    if assigned_to_user_id is not None:
        q = q.filter(MailAssignment.assigned_to_user_id == assigned_to_user_id)
    if status:
        q = q.filter(MailAssignment.status == status)
    return q.order_by(MailAssignment.created_at.desc()).all()


async def add_note(db: DbSession, ctx: TenantContext, *, message_id: str, body: str) -> dict[str, Any]:
    if not body or not body.strip():
        raise Invalid("body is required")
    _get_accessible_message(db, ctx, message_id)

    note = MailNote(
        id=uuid7_str(), tenant_id=ctx.tenant_id, message_id=message_id,
        author_user_id=ctx.user_id, body=body.strip(), correlation_id=get_correlation_id(),
    )
    db.add(note)
    db.flush()

    audit.log(
        db, type="mail.note.added", tenant_id=ctx.tenant_id, actor_user_id=ctx.user_id,
        resource_type="mail_note", resource_id=note.id, metadata={"message_id": message_id},
    )
    env = EventEnvelope(
        type=etypes.MAIL_NOTE_ADDED, tenant_id=ctx.tenant_id, correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id, payload={"note_id": note.id, "message_id": message_id},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    return note_to_dict(note)


def list_notes(db: DbSession, ctx: TenantContext, *, message_id: str) -> list[MailNote]:
    _get_accessible_message(db, ctx, message_id)
    return (
        db.query(MailNote)
        .filter(MailNote.tenant_id == ctx.tenant_id, MailNote.message_id == message_id)
        .order_by(MailNote.created_at.asc())
        .all()
    )


def to_dict(assignment: MailAssignment) -> dict[str, Any]:
    return {
        "id": assignment.id, "message_id": assignment.message_id,
        "assigned_to_user_id": assignment.assigned_to_user_id, "assigned_by_user_id": assignment.assigned_by_user_id,
        "status": assignment.status,
        "created_at": assignment.created_at.isoformat() if assignment.created_at else None,
    }


def note_to_dict(note: MailNote) -> dict[str, Any]:
    return {
        "id": note.id, "message_id": note.message_id, "author_user_id": note.author_user_id,
        "body": note.body, "created_at": note.created_at.isoformat() if note.created_at else None,
    }
