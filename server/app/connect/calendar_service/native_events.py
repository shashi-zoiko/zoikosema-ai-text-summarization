"""Native (Sema-authoritative) CalendarEvent CRUD + version chain.

Spec §3.1 (CalendarEvent node), §5.2 (rollback via version chain), §12.3
("rollback operations create new events rather than deleting history").
This is the first real mutation in the whole Sema Calendar & Mail build —
the reason Policy Engine (Phase 2 slice 1) and Action Review Queue (slice 2)
had to exist first.

Version chain: every create/update/delete/restore INSERTs a new row into
the append-only connect_native_calendar_events table (never UPDATEs one in
place). `version_chain_id` is the stable identity across an event's whole
history; `version_number` increments. "Current" state = the row with the
highest version_number for a given chain.

Autonomy gating (spec §4 autonomy table) is only wired for **create** in
this slice: at ceiling >= L2 ("Prepare"), a create request stages a
proposal in the Action Review Queue instead of mutating directly, and
approving it materializes the event via create_event_from_approved_proposal
(the "executor" the Action Review Queue's rollback-descriptor contract
anticipated). Update and delete always mutate directly here — staging them
without a matching execute-on-approve path would be a half-finished
feature, not a smaller one; that's a follow-up for whichever later slice
needs L2 update/delete specifically. No tenant has a ceiling above L1
configured by default (Policy Engine's conservative default), so this only
activates once an admin explicitly raises a tenant's Calendar ceiling.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.action_review import service as action_review
from app.connect.audit import service as audit
from app.connect.calendar_service.models import (
    CONFIDENTIALITY_CLASSES,
    NATIVE_EVENT_STATUSES,
    NativeCalendarEvent,
)
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.policy_engine import service as policy_engine
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import Conflict, Invalid, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext
from app.core.calendar import generate_ics
from app.core.config import get_settings
from app.core.email import send_meeting_cancelled_email, send_meeting_invite_email
from app.models.user import User

CALENDAR_EVENT_CREATE_ACTION = "calendar.event.create.v1"
# Autonomy level at/above which a create is staged instead of mutated
# directly. L0 (observe) and L1 (suggest) both create directly — L1 still
# means "human creates," which native events already are by construction
# in this slice (no AI proposer exists yet).
_STAGE_AT_LEVEL = 2


def _latest_version(db: DbSession, tenant_id: str, version_chain_id: str) -> NativeCalendarEvent | None:
    return (
        db.query(NativeCalendarEvent)
        .filter(
            NativeCalendarEvent.tenant_id == tenant_id,
            NativeCalendarEvent.version_chain_id == version_chain_id,
        )
        .order_by(NativeCalendarEvent.version_number.desc())
        .first()
    )


def get_current_event(db: DbSession, ctx: TenantContext, version_chain_id: str) -> NativeCalendarEvent:
    event = _latest_version(db, ctx.tenant_id, version_chain_id)
    if event is None:
        raise NotFound("Calendar event not found")
    return event


def list_events(
    db: DbSession, ctx: TenantContext, *, time_min: datetime | None = None, time_max: datetime | None = None,
) -> list[NativeCalendarEvent]:
    """Latest (current) version of every chain for this user, optionally
    windowed. A chain currently at status='cancelled' is still returned —
    callers that want only live events should filter on .status themselves,
    same as connect_calendar_events' own convention."""
    rows = (
        db.query(NativeCalendarEvent)
        .filter(NativeCalendarEvent.tenant_id == ctx.tenant_id, NativeCalendarEvent.created_by == ctx.user_id)
        .order_by(NativeCalendarEvent.version_chain_id, NativeCalendarEvent.version_number.desc())
        .all()
    )
    latest: dict[str, NativeCalendarEvent] = {}
    for row in rows:
        if row.version_chain_id not in latest:
            latest[row.version_chain_id] = row
    events = list(latest.values())
    if time_min is not None:
        events = [e for e in events if e.end_at >= time_min]
    if time_max is not None:
        events = [e for e in events if e.start_at <= time_max]
    return sorted(events, key=lambda e: e.start_at)


def _validate_fields(*, title: str, start_at: datetime, end_at: datetime, confidentiality_class: str) -> None:
    if not title or not title.strip():
        raise Invalid("title is required")
    if end_at <= start_at:
        raise Invalid("end_at must be after start_at")
    if confidentiality_class not in CONFIDENTIALITY_CLASSES:
        raise Invalid(f"Unknown confidentiality_class: {confidentiality_class}")


async def create_event(
    db: DbSession, ctx: TenantContext, *,
    title: str, start_at: datetime, end_at: datetime,
    timezone_name: str = "UTC", description: str | None = None, location: str | None = None,
    attendees: list[dict[str, Any]] | None = None, resources: list[dict[str, Any]] | None = None,
    confidentiality_class: str = "standard",
) -> dict[str, Any]:
    attendees = attendees or []
    resources = resources or []
    _validate_fields(title=title, start_at=start_at, end_at=end_at, confidentiality_class=confidentiality_class)

    resolved = policy_engine.resolve_effective_autonomy(db, ctx, category="calendar")
    payload = {
        "title": title, "start_at": start_at.isoformat(), "end_at": end_at.isoformat(),
        "timezone_name": timezone_name, "description": description, "location": location,
        "attendees": attendees, "resources": resources, "confidentiality_class": confidentiality_class,
    }
    if resolved.level >= _STAGE_AT_LEVEL:
        staged = await action_review.stage_action(
            db, ctx,
            action_type=CALENDAR_EVENT_CREATE_ACTION,
            action_payload=payload,
            policy_verdicts={"autonomy": resolved.level},
            blast_radius={"attendees": [a.get("email") for a in attendees if a.get("email")]},
            rollback_descriptor="no_rollback",  # nothing exists yet to roll back on a rejected create
        )
        return {"staged": True, "review_item": staged}

    event = _insert_version(db, ctx, version_chain_id=uuid7_str(), version_number=1, status="confirmed", **_parsed(payload))
    env = _emit_mutated(db, ctx, event, action="created")
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    _notify_attendees(db, event, method="REQUEST")
    return {"staged": False, "event": _to_dict(event)}


async def create_event_from_approved_proposal(db: DbSession, ctx: TenantContext, item_id: str) -> dict[str, Any]:
    """Executor for a create staged via create_event() at L2+. Call after
    action_review.approve() has marked the item approved — this is the
    "executor" the Action Review Queue's rollback-descriptor contract
    anticipated (spec §5.1/§11: the producing feature builds it, not the
    generic queue)."""
    item = action_review.get_item(db, ctx, item_id)
    if item.action_type != CALENDAR_EVENT_CREATE_ACTION:
        raise Invalid(f"Item {item_id} is not a calendar event creation proposal")
    if item.status != "approved":
        raise Conflict(f"Item is '{item.status}', not 'approved' — cannot materialize")

    p = item.action_payload
    event = _insert_version(
        db, ctx, version_chain_id=uuid7_str(), version_number=1, status="confirmed",
        **_parsed(p),
    )
    env = _emit_mutated(db, ctx, event, action="created")
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    _notify_attendees(db, event, method="REQUEST")
    return _to_dict(event)


async def update_event(
    db: DbSession, ctx: TenantContext, *, version_chain_id: str,
    title: str | None = None, start_at: datetime | None = None, end_at: datetime | None = None,
    timezone_name: str | None = None, description: str | None = None, location: str | None = None,
    attendees: list[dict[str, Any]] | None = None, resources: list[dict[str, Any]] | None = None,
    confidentiality_class: str | None = None,
) -> dict[str, Any]:
    current = get_current_event(db, ctx, version_chain_id)
    if current.status != "confirmed":
        raise Conflict("Cannot update a cancelled event — restore it first")

    merged = dict(
        title=title if title is not None else current.title,
        start_at=start_at if start_at is not None else current.start_at,
        end_at=end_at if end_at is not None else current.end_at,
        timezone_name=timezone_name if timezone_name is not None else current.timezone,
        description=description if description is not None else current.description,
        location=location if location is not None else current.location,
        attendees=attendees if attendees is not None else list(current.attendees or []),
        resources=resources if resources is not None else list(current.resources or []),
        confidentiality_class=confidentiality_class if confidentiality_class is not None else current.confidentiality_class,
    )
    _validate_fields(
        title=merged["title"], start_at=merged["start_at"], end_at=merged["end_at"],
        confidentiality_class=merged["confidentiality_class"],
    )

    event = _insert_version(
        db, ctx, version_chain_id=version_chain_id, version_number=current.version_number + 1,
        status="confirmed", **merged,
    )
    env = _emit_mutated(db, ctx, event, action="updated")
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    _notify_attendees(db, event, method="REQUEST")
    return _to_dict(event)


async def delete_event(db: DbSession, ctx: TenantContext, *, version_chain_id: str) -> dict[str, Any]:
    current = get_current_event(db, ctx, version_chain_id)
    if current.status == "cancelled":
        return _to_dict(current)

    event = _insert_version(
        db, ctx, version_chain_id=version_chain_id, version_number=current.version_number + 1,
        status="cancelled",
        title=current.title, start_at=current.start_at, end_at=current.end_at,
        timezone_name=current.timezone, description=current.description, location=current.location,
        attendees=list(current.attendees or []), resources=list(current.resources or []),
        confidentiality_class=current.confidentiality_class,
    )
    env = _emit_mutated(db, ctx, event, action="deleted")
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    _notify_attendees(db, event, method="CANCEL")
    return _to_dict(event)


async def restore_previous_version(db: DbSession, ctx: TenantContext, *, version_chain_id: str) -> dict[str, Any]:
    """Rollback executor for the Action Review Queue's restore_previous_version
    descriptor (spec §5.2). Restoring is itself a new version — per spec
    §12.3 nothing is ever un-done in place — copying the previous version's
    fields forward and re-emitting a REQUEST-style iTIP update to attendees,
    since from their perspective this is "the event is back / changed again,"
    not silently reverted."""
    current = get_current_event(db, ctx, version_chain_id)
    previous = (
        db.query(NativeCalendarEvent)
        .filter(
            NativeCalendarEvent.tenant_id == ctx.tenant_id,
            NativeCalendarEvent.version_chain_id == version_chain_id,
            NativeCalendarEvent.version_number == current.version_number - 1,
        )
        .first()
    )
    if previous is None:
        raise Conflict("No previous version to restore to")

    event = _insert_version(
        db, ctx, version_chain_id=version_chain_id, version_number=current.version_number + 1,
        status="confirmed",
        title=previous.title, start_at=previous.start_at, end_at=previous.end_at,
        timezone_name=previous.timezone, description=previous.description, location=previous.location,
        attendees=list(previous.attendees or []), resources=list(previous.resources or []),
        confidentiality_class=previous.confidentiality_class,
    )
    env = _emit_mutated(db, ctx, event, action="restored")
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    _notify_attendees(db, event, method="REQUEST")
    return _to_dict(event)


# ── internals ────────────────────────────────────────────────────────────

def _parsed(payload: dict[str, Any]) -> dict[str, Any]:
    """action_payload round-trips through JSONB as ISO strings — convert
    back to datetimes for _insert_version."""
    out = dict(payload)
    out["start_at"] = datetime.fromisoformat(out["start_at"])
    out["end_at"] = datetime.fromisoformat(out["end_at"])
    return out


def _insert_version(
    db: DbSession, ctx: TenantContext, *,
    version_chain_id: str, version_number: int, status: str,
    title: str, start_at: datetime, end_at: datetime, timezone_name: str,
    description: str | None, location: str | None,
    attendees: list[dict[str, Any]], resources: list[dict[str, Any]], confidentiality_class: str,
) -> NativeCalendarEvent:
    if status not in NATIVE_EVENT_STATUSES:
        raise Invalid(f"Unknown status: {status}")
    event = NativeCalendarEvent(
        id=uuid7_str(),
        tenant_id=ctx.tenant_id,
        version_chain_id=version_chain_id,
        version_number=version_number,
        title=title,
        description=description,
        location=location,
        start_at=start_at if start_at.tzinfo else start_at.replace(tzinfo=timezone.utc),
        end_at=end_at if end_at.tzinfo else end_at.replace(tzinfo=timezone.utc),
        timezone=timezone_name,
        attendees=attendees,
        resources=resources,
        confidentiality_class=confidentiality_class,
        status=status,
        created_by=ctx.user_id,
        correlation_id=get_correlation_id(),
    )
    db.add(event)
    db.flush()
    return event


def _emit_mutated(db: DbSession, ctx: TenantContext, event: NativeCalendarEvent, *, action: str) -> EventEnvelope:
    """Audits + enqueues the mutation and returns the envelope so the caller
    publishes the SAME envelope (same id) after commit — building it twice
    would give the durable outbox copy and the live-fanout copy different
    envelope ids for what's supposed to be one logical event."""
    audit.log(
        db, type="calendar.event.mutated", tenant_id=ctx.tenant_id,
        actor_user_id=ctx.user_id, resource_type="native_calendar_event", resource_id=event.id,
        metadata={
            "version_chain_id": event.version_chain_id, "version_number": event.version_number,
            "action": action, "status": event.status,
        },
    )
    env = EventEnvelope(
        type=etypes.CALENDAR_EVENT_MUTATED,
        tenant_id=ctx.tenant_id,
        correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={
            "event_id": event.id, "version_chain_id": event.version_chain_id,
            "version_number": event.version_number, "action": action, "status": event.status,
        },
    )
    enqueue(db, env)
    return env


def _notify_attendees(db: DbSession, event: NativeCalendarEvent, *, method: str) -> None:
    """Best-effort iTIP notification — reuses core/calendar.py's generate_ics
    and core/email.py's existing meeting-email helpers rather than forking a
    second ICS/email path (per this slice's own reuse rule). UID is the
    version_chain_id, stable across the whole event's history, same
    precedent as Phase 1 slice 5's meeting_code-derived UID."""
    emails = [a.get("email") for a in (event.attendees or []) if a.get("email")]
    if not emails:
        return

    organizer = db.get(User, event.created_by)
    if organizer is None:
        return
    organizer_name = organizer.name
    organizer_email = organizer.email or get_settings().mail_from_email
    join_url = f"{get_settings().frontend_url.rstrip('/')}/calendar/{event.version_chain_id}"
    duration_minutes = max(1, int((event.end_at - event.start_at).total_seconds() // 60))
    scheduled_str = event.start_at.strftime("%b %d, %Y at %I:%M %p") + f" ({event.timezone})"

    for email in emails:
        ics_data = generate_ics(
            title=event.title, meeting_code=event.version_chain_id, join_url=join_url,
            scheduled_at=event.start_at, duration_minutes=duration_minutes,
            organizer_name=organizer_name, organizer_email=organizer_email,
            attendee_email=email, description=event.description,
            method=method, sequence=max(0, event.version_number - 1),
        )
        if method == "CANCEL":
            send_meeting_cancelled_email(
                to_email=email, organizer_name=organizer_name, meeting_title=event.title,
                scheduled_at=scheduled_str, ics_data=ics_data,
            )
        else:
            send_meeting_invite_email(
                to_email=email, inviter_name=organizer_name, meeting_title=event.title,
                meeting_code=event.version_chain_id, join_url=join_url,
                scheduled_at=scheduled_str, ics_data=ics_data,
            )


def _to_dict(event: NativeCalendarEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "version_chain_id": event.version_chain_id,
        "version_number": event.version_number,
        "title": event.title,
        "description": event.description,
        "location": event.location,
        "start_at": event.start_at.isoformat() if event.start_at else None,
        "end_at": event.end_at.isoformat() if event.end_at else None,
        "timezone": event.timezone,
        "rrule": event.rrule,
        "attendees": event.attendees,
        "resources": event.resources,
        "confidentiality_class": event.confidentiality_class,
        "status": event.status,
        "created_by": event.created_by,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }
