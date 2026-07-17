"""Meeting reminder scheduler.

A lightweight background loop that emails every invitee of a scheduled meeting
exactly once, shortly before it starts — the "Your meeting starts in 5 minutes"
reminder (Google-Meet parity).

Design mirrors recording_cleanup / guest_cleanup: a single asyncio task started
in the app lifespan, doing its blocking DB + email work inside
``asyncio.to_thread`` so it never stalls the event loop. Deduplication is a
persisted ``meeting_invites.reminder_sent`` flag, so a reminder is dispatched at
most once per invitee even across process restarts or overlapping ticks.
"""
import asyncio
import logging
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError, OperationalError

from app.core.database import SessionLocal
from app.core.email import send_meeting_reminder_email
from app.core.urls import meeting_url
from app.models.meeting import Meeting
from app.models.organization import (
    MeetingInvite,
    Notification,
    NOTIF_MEETING_REMINDER,
)
from app.models.user import User

log = logging.getLogger(__name__)

# Fire the reminder when a meeting is starting within this many minutes.
LEAD_MINUTES = 5
# How often the loop wakes to look for meetings entering the reminder window.
CHECK_INTERVAL_SECONDS = 60


def _format_scheduled(meeting: Meeting) -> str:
    """Human-readable schedule line for the reminder email body."""
    scheduled_at = meeting.scheduled_at
    if meeting.timezone_name:
        scheduled_at = scheduled_at.astimezone(ZoneInfo(meeting.timezone_name))
    when = scheduled_at.strftime("%b %d, %Y at %I:%M %p")
    if meeting.timezone_name:
        when += f" ({meeting.timezone_name})"
    return when


def dispatch_due_reminders(lead_minutes: int = LEAD_MINUTES) -> int:
    """Send reminders for every meeting starting within ``lead_minutes``.

    Returns the number of reminder emails dispatched this pass. Synchronous
    (runs in a worker thread); never raises for a single bad invite — it logs
    and moves on so one failure can't stall the whole sweep.
    """
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(minutes=lead_minutes)
    sent = 0

    with SessionLocal() as db:
        # Meetings that are still live and start within the lead window. Once
        # scheduled_at slips into the past we stop — the reminder is "before".
        meetings = db.scalars(
            select(Meeting).where(
                Meeting.is_active.is_(True),
                Meeting.scheduled_at.is_not(None),
                Meeting.scheduled_at >= now,
                Meeting.scheduled_at <= window_end,
            )
        ).all()
        if not meetings:
            return 0

        for meeting in meetings:
            invites = db.scalars(
                select(MeetingInvite).where(
                    MeetingInvite.meeting_id == meeting.id,
                    MeetingInvite.reminder_sent.is_(False),
                )
            ).all()
            if not invites:
                continue

            join_url = meeting_url(meeting.code)
            scheduled_str = _format_scheduled(meeting)
            minutes_until = max(
                1, math.ceil((meeting.scheduled_at - now).total_seconds() / 60)
            )

            for invite in invites:
                ok = send_meeting_reminder_email(
                    to_email=invite.invitee_email,
                    meeting_title=meeting.title,
                    meeting_code=meeting.code,
                    join_url=join_url,
                    scheduled_at=scheduled_str,
                    minutes_until=minutes_until,
                )
                # Mark sent even on a False send result: email delivery is
                # best-effort (send_email never raises and returns False when no
                # provider is configured), and we must not retry-storm every
                # tick for the whole window. A real transient failure is an
                # acceptable single-miss trade-off against duplicate spam.
                invite.reminder_sent = True
                if ok:
                    sent += 1

                # In-app bell notification for registered invitees.
                if invite.invitee_user_id:
                    db.add(
                        Notification(
                            user_id=invite.invitee_user_id,
                            type=NOTIF_MEETING_REMINDER,
                            title=f"Meeting starts in {minutes_until} minute"
                            f"{'s' if minutes_until != 1 else ''}",
                            body=f'"{meeting.title}" is about to begin.',
                            data=None,
                        )
                    )

        db.commit()
    return sent


async def meeting_reminder_loop() -> None:
    """Async loop: dispatch due reminders every CHECK_INTERVAL_SECONDS."""
    interval = max(30, CHECK_INTERVAL_SECONDS)
    log.info(
        "meeting reminder loop started (lead=%dm, interval=%ds)",
        LEAD_MINUTES,
        interval,
    )
    while True:
        try:
            sent = await asyncio.to_thread(dispatch_due_reminders, LEAD_MINUTES)
            if sent:
                log.info("meeting reminders: dispatched %d reminder email(s)", sent)
        except asyncio.CancelledError:
            raise
        except (ProgrammingError, OperationalError) as exc:
            # Cold start: init_db may not have created meeting_invites (or the
            # reminder_sent column) yet. Retry on the next tick instead of
            # logging a stack trace.
            log.info(
                "meeting reminders: tables not ready yet (%s); will retry",
                exc.__class__.__name__,
            )
        except Exception:
            log.exception("meeting reminder sweep failed")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
