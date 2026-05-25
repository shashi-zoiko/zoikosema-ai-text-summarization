import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import ProgrammingError, OperationalError

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.meeting import MeetingRecording

log = logging.getLogger(__name__)

RECORDINGS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "recordings"
)


def _remove_file_by_url(file_url: str | None) -> None:
    if not file_url:
        return
    fname = file_url.rsplit("/", 1)[-1]
    # Guard against traversal — only delete flat files inside RECORDINGS_DIR.
    if not fname or "/" in fname or "\\" in fname or fname in (".", ".."):
        return
    fpath = os.path.join(RECORDINGS_DIR, fname)
    try:
        if os.path.isfile(fpath):
            os.remove(fpath)
    except OSError as exc:
        log.warning("recording cleanup: failed to remove %s: %s", fpath, exc)


def purge_expired_recordings(retention_days: int) -> int:
    """Delete recordings (DB + files) older than retention_days. Returns count purged."""
    if retention_days <= 0:
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    purged = 0
    with SessionLocal() as db:
        expired = db.scalars(
            select(MeetingRecording).where(MeetingRecording.created_at < cutoff)
        ).all()
        for rec in expired:
            _remove_file_by_url(rec.file_url)
            _remove_file_by_url(rec.chat_log_url)
            db.delete(rec)
            purged += 1
        if purged:
            db.commit()
    return purged


async def recording_cleanup_loop() -> None:
    settings = get_settings()
    retention = settings.recording_retention_days
    interval = max(60, settings.recording_cleanup_interval_seconds)

    if retention <= 0:
        log.info("recording cleanup disabled (retention_days=%d)", retention)
        return

    log.info(
        "recording cleanup loop started (retention=%dd, interval=%ds)",
        retention,
        interval,
    )
    while True:
        try:
            purged = await asyncio.to_thread(purge_expired_recordings, retention)
            if purged:
                log.info("recording cleanup purged %d expired recordings", purged)
        except asyncio.CancelledError:
            raise
        except (ProgrammingError, OperationalError) as exc:
            # Cold start: init_db (running in another worker thread) may not
            # have created meeting_recordings yet. Wait for it on the next tick
            # rather than spamming a stack trace.
            log.info("recording cleanup: tables not ready yet (%s); will retry", exc.__class__.__name__)
        except Exception:
            log.exception("recording cleanup sweep failed")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
