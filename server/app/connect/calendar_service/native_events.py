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
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session as DbSession

from app.connect.action_review import service as action_review
from app.connect.audit import service as audit
from app.connect.calendar_service.models import (
    CONFIDENTIALITY_CLASSES,
    NATIVE_EVENT_STATUSES,
    NativeCalendarEvent,
)
from app.connect.calendar_service.recurrence import expand_rrule
from app.connect.calendar_service import zoikotime_signal
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
from app.models.organization import OrganizationMember
from app.models.user import User

CALENDAR_EVENT_CREATE_ACTION = "calendar.event.create.v1"
# Autonomy level at/above which a create is staged instead of mutated
# directly. L0 (observe) and L1 (suggest) both create directly — L1 still
# means "human creates," which native events already are by construction
# in this slice (no AI proposer exists yet).
_STAGE_AT_LEVEL = 2


def _latest_version(
    db: DbSession, tenant_id: str, version_chain_id: str, *, recurrence_id: datetime | None = None,
) -> NativeCalendarEvent | None:
    return (
        db.query(NativeCalendarEvent)
        .filter(
            NativeCalendarEvent.tenant_id == tenant_id,
            NativeCalendarEvent.version_chain_id == version_chain_id,
            # SQLAlchemy compiles `Column == None` to `IS NULL`, so this
            # correctly matches the series master (recurrence_id IS NULL)
            # when the caller passes None, and one specific instance's
            # exception chain otherwise — same filter, no branching needed.
            NativeCalendarEvent.recurrence_id == recurrence_id,
        )
        .order_by(NativeCalendarEvent.version_number.desc())
        .first()
    )


def get_current_event(
    db: DbSession, ctx: TenantContext, version_chain_id: str, *, recurrence_id: datetime | None = None,
) -> NativeCalendarEvent:
    event = _latest_version(db, ctx.tenant_id, version_chain_id, recurrence_id=recurrence_id)
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


def _check_zoikotime_constraint(db: DbSession, ctx: TenantContext, *, start_at: datetime, end_at: datetime) -> None:
    """Spec §6.1 hard-enforcement phase (Phase 2 slice 6) — raises Conflict
    if [start_at, end_at] violates a ZoikoTime workforce constraint AND
    hard enforcement is on (see zoikotime_signal.py; a no-op otherwise).
    For a recurring series this only checks the FIRST occurrence — checking
    every future occurrence of a series with no real bound (COUNT/UNTIL
    optional) against a signal source that returns no data yet would be
    speculative complexity with nothing to verify it against; revisit once
    the ZoikoTime integration is real and this matters in practice."""
    violation = zoikotime_signal.check_hard_constraint(db, ctx, start_at=start_at, end_at=end_at)
    if violation:
        raise Conflict(violation)


def _validate_rrule(rrule_str: str, start_at: datetime, timezone_name: str) -> None:
    """Fail fast on a malformed RRULE / unknown IANA zone at create time,
    rather than at the first occurrence-expansion call — the same
    dateutil/zoneinfo errors either way, just surfaced where the mistake
    was actually made."""
    try:
        tz = ZoneInfo(timezone_name)
    except Exception as e:  # noqa: BLE001 — zoneinfo raises its own exception types
        raise Invalid(f"Unknown timezone: {timezone_name}") from e
    try:
        expand_rrule(rrule_str, start_at.astimezone(tz), start_at.astimezone(tz), start_at.astimezone(tz))
    except Exception as e:  # noqa: BLE001 — dateutil raises plain ValueError for bad RRULE syntax
        raise Invalid(f"Invalid RRULE: {e}") from e


async def create_event(
    db: DbSession, ctx: TenantContext, *,
    title: str, start_at: datetime, end_at: datetime,
    timezone_name: str = "UTC", description: str | None = None, location: str | None = None,
    attendees: list[dict[str, Any]] | None = None, resources: list[dict[str, Any]] | None = None,
    confidentiality_class: str = "standard", rrule: str | None = None,
) -> dict[str, Any]:
    attendees = attendees or []
    resources = resources or []
    _validate_fields(title=title, start_at=start_at, end_at=end_at, confidentiality_class=confidentiality_class)
    if rrule:
        _validate_rrule(rrule, start_at, timezone_name)
    _check_zoikotime_constraint(db, ctx, start_at=start_at, end_at=end_at)

    resolved = policy_engine.resolve_effective_autonomy(db, ctx, category="calendar")
    payload = {
        "title": title, "start_at": start_at.isoformat(), "end_at": end_at.isoformat(),
        "timezone_name": timezone_name, "description": description, "location": location,
        "attendees": attendees, "resources": resources, "confidentiality_class": confidentiality_class,
        "rrule": rrule,
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


def _fields_of(event: NativeCalendarEvent) -> dict[str, Any]:
    """The mergeable/carry-forward field set every version-producing
    function needs — extracted once so update/delete/restore/exception-seed
    don't each re-list the same fields (they did, before this).

    Includes `rrule` so updating/deleting a series master doesn't silently
    drop its recurrence rule — but `_resolve_occurrence_base` explicitly
    clears it when seeding an exception, since one occurrence is never
    itself a series."""
    return dict(
        title=event.title, start_at=event.start_at, end_at=event.end_at,
        timezone_name=event.timezone, description=event.description, location=event.location,
        attendees=list(event.attendees or []), resources=list(event.resources or []),
        confidentiality_class=event.confidentiality_class, rrule=event.rrule,
    )


def _resolve_occurrence_base(
    db: DbSession, ctx: TenantContext, version_chain_id: str, recurrence_id: datetime,
) -> tuple[dict[str, Any], int]:
    """Fields + current version_number for one occurrence of a recurring
    series — either an existing exception's latest version, or (the first
    time this occurrence is touched) the master series' fields with
    start/end shifted to this specific instant. Reused by update_event and
    delete_event so "edit one instance" and "delete one instance" don't
    each reimplement this seeding step."""
    existing = _latest_version(db, ctx.tenant_id, version_chain_id, recurrence_id=recurrence_id)
    if existing is not None:
        return _fields_of(existing), existing.version_number

    master = get_current_event(db, ctx, version_chain_id)
    if not master.rrule:
        raise Invalid("Event has no recurrence rule — there is no such occurrence to modify")
    fields = _fields_of(master)
    duration = master.end_at - master.start_at
    fields["start_at"] = recurrence_id
    fields["end_at"] = recurrence_id + duration
    fields["rrule"] = None  # one occurrence is never itself a recurring series
    return fields, 0


async def update_event(
    db: DbSession, ctx: TenantContext, *, version_chain_id: str, recurrence_id: datetime | None = None,
    title: str | None = None, start_at: datetime | None = None, end_at: datetime | None = None,
    timezone_name: str | None = None, description: str | None = None, location: str | None = None,
    attendees: list[dict[str, Any]] | None = None, resources: list[dict[str, Any]] | None = None,
    confidentiality_class: str | None = None, rrule: str | None = None,
) -> dict[str, Any]:
    """recurrence_id=None updates the series master (or a non-recurring
    event) as a whole — `rrule` here changes the series' recurrence rule.
    A non-None recurrence_id edits (or creates, on first touch) just that
    one occurrence's exception — spec §19.1 "attendee exceptions": the rest
    of the series is untouched, and `rrule` is ignored (an exception is
    never itself a series, see _resolve_occurrence_base)."""
    if recurrence_id is None:
        current = get_current_event(db, ctx, version_chain_id)
        if current.status != "confirmed":
            raise Conflict("Cannot update a cancelled event — restore it first")
        base, version_number = _fields_of(current), current.version_number
    else:
        base, version_number = _resolve_occurrence_base(db, ctx, version_chain_id, recurrence_id)

    merged = dict(
        title=title if title is not None else base["title"],
        start_at=start_at if start_at is not None else base["start_at"],
        end_at=end_at if end_at is not None else base["end_at"],
        timezone_name=timezone_name if timezone_name is not None else base["timezone_name"],
        description=description if description is not None else base["description"],
        location=location if location is not None else base["location"],
        attendees=attendees if attendees is not None else base["attendees"],
        resources=resources if resources is not None else base["resources"],
        confidentiality_class=confidentiality_class if confidentiality_class is not None else base["confidentiality_class"],
        rrule=(rrule if rrule is not None else base["rrule"]) if recurrence_id is None else None,
    )
    _validate_fields(
        title=merged["title"], start_at=merged["start_at"], end_at=merged["end_at"],
        confidentiality_class=merged["confidentiality_class"],
    )
    if merged["rrule"]:
        _validate_rrule(merged["rrule"], merged["start_at"], merged["timezone_name"])
    _check_zoikotime_constraint(db, ctx, start_at=merged["start_at"], end_at=merged["end_at"])

    event = _insert_version(
        db, ctx, version_chain_id=version_chain_id, version_number=version_number + 1,
        status="confirmed", recurrence_id=recurrence_id, **merged,
    )
    env = _emit_mutated(db, ctx, event, action="updated")
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    _notify_attendees(db, event, method="REQUEST")
    return _to_dict(event)


async def delete_event(
    db: DbSession, ctx: TenantContext, *, version_chain_id: str, recurrence_id: datetime | None = None,
) -> dict[str, Any]:
    """recurrence_id=None cancels the whole series (or a non-recurring
    event). A non-None recurrence_id cancels just that one occurrence —
    the rest of a recurring series is unaffected."""
    if recurrence_id is None:
        current = get_current_event(db, ctx, version_chain_id)
        if current.status == "cancelled":
            return _to_dict(current)
        base, version_number = _fields_of(current), current.version_number
    else:
        base, version_number = _resolve_occurrence_base(db, ctx, version_chain_id, recurrence_id)

    event = _insert_version(
        db, ctx, version_chain_id=version_chain_id, version_number=version_number + 1,
        status="cancelled", recurrence_id=recurrence_id, **base,
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
    not silently reverted. Series-level only (recurrence_id=None) — restoring
    a single excepted instance can reuse the same version_chain once that
    scenario has a real caller."""
    current = get_current_event(db, ctx, version_chain_id)
    previous = (
        db.query(NativeCalendarEvent)
        .filter(
            NativeCalendarEvent.tenant_id == ctx.tenant_id,
            NativeCalendarEvent.version_chain_id == version_chain_id,
            NativeCalendarEvent.recurrence_id.is_(None),
            NativeCalendarEvent.version_number == current.version_number - 1,
        )
        .first()
    )
    if previous is None:
        raise Conflict("No previous version to restore to")

    event = _insert_version(
        db, ctx, version_chain_id=version_chain_id, version_number=current.version_number + 1,
        status="confirmed", recurrence_id=None, **_fields_of(previous),
    )
    env = _emit_mutated(db, ctx, event, action="restored")
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    _notify_attendees(db, event, method="REQUEST")
    return _to_dict(event)


def list_occurrences(
    db: DbSession, ctx: TenantContext, *, version_chain_id: str, range_start: datetime, range_end: datetime,
) -> list[dict[str, Any]]:
    """Concrete occurrences of a (possibly recurring) event within a window,
    with any per-instance exceptions layered on top — a cancelled exception
    is omitted, a modified one is returned in its overridden form, and every
    other occurrence is synthesized from the series master. Non-recurring
    events simply yield their own single occurrence if it falls in range."""
    master = get_current_event(db, ctx, version_chain_id)
    if not master.rrule:
        if master.status == "cancelled" or master.end_at < range_start or master.start_at > range_end:
            return []
        return [_to_dict(master)]

    tz = ZoneInfo(master.timezone)
    duration = master.end_at - master.start_at
    # expand_rrule/between() matches on occurrence START only — an
    # occurrence that started before range_start but still overlaps it
    # (start + duration > range_start) would otherwise be silently missed.
    # Querying from (range_start - duration) and letting the exact overlap
    # check happen below is correct regardless of how long this event runs.
    occurrence_starts = expand_rrule(
        master.rrule, master.start_at.astimezone(tz),
        (range_start - duration).astimezone(tz), range_end.astimezone(tz),
    )

    out: list[dict[str, Any]] = []
    for occ_start_local in occurrence_starts:
        occ_start_utc = occ_start_local.astimezone(timezone.utc)
        exception = _latest_version(db, ctx.tenant_id, version_chain_id, recurrence_id=occ_start_utc)
        if exception is not None:
            if exception.status == "cancelled":
                continue
            # An exception may have moved/resized this occurrence — filter
            # on ITS OWN start/end, not the master's duration.
            if not (exception.start_at < range_end and exception.end_at > range_start):
                continue
            out.append(_to_dict(exception))
        else:
            occ_end_utc = occ_start_utc + duration
            if not (occ_start_utc < range_end and occ_end_utc > range_start):
                continue
            occurrence = _to_dict(master)
            occurrence["start_at"] = occ_start_utc.isoformat()
            occurrence["end_at"] = occ_end_utc.isoformat()
            occurrence["recurrence_id"] = occ_start_utc.isoformat()
            out.append(occurrence)
    return out


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
    rrule: str | None = None, recurrence_id: datetime | None = None,
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
        rrule=rrule,
        recurrence_id=recurrence_id,
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


# Spec §9.2: "Confidential external calendar invites must use placeholder
# titles externally... disclose that protocol metadata such as time,
# organiser, and attendee routing can leave Sema." Deliberately does NOT
# say or imply "encrypted"/"end-to-end" — spec §9.1/§9.2's hard rule this
# whole feature exists to honor is that connected/external calendar data is
# policy-excluded, never a cryptographic guarantee (see CONTEXT.md's own
# Confidential Mode distinction, applied here to calendar for the first
# time). Any change to this copy should be re-checked against that rule.
CONFIDENTIAL_PLACEHOLDER_TITLE = "Confidential Event"
CONFIDENTIAL_PLACEHOLDER_DESCRIPTION = (
    "The organiser has marked this event confidential. Its title and details "
    "are withheld from this invite; the meeting time and your attendance are "
    "still visible to your calendar provider."
)


def _is_external_attendee(db: DbSession, event: NativeCalendarEvent, email: str) -> bool:
    """An attendee "leaves Sema" (spec §9.2) unless they're a registered
    User who's a member of the event's own organisation. A personal
    (no-org) tenant has no teammates by definition, so every attendee there
    is external."""
    if not event.tenant_id.startswith("org:"):
        return True
    org_id = int(event.tenant_id.removeprefix("org:"))
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        return True
    return db.query(OrganizationMember).filter(
        OrganizationMember.organization_id == org_id, OrganizationMember.user_id == user.id,
    ).first() is None


def _notify_attendees(db: DbSession, event: NativeCalendarEvent, *, method: str) -> None:
    """Best-effort iTIP notification — reuses core/calendar.py's generate_ics
    and core/email.py's existing meeting-email helpers rather than forking a
    second ICS/email path (per this slice's own reuse rule). UID is the
    version_chain_id, stable across the whole event's history, same
    precedent as Phase 1 slice 5's meeting_code-derived UID.

    A confidential event's title/description are placeheld (see
    CONFIDENTIAL_PLACEHOLDER_TITLE) for external attendees only — an
    internal (same-org) attendee, and every field this repo stores
    internally (the DB row itself, the Action Review Queue payload before
    approval), always keeps the real title. This is the one real
    per-outbound-recipient redaction this codebase does; team_calendar.py's
    own "Busy" redaction is a different surface (internal teammates
    viewing a calendar UI) with different placeholder text for that reason
    — not the same function, deliberately.

    Known, deliberate gap: an edited/cancelled single occurrence (recurrence_id
    set) sends a plain REQUEST/CANCEL for that instance's own start/end,
    without a RECURRENCE-ID property pointing back at the series — full
    RFC 5545 would want one so a receiving client ties it to the right
    occurrence automatically. Not required by this slice's own correctness
    bar (the DB-level exception is what's tested), and most calendar
    clients still render a same-UID invite sensibly without it — add
    RECURRENCE-ID if a real client integration needs it."""
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
    local_start_at = event.start_at.astimezone(ZoneInfo(event.timezone))
    scheduled_str = local_start_at.strftime("%b %d, %Y at %I:%M %p") + f" ({event.timezone})"
    is_confidential = event.confidentiality_class == "confidential"

    for email in emails:
        placehold = is_confidential and _is_external_attendee(db, event, email)
        title = CONFIDENTIAL_PLACEHOLDER_TITLE if placehold else event.title
        description = CONFIDENTIAL_PLACEHOLDER_DESCRIPTION if placehold else event.description

        ics_data = generate_ics(
            title=title, meeting_code=event.version_chain_id, join_url=join_url,
            scheduled_at=event.start_at, duration_minutes=duration_minutes,
            organizer_name=organizer_name, organizer_email=organizer_email,
            attendee_email=email, description=description,
            method=method, sequence=max(0, event.version_number - 1), rrule=event.rrule,
        )
        if method == "CANCEL":
            send_meeting_cancelled_email(
                to_email=email, organizer_name=organizer_name, meeting_title=title,
                scheduled_at=scheduled_str, ics_data=ics_data,
            )
        else:
            send_meeting_invite_email(
                to_email=email, inviter_name=organizer_name, meeting_title=title,
                meeting_code=event.version_chain_id, join_url=join_url,
                scheduled_at=scheduled_str, ics_data=ics_data,
            )


def _to_dict(event: NativeCalendarEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "version_chain_id": event.version_chain_id,
        "version_number": event.version_number,
        "recurrence_id": event.recurrence_id.isoformat() if event.recurrence_id else None,
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
