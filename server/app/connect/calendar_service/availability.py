"""L1 scheduling suggestion — free/busy slot computation, read-only.

Spec §4 L1 ("Suggest"): the agent suggests times, the human still creates
the meeting. This function only reads; it never writes a row, logs an
audit event, or emits anything, because nothing is being mutated or
governed here — there is no agent action yet, only a computed suggestion.

Busy time comes from three sources that don't share a model:
  - connect_calendar_events (synced from Google/Outlook) has real start/end.
  - connect_native_calendar_events (Sema-authoritative, Phase 2 slice 3) —
    recurring series are expanded via native_events.list_occurrences(),
    the same function calendar display uses, so "is this instant busy" and
    "what does the calendar show" can never disagree about what a series
    actually produced (one expansion engine, not two).
  - legacy `meetings` (Zoiko Meet calls) only stores `scheduled_at`, no
    duration — a live call's actual length isn't known ahead of time. We
    approximate each scheduled, non-cancelled meeting as occupying
    DEFAULT_MEETING_DURATION_MINUTES. This is a stated approximation, not a
    real end time; if it causes bad suggestions in practice, the fix is
    adding a real duration/end estimate to Meeting, not tweaking this file.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_, datetime, time, timedelta, timezone

from sqlalchemy.orm import Session as DbSession

from app.connect.calendar_service import native_events
from app.connect.calendar_service import resources as resources_module
from app.connect.calendar_service import zoikotime_signal
from app.connect.calendar_service.models import CalendarEvent
from app.connect.shared.tenant import TenantContext
from app.models.meeting import Meeting

DEFAULT_MEETING_DURATION_MINUTES = 60


@dataclass(frozen=True)
class FreeSlot:
    start_at: datetime
    end_at: datetime


def suggest_available_slots(
    db: DbSession, ctx: TenantContext, *,
    on_date: date_, duration_minutes: int, day_start_hour: int = 9, day_end_hour: int = 18,
) -> list[FreeSlot]:
    day_start = datetime.combine(on_date, time(hour=day_start_hour), tzinfo=timezone.utc)
    day_end = datetime.combine(on_date, time(hour=day_end_hour), tzinfo=timezone.utc)
    if day_start >= day_end:
        return []
    return slots_from_busy(day_start, day_end, duration_minutes, _busy_intervals(db, ctx, day_start, day_end))


def suggest_group_available_slots(
    db: DbSession, ctx: TenantContext, *,
    on_date: date_, duration_minutes: int,
    attendee_user_ids: list[int], resource_ids: list[str] | None = None,
    day_start_hour: int = 9, day_end_hour: int = 18,
) -> list[FreeSlot]:
    """Multi-attendee, multi-resource generalization of suggest_available_slots
    — spec §6.1/§11's Scheduling Engine constraint solver, Phase 2 slice 6.
    A slot is returned only if every attendee AND every resource is free for
    the whole duration; each subject's own busy intervals still come from
    the exact same per-source computation suggest_available_slots uses
    (_busy_intervals for people, resources.resource_busy_intervals for
    resources) — this is the merge generalized across subjects, not a
    parallel algorithm."""
    day_start = datetime.combine(on_date, time(hour=day_start_hour), tzinfo=timezone.utc)
    day_end = datetime.combine(on_date, time(hour=day_end_hour), tzinfo=timezone.utc)
    if day_start >= day_end:
        return []

    busy: list[tuple[datetime, datetime]] = []
    for user_id in attendee_user_ids:
        member_ctx = TenantContext(user_id=user_id, tenant_id=ctx.tenant_id, role=ctx.role)
        busy.extend(_busy_intervals(db, member_ctx, day_start, day_end))
    for resource_id in resource_ids or []:
        busy.extend(resources_module.resource_busy_intervals(db, ctx, resource_id, day_start, day_end))

    return slots_from_busy(day_start, day_end, duration_minutes, busy)


def slots_from_busy(
    day_start: datetime, day_end: datetime, duration_minutes: int,
    busy_intervals: list[tuple[datetime, datetime]],
) -> list[FreeSlot]:
    """The merge/gap-finding algorithm itself — pure, no DB access, shared
    by both the single-subject and multi-subject suggesters so there is
    exactly one place this logic can have a bug, not two copies that could
    drift (see CONTEXT.md §8 for the clamp-to-window bug this same
    algorithm already had once)."""
    # Clamp every interval to the window: an unclamped interval that starts
    # after day_end (or ends before day_start) would otherwise let the loop
    # below emit a slot whose end/start falls outside [day_start, day_end].
    busy = [(max(s, day_start), min(e, day_end)) for s, e in busy_intervals]
    busy = [(s, e) for s, e in busy if s < e]
    busy.sort(key=lambda iv: iv[0])

    slots: list[FreeSlot] = []
    cursor = day_start
    duration = timedelta(minutes=duration_minutes)
    for busy_start, busy_end in busy:
        if busy_start - cursor >= duration:
            slots.append(FreeSlot(start_at=cursor, end_at=busy_start))
        cursor = max(cursor, busy_end)
    if day_end - cursor >= duration:
        slots.append(FreeSlot(start_at=cursor, end_at=day_end))
    return slots


def _busy_intervals(
    db: DbSession, ctx: TenantContext, day_start: datetime, day_end: datetime,
) -> list[tuple[datetime, datetime]]:
    intervals: list[tuple[datetime, datetime]] = []

    synced = (
        db.query(CalendarEvent)
        .filter(
            CalendarEvent.tenant_id == ctx.tenant_id,
            CalendarEvent.user_id == ctx.user_id,
            CalendarEvent.status != "cancelled",
            CalendarEvent.start_at < day_end,
            CalendarEvent.end_at > day_start,
        )
        .all()
    )
    for e in synced:
        if e.start_at and e.end_at:
            intervals.append((e.start_at, e.end_at))

    default_duration = timedelta(minutes=DEFAULT_MEETING_DURATION_MINUTES)
    zoiko_meetings = (
        db.query(Meeting)
        .filter(
            Meeting.host_id == ctx.user_id,
            Meeting.cancelled_at.is_(None),
            Meeting.scheduled_at.isnot(None),
            Meeting.scheduled_at < day_end,
        )
        .all()
    )
    for m in zoiko_meetings:
        start = m.scheduled_at
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        end = start + default_duration
        if end > day_start:
            intervals.append((start, end))

    intervals.extend(_native_event_busy_intervals(db, ctx, day_start, day_end))
    intervals.extend(zoikotime_signal.zoikotime_busy_intervals(db, ctx, day_start, day_end))
    return intervals


def _native_event_busy_intervals(
    db: DbSession, ctx: TenantContext, day_start: datetime, day_end: datetime,
) -> list[tuple[datetime, datetime]]:
    """Sema-authoritative native events (Phase 2 slice 3/4). Recurring
    series are expanded through native_events.list_occurrences() — the same
    function calendar display calls — rather than re-deriving occurrence
    instants here, so this can never drift from what the calendar actually
    shows for that series."""
    intervals: list[tuple[datetime, datetime]] = []
    for event in native_events.list_events(db, ctx):
        if event.status == "cancelled":
            continue
        if event.rrule:
            for occ in native_events.list_occurrences(
                db, ctx, version_chain_id=event.version_chain_id, range_start=day_start, range_end=day_end,
            ):
                intervals.append((datetime.fromisoformat(occ["start_at"]), datetime.fromisoformat(occ["end_at"])))
        elif event.start_at < day_end and event.end_at > day_start:
            intervals.append((event.start_at, event.end_at))
    return intervals
