"""Lifecycle management for ephemeral guest accounts.

Guest `users` rows are created by the public /guest-token endpoint and must not
accumulate. Two reclamation paths:

1. Immediate — when a meeting ends, purge that meeting's guests (their
   MeetingParticipant rows cascade away with the FK ondelete).
2. Periodic — a background loop sweeps guests whose `guest_expires_at` has
   passed, a backstop for sessions that crashed before the meeting formally
   ended.

Deleting a guest User cascades its meeting_participants rows (FK ON DELETE
CASCADE). We delete guests individually (not a bulk DELETE) so SQLAlchemy issues
the participant cascade and we stay correct even where the DB-level cascade
isn't present (e.g. SQLite test DBs).
"""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.meeting import MeetingParticipant
from app.models.user import User

log = logging.getLogger(__name__)


def purge_meeting_guests(meeting_id: int, db: Session) -> int:
    """Delete all guest users who participated in a (now-ended) meeting.

    Operates within the caller's session/transaction; the caller commits.
    Returns the number of guest users removed.
    """
    guest_ids = db.scalars(
        select(MeetingParticipant.user_id)
        .join(User, User.id == MeetingParticipant.user_id)
        .where(
            MeetingParticipant.meeting_id == meeting_id,
            User.is_guest.is_(True),
        )
    ).all()
    removed = 0
    for uid in set(guest_ids):
        guest = db.get(User, uid)
        if guest is not None and guest.is_guest:
            db.delete(guest)  # participant rows cascade
            removed += 1
    if removed:
        log.info("[GUEST_CLEANUP] meeting=%s purged_guests=%s", meeting_id, removed)
    return removed


def purge_expired_guests(db: Session) -> int:
    """Delete guest users whose TTL has elapsed. Backstop for crashed sessions."""
    now = datetime.now(timezone.utc)
    expired = db.scalars(
        select(User).where(
            User.is_guest.is_(True),
            User.guest_expires_at.is_not(None),
            User.guest_expires_at < now,
        )
    ).all()
    for guest in expired:
        db.delete(guest)  # participant rows cascade
    if expired:
        db.commit()
        log.info("[GUEST_CLEANUP] periodic purge removed=%s", len(expired))
    return len(expired)


def _purge_expired_guests_threadsafe() -> int:
    """Open a fresh session (in the worker thread) and purge expired guests."""
    db = SessionLocal()
    try:
        return purge_expired_guests(db)
    finally:
        db.close()


async def guest_cleanup_loop() -> None:
    """Background task: periodically purge expired guest accounts."""
    settings = get_settings()
    interval = max(int(getattr(settings, "recording_cleanup_interval_seconds", 3600)), 300)
    while True:
        try:
            await asyncio.sleep(interval)
            await asyncio.to_thread(_purge_expired_guests_threadsafe)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("guest_cleanup_loop iteration failed")
