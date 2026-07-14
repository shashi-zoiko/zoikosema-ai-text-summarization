"""REST facade for Calendar Service. Thin: parse → call service → serialize."""
from __future__ import annotations

from datetime import date as date_, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.action_review import service as action_review
from app.connect.calendar_service import native_events, resources, service, team_calendar
from app.connect.calendar_service.availability import suggest_available_slots, suggest_group_available_slots
from app.connect.calendar_service.models import CONFIDENTIALITY_CLASSES, RESOURCE_TYPES
from app.connect.shared.errors import DomainError
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/calendar", tags=["connect.calendar"])


class SyncCalendarIn(BaseModel):
    provider: Literal["google_calendar", "microsoft_calendar"]


class CalendarEventOut(BaseModel):
    id: str
    provider: str
    title: str | None
    description: str | None
    location: str | None
    start_at: datetime | None
    end_at: datetime | None
    all_day: bool
    status: str
    attendees: list[dict]


def _to_out(e) -> CalendarEventOut:
    return CalendarEventOut(
        id=e.id, provider=e.provider, title=e.title, description=e.description,
        location=e.location, start_at=e.start_at, end_at=e.end_at,
        all_day=e.all_day, status=e.status, attendees=e.attendees,
    )


def _ctx(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> TenantContext:
    return resolve_tenant(db, user)


def _to_http(e: DomainError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, **e.details})


@router.post("/sync", status_code=200)
async def sync_calendar(
    data: SyncCalendarIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        return await service.sync_calendar(db, ctx, provider=data.provider)
    except DomainError as e:
        raise _to_http(e) from e


@router.get("/events", response_model=list[CalendarEventOut])
def list_calendar_events(
    time_min: datetime | None = Query(default=None),
    time_max: datetime | None = Query(default=None),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    events = service.list_calendar_events(db, ctx, time_min=time_min, time_max=time_max)
    return [_to_out(e) for e in events]


class FreeSlotOut(BaseModel):
    start_at: datetime
    end_at: datetime


@router.get("/availability", response_model=list[FreeSlotOut])
def get_availability(
    on_date: date_ = Query(...),
    duration_minutes: int = Query(default=30, ge=5, le=480),
    day_start_hour: int = Query(default=9, ge=0, le=23),
    day_end_hour: int = Query(default=18, ge=1, le=24),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    slots = suggest_available_slots(
        db, ctx, on_date=on_date, duration_minutes=duration_minutes,
        day_start_hour=day_start_hour, day_end_hour=day_end_hour,
    )
    return [FreeSlotOut(start_at=s.start_at, end_at=s.end_at) for s in slots]


class GroupAvailabilityIn(BaseModel):
    on_date: date_
    duration_minutes: int = 30
    attendee_user_ids: list[int] = []
    resource_ids: list[str] = []
    day_start_hour: int = 9
    day_end_hour: int = 18


@router.post("/group-availability", response_model=list[FreeSlotOut])
def get_group_availability(
    data: GroupAvailabilityIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    """Scheduling Engine constraint solver (Phase 2 slice 6) — a slot is
    returned only if the caller, every listed attendee, and every listed
    resource are all free for the whole duration. POST (not GET) because
    attendee/resource lists don't fit cleanly in query params."""
    attendee_ids = list({ctx.user_id, *data.attendee_user_ids})  # caller is always implicitly included
    slots = suggest_group_available_slots(
        db, ctx, on_date=data.on_date, duration_minutes=data.duration_minutes,
        attendee_user_ids=attendee_ids, resource_ids=data.resource_ids,
        day_start_hour=data.day_start_hour, day_end_hour=data.day_end_hour,
    )
    return [FreeSlotOut(start_at=s.start_at, end_at=s.end_at) for s in slots]


# ── Native (Sema-authoritative) events — Phase 2 slice 3 ────────────────────

_CONFIDENTIALITY = Literal["standard", "confidential"]
assert set(_CONFIDENTIALITY.__args__) == set(CONFIDENTIALITY_CLASSES)


class NativeEventIn(BaseModel):
    title: str
    start_at: datetime
    end_at: datetime
    timezone_name: str = "UTC"
    description: str | None = None
    location: str | None = None
    attendees: list[dict[str, Any]] = []
    resources: list[dict[str, Any]] = []
    confidentiality_class: _CONFIDENTIALITY = "standard"
    rrule: str | None = None


class NativeEventUpdateIn(BaseModel):
    title: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    timezone_name: str | None = None
    description: str | None = None
    location: str | None = None
    attendees: list[dict[str, Any]] | None = None
    resources: list[dict[str, Any]] | None = None
    confidentiality_class: _CONFIDENTIALITY | None = None
    rrule: str | None = None


class NativeEventOut(BaseModel):
    id: str
    version_chain_id: str
    version_number: int
    recurrence_id: datetime | None = None
    title: str
    description: str | None
    location: str | None
    start_at: datetime | None
    end_at: datetime | None
    timezone: str
    rrule: str | None
    attendees: list[dict[str, Any]]
    resources: list[dict[str, Any]]
    confidentiality_class: str
    status: str
    created_by: int
    created_at: datetime | None


class OccurrenceOut(BaseModel):
    """A concrete occurrence of a (possibly recurring) event — see
    native_events.list_occurrences(). Distinct from NativeEventOut: an
    occurrence that's never been individually excepted has no row `id` of
    its own (it's synthesized from the series master), so `id` here is the
    master's row id, not a per-occurrence identity."""
    id: str
    version_chain_id: str
    recurrence_id: datetime | None
    title: str
    description: str | None
    location: str | None
    start_at: datetime
    end_at: datetime
    timezone: str
    attendees: list[dict[str, Any]]
    resources: list[dict[str, Any]]
    confidentiality_class: str
    status: str
    # Only populated by GET /team-calendar — whose event this is. A single
    # event's own occurrences (GET .../occurrences) don't need it, the
    # caller already knows whose calendar they queried.
    owner_id: int | None = None


def _native_to_out(e) -> NativeEventOut:
    return NativeEventOut(
        id=e.id, version_chain_id=e.version_chain_id, version_number=e.version_number,
        recurrence_id=e.recurrence_id,
        title=e.title, description=e.description, location=e.location,
        start_at=e.start_at, end_at=e.end_at, timezone=e.timezone, rrule=e.rrule,
        attendees=e.attendees, resources=e.resources, confidentiality_class=e.confidentiality_class,
        status=e.status, created_by=e.created_by, created_at=e.created_at,
    )


@router.post("/native-events", status_code=201)
async def create_native_event(
    data: NativeEventIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    """Returns {"staged": true, "review_item": {...}} at L2+ ceilings, or
    {"staged": false, "event": {...}} when created directly."""
    try:
        return await native_events.create_event(
            db, ctx, title=data.title, start_at=data.start_at, end_at=data.end_at,
            timezone_name=data.timezone_name, description=data.description, location=data.location,
            attendees=data.attendees, resources=data.resources, confidentiality_class=data.confidentiality_class,
            rrule=data.rrule,
        )
    except DomainError as e:
        raise _to_http(e) from e


@router.get("/native-events", response_model=list[NativeEventOut])
def list_native_events(
    time_min: datetime | None = Query(default=None),
    time_max: datetime | None = Query(default=None),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    return [_native_to_out(e) for e in native_events.list_events(db, ctx, time_min=time_min, time_max=time_max)]


@router.get("/native-events/{version_chain_id}", response_model=NativeEventOut)
def get_native_event(
    version_chain_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        event = native_events.get_current_event(db, ctx, version_chain_id)
    except DomainError as e:
        raise _to_http(e) from e
    return _native_to_out(event)


@router.patch("/native-events/{version_chain_id}", response_model=NativeEventOut)
async def update_native_event(
    version_chain_id: str,
    data: NativeEventUpdateIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        out = await native_events.update_event(
            db, ctx, version_chain_id=version_chain_id,
            title=data.title, start_at=data.start_at, end_at=data.end_at, timezone_name=data.timezone_name,
            description=data.description, location=data.location, attendees=data.attendees,
            resources=data.resources, confidentiality_class=data.confidentiality_class, rrule=data.rrule,
        )
    except DomainError as e:
        raise _to_http(e) from e
    return NativeEventOut(**out)


@router.get("/native-events/{version_chain_id}/occurrences", response_model=list[OccurrenceOut])
def list_native_event_occurrences(
    version_chain_id: str,
    range_start: datetime = Query(...),
    range_end: datetime = Query(...),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    """Concrete occurrences within [range_start, range_end] — the single
    event itself if non-recurring, or every expanded instance (with any
    per-instance exception applied) if it has an rrule."""
    try:
        occs = native_events.list_occurrences(
            db, ctx, version_chain_id=version_chain_id, range_start=range_start, range_end=range_end,
        )
    except DomainError as e:
        raise _to_http(e) from e
    return [OccurrenceOut(**o) for o in occs]


@router.patch("/native-events/{version_chain_id}/occurrences/{recurrence_id}", response_model=NativeEventOut)
async def update_native_event_occurrence(
    version_chain_id: str,
    recurrence_id: datetime,
    data: NativeEventUpdateIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    """Edits (or, on first touch, creates) a single occurrence's exception
    — spec §19.1 "attendee exceptions." `recurrence_id` is the occurrence's
    original scheduled start instant, as returned by the occurrences list.
    `rrule` on the body is ignored: one occurrence is never itself a
    series."""
    try:
        out = await native_events.update_event(
            db, ctx, version_chain_id=version_chain_id, recurrence_id=recurrence_id,
            title=data.title, start_at=data.start_at, end_at=data.end_at, timezone_name=data.timezone_name,
            description=data.description, location=data.location, attendees=data.attendees,
            resources=data.resources, confidentiality_class=data.confidentiality_class,
        )
    except DomainError as e:
        raise _to_http(e) from e
    return NativeEventOut(**out)


@router.delete("/native-events/{version_chain_id}/occurrences/{recurrence_id}", response_model=NativeEventOut)
async def delete_native_event_occurrence(
    version_chain_id: str,
    recurrence_id: datetime,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    """Cancels a single occurrence without affecting the rest of the series."""
    try:
        out = await native_events.delete_event(db, ctx, version_chain_id=version_chain_id, recurrence_id=recurrence_id)
    except DomainError as e:
        raise _to_http(e) from e
    return NativeEventOut(**out)


@router.delete("/native-events/{version_chain_id}", response_model=NativeEventOut)
async def delete_native_event(
    version_chain_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        out = await native_events.delete_event(db, ctx, version_chain_id=version_chain_id)
    except DomainError as e:
        raise _to_http(e) from e
    return NativeEventOut(**out)


@router.post("/native-events/{version_chain_id}/restore", response_model=NativeEventOut)
async def restore_native_event(
    version_chain_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        out = await native_events.restore_previous_version(db, ctx, version_chain_id=version_chain_id)
    except DomainError as e:
        raise _to_http(e) from e
    return NativeEventOut(**out)


@router.post("/native-events/proposals/{item_id}/approve", response_model=NativeEventOut)
async def approve_native_event_proposal(
    item_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    """Combines the generic Action Review Queue approval with the calendar-
    specific executor: action_review.approve() only marks the queue item
    approved (it doesn't know what a calendar event is), so this endpoint —
    calendar_service's own, per its "the producing feature builds the
    executor" responsibility — does both steps in one call, satisfying
    spec's "approving the queue item performs the actual creation.\""""
    try:
        await action_review.approve(db, ctx, item_id)
        event = await native_events.create_event_from_approved_proposal(db, ctx, item_id)
    except DomainError as e:
        raise _to_http(e) from e
    return NativeEventOut(**event)


# ── Resources (rooms/equipment) — Phase 2 slice 5 ───────────────────────────

_RESOURCE_TYPE = Literal["room", "equipment"]
assert set(_RESOURCE_TYPE.__args__) == set(RESOURCE_TYPES)


class ResourceIn(BaseModel):
    name: str
    type: _RESOURCE_TYPE = "room"


class ResourceOut(BaseModel):
    id: str
    name: str
    type: str
    created_by: int
    created_at: datetime | None


class ResourceConflictOut(BaseModel):
    event_title: str | None
    start_at: datetime
    end_at: datetime


def _resource_to_out(r) -> ResourceOut:
    return ResourceOut(id=r.id, name=r.name, type=r.type, created_by=r.created_by, created_at=r.created_at)


@router.post("/resources", response_model=ResourceOut, status_code=201)
def create_resource(
    data: ResourceIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        resource = resources.create_resource(db, ctx, name=data.name, type=data.type)
    except DomainError as e:
        raise _to_http(e) from e
    return _resource_to_out(resource)


@router.get("/resources", response_model=list[ResourceOut])
def list_resources(
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    return [_resource_to_out(r) for r in resources.list_resources(db, ctx)]


@router.get("/resources/{resource_id}", response_model=ResourceOut)
def get_resource(
    resource_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        resource = resources.get_resource(db, ctx, resource_id)
    except DomainError as e:
        raise _to_http(e) from e
    return _resource_to_out(resource)


@router.get("/resources/{resource_id}/conflicts", response_model=list[ResourceConflictOut])
def get_resource_conflicts(
    resource_id: str,
    start_at: datetime = Query(...),
    end_at: datetime = Query(...),
    exclude_version_chain_id: str | None = Query(default=None),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    """Advisory — does not block booking. A caller can check before
    submitting, and/or read this same data back from create/update's own
    response if it included the resource in its booking."""
    try:
        conflicts = resources.check_resource_conflicts(
            db, ctx, resource_id=resource_id, start_at=start_at, end_at=end_at,
            exclude_version_chain_id=exclude_version_chain_id,
        )
    except DomainError as e:
        raise _to_http(e) from e
    return [ResourceConflictOut(**c) for c in conflicts]


# ── Team calendar — Phase 2 slice 5 ─────────────────────────────────────────

@router.get("/team-calendar", response_model=list[OccurrenceOut])
def get_team_calendar(
    range_start: datetime = Query(...),
    range_end: datetime = Query(...),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    """A saved query over the caller's team's events, not a materialized
    calendar — see team_calendar.py. Confidential events owned by someone
    else than the caller are redacted to a bare busy block."""
    occurrences = team_calendar.list_team_calendar(db, ctx, range_start=range_start, range_end=range_end)
    return [OccurrenceOut(**o) for o in occurrences]
