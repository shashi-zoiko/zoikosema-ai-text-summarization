"""Stale-meeting reaper.

A meeting's ``is_active`` flag is only cleared on three explicit paths: the host
ends it, the host cancels a scheduled meeting, or LiveKit's ``room_finished``
webhook fires. An *abandoned* instant meeting — everyone just closes the tab and
nobody clicks "End" — hits none of those, so ``is_active`` stays ``True`` forever.
The dashboard then renders it with a "Live" badge days later and clicking it
routes users back toward the (long-dead) room. See dashboard "Meeting history".

This loop closes that gap. Every tick it marks as ended any meeting that is still
flagged live but has had no connected participant for a good while. It's the same
shape as ``meeting_reminders`` / ``guest_cleanup`` / ``recording_cleanup``: one
asyncio task started in the app lifespan doing its blocking DB work inside
``asyncio.to_thread`` so the event loop is never stalled.

Liveness signal
---------------
``MeetingParticipant.status == ADMITTED`` is the authoritative "currently
connected" flag — the signaling layer flips it to DISCONNECTED/LEFT the moment a
WS drops or someone leaves. ``last_seen_at`` is NOT refreshed on a heartbeat, so
for a long live connection it stays at join time; we therefore rely on ADMITTED
status for "someone is here right now" and only use ``last_seen_at`` (which *is*
stamped at disconnect) to measure how long a room has been empty.

A meeting is reaped when it is active, not cancelled, not a scheduled meeting that
hasn't had a fair chance to start, AND either:
  * nobody is ADMITTED and the last activity was over ``REAP_IDLE_MINUTES`` ago
    (the common abandoned-instant-meeting case), or
  * its last activity is older than ``STUCK_HOURS`` — a backstop for the rare
    crash that leaves a participant wedged in ADMITTED on a dead instance.
Both branches are deliberately conservative: a meeting anyone is genuinely still
sitting in always has an ADMITTED row, so a live call is never ended out from
under its participants.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, func, or_
from sqlalchemy.exc import ProgrammingError, OperationalError

from app.core.database import SessionLocal
from app.models.meeting import Meeting, MeetingParticipant, STATUS_ADMITTED

log = logging.getLogger(__name__)

# How long a room may sit with nobody connected before we call it ended. A real
# reconnect after a network drop never takes this long, so we won't end a meeting
# out from under a transient blip.
REAP_IDLE_MINUTES = 60
# Backstop for a crashed instance that left a participant stuck in ADMITTED: end
# the meeting once its last activity is this old regardless of status. Set well
# beyond any realistic single sitting so a genuinely long event is never reaped.
STUCK_HOURS = 24
# A scheduled meeting is given this long past its start time before it's eligible,
# so we never mark one ended while the host is still on their way in.
SCHEDULED_GRACE_HOURS = 12
# How often the loop wakes to sweep for stale meetings.
CHECK_INTERVAL_SECONDS = 300


def reap_stale_meetings() -> int:
    """End every meeting that is flagged live but has clearly concluded.

    Returns the number of meetings reaped this pass. Synchronous (runs in a
    worker thread); never raises for a single meeting — it commits the whole
    sweep at once.
    """
    now = datetime.now(timezone.utc)
    idle_cutoff = now - timedelta(minutes=REAP_IDLE_MINUTES)
    stuck_cutoff = now - timedelta(hours=STUCK_HOURS)
    scheduled_cutoff = now - timedelta(hours=SCHEDULED_GRACE_HOURS)

    with SessionLocal() as db:
        # Is anyone connected right now? ADMITTED is point-in-time truth.
        has_admitted = (
            select(MeetingParticipant.id)
            .where(
                MeetingParticipant.meeting_id == Meeting.id,
                MeetingParticipant.status == STATUS_ADMITTED,
            )
            .correlate(Meeting)
            .exists()
        )
        # When was this room last touched? Falls back to created_at for a meeting
        # nobody ever joined (no participant rows).
        last_activity = func.coalesce(
            select(func.max(MeetingParticipant.last_seen_at))
            .where(MeetingParticipant.meeting_id == Meeting.id)
            .correlate(Meeting)
            .scalar_subquery(),
            Meeting.created_at,
        )

        meetings = db.scalars(
            select(Meeting).where(
                Meeting.is_active.is_(True),
                Meeting.cancelled_at.is_(None),
                # Not a scheduled meeting still waiting to (or just about to) start.
                or_(
                    Meeting.scheduled_at.is_(None),
                    Meeting.scheduled_at <= scheduled_cutoff,
                ),
                or_(
                    # Nobody connected and the room has been quiet a good while.
                    ~has_admitted & (last_activity < idle_cutoff),
                    # Crash backstop: ancient regardless of status.
                    last_activity < stuck_cutoff,
                ),
            )
        ).all()

        for m in meetings:
            m.is_active = False
            if m.ended_at is None:
                m.ended_at = now
            # The SFU room is long gone if nobody's been here for an hour; drop
            # the dangling handle so it can't be mistaken for a live room.
            m.media_room_ref = None

        if meetings:
            db.commit()
        return len(meetings)


async def meeting_reaper_loop() -> None:
    """Async loop: reap stale meetings every CHECK_INTERVAL_SECONDS."""
    interval = max(60, CHECK_INTERVAL_SECONDS)
    log.info(
        "meeting reaper loop started (idle=%dm, stuck=%dh, interval=%ds)",
        REAP_IDLE_MINUTES,
        STUCK_HOURS,
        interval,
    )
    while True:
        try:
            reaped = await asyncio.to_thread(reap_stale_meetings)
            if reaped:
                log.info("meeting reaper: ended %d stale meeting(s)", reaped)
        except asyncio.CancelledError:
            raise
        except (ProgrammingError, OperationalError) as exc:
            # Cold start: init_db may not have created the tables yet. Retry next
            # tick instead of logging a stack trace.
            log.info(
                "meeting reaper: tables not ready yet (%s); will retry",
                exc.__class__.__name__,
            )
        except Exception:
            log.exception("meeting reaper sweep failed")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
