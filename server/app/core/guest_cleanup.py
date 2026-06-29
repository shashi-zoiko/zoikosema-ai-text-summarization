"""Lifecycle management for ephemeral guest accounts.

Guest `users` rows are created by the public /guest-token endpoint and must not
accumulate. Two reclamation paths:

1. Immediate — when a meeting ends, purge that meeting's guests (their
   MeetingParticipant rows cascade away with the FK ondelete).
2. Periodic — a background loop sweeps guests whose `guest_expires_at` has
   passed, a backstop for sessions that crashed before the meeting formally
   ended.

A guest User is referenced by rows in other tables (meeting_participants and,
once a guest opens the notes panel, meeting_private_notes). The
`meeting_participants.user_id` FK has NO database-level ON DELETE CASCADE, so a
bare `DELETE FROM users` is rejected by Postgres ("Key (id)=… is still
referenced from table meeting_participants"). We therefore delete the dependent
rows explicitly first, then the user. This is DB-agnostic (works on SQLite test
DBs too) and doesn't rely on an ORM relationship cascade that isn't configured.
"""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.meeting import MeetingParticipant
from app.models.private_note import PrivateNote
from app.models.user import User

log = logging.getLogger(__name__)


def _delete_guest_users(db: Session, guest_ids: list[int]) -> int:
    """Delete the given guest users and every row that references them.

    Clears dependent rows (meeting_participants, meeting_private_notes) before
    the users themselves so no foreign key blocks the delete. Issues all
    statements on the caller's session WITHOUT committing — the caller controls
    the transaction boundary. Returns the number of user rows removed.
    """
    ids = list({uid for uid in guest_ids if uid is not None})
    if not ids:
        return 0
    db.execute(delete(MeetingParticipant).where(MeetingParticipant.user_id.in_(ids)))
    db.execute(delete(PrivateNote).where(PrivateNote.user_id.in_(ids)))
    result = db.execute(
        delete(User).where(User.id.in_(ids), User.is_guest.is_(True))
    )
    return result.rowcount or 0


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
    removed = _delete_guest_users(db, list(guest_ids))
    if removed:
        log.info("[GUEST_CLEANUP] meeting=%s purged_guests=%s", meeting_id, removed)
    return removed


def purge_expired_guests(db: Session) -> int:
    """Delete guest users whose TTL has elapsed. Backstop for crashed sessions."""
    now = datetime.now(timezone.utc)
    expired_ids = db.scalars(
        select(User.id).where(
            User.is_guest.is_(True),
            User.guest_expires_at.is_not(None),
            User.guest_expires_at < now,
        )
    ).all()
    removed = _delete_guest_users(db, list(expired_ids))
    if removed:
        db.commit()
        log.info("[GUEST_CLEANUP] periodic purge removed=%s", removed)
    return removed


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
