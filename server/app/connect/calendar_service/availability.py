"""L1 scheduling suggestion — free/busy slot computation, read-only.

Spec §4 L1 ("Suggest"): the agent suggests times, the human still creates
the meeting. This function only reads; it never writes a row, logs an
audit event, or emits anything, because nothing is being mutated or
governed here — there is no agent action yet, only a computed suggestion.

Busy time comes from two sources that don't share a model:
  - connect_calendar_events (synced from Google/Outlook) has real start/end.
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

from app.connect.calendar_service.models import CalendarEvent
from app.connect.shared.tenant import TenantContext
from app.core.config import get_settings
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

    # Clamp every interval to the window: an unclamped interval that starts
    # after day_end (or ends before day_start) would otherwise let the loop
    # below emit a slot whose end/start falls outside [day_start, day_end].
    busy = [
        (max(s, day_start), min(e, day_end))
        for s, e in _busy_intervals(db, ctx, day_start, day_end)
    ]
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

    intervals.extend(_zoikotime_busy_intervals(db, ctx, day_start, day_end))
    return intervals


def _zoikotime_busy_intervals(
    db: DbSession, ctx: TenantContext, day_start: datetime, day_end: datetime,
) -> list[tuple[datetime, datetime]]:
    """ZoikoTime workforce-truth availability signal (spec §6.1: shift
    off-hours, approved leave/OOO, rest windows) — read-only visibility only,
    per §6.1's own phasing note ("read-only visibility Phase 1; hard
    enforcement Phase 2+"). Gated behind ZOIKOTIME_INTEGRATION_ENABLED
    (default off).

    Always returns [] today: no WorkforceSignal data source exists yet in
    this repo — that's plans/zoikotime-workforce-signal-integration.md's
    scope, a separate cross-repo plan with its own webhook receiver and
    table. This function is the intended seam: once that table exists,
    swapping this body for a real query is a small follow-up, because the
    merge loop above already treats whatever this returns like any other
    busy-interval source — no redesign needed then. With the flag off (the
    only real state until that lands), this is a no-op passthrough with
    zero behavior change.
    """
    if not get_settings().zoikotime_integration_enabled:
        return []
    return []  # no data source wired yet — see docstring
