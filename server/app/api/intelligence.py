"""Meeting intelligence — structured AI summary endpoints.

Endpoints under `/api/meetings/{code}/intelligence` generate and fetch the
post-meeting analysis produced by `core/ai.ai_generate_intelligence`. We tie
intelligence to the *meeting* (not the recording) so it survives recording
deletion and so meetings without a saved recording can still be analyzed
from an inline chat log.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.orm import Session

from app.core.ai import ai_generate_intelligence
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.meeting import (
    Meeting,
    MeetingParticipant,
    MeetingRecording,
    MeetingIntelligence,
    INTEL_STATUS_GENERATING,
    INTEL_STATUS_READY,
    INTEL_STATUS_FAILED,
    INTEL_SOURCE_CHAT,
    ROLE_HOST,
    ROLE_COHOST,
)
from app.models.user import User
from app.schemas.meeting import IntelligenceGenerateIn, MeetingIntelligenceOut

router = APIRouter(prefix="/api/meetings", tags=["intelligence"])

# Reuse the recordings dir to resolve chat_log files saved at recording time.
RECORDINGS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "recordings"
)

# Cache window: if a ready record was generated within this many seconds and
# the caller didn't pass force=true, return the cached one instead of burning
# tokens on a fresh run.
_CACHE_SECONDS = 60


def _has_access(meeting: Meeting, user: User, db: Session) -> bool:
    """Anyone who hosted or participated in the meeting can read intelligence."""
    if meeting.host_id == user.id:
        return True
    row = db.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == user.id,
        )
    )
    return row is not None


def _is_host_or_cohost(meeting: Meeting, user: User, db: Session) -> bool:
    if meeting.host_id == user.id:
        return True
    row = db.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == user.id,
            MeetingParticipant.role.in_([ROLE_HOST, ROLE_COHOST]),
        )
    )
    return row is not None


def _intel_to_out(rec: MeetingIntelligence, meeting: Meeting) -> dict:
    return {
        "id": rec.id,
        "meeting_id": rec.meeting_id,
        "recording_id": rec.recording_id,
        "requested_by_id": rec.requested_by_id,
        "status": rec.status,
        "source": rec.source,
        "model_used": rec.model_used,
        "tldr": rec.tldr,
        "payload": rec.payload,
        "input_tokens": rec.input_tokens,
        "output_tokens": rec.output_tokens,
        "latency_ms": rec.latency_ms,
        "error_message": rec.error_message,
        "created_at": rec.created_at,
        "completed_at": rec.completed_at,
        "meeting_code": meeting.code,
        "meeting_title": meeting.title,
    }


def _resolve_participants(meeting: Meeting, db: Session) -> list[dict]:
    """Build a name+role snapshot from the meeting participants table."""
    rows = db.scalars(
        select(MeetingParticipant).where(MeetingParticipant.meeting_id == meeting.id)
    ).all()
    out = []
    for p in rows:
        u = db.get(User, p.user_id)
        out.append({"name": u.name if u else f"User {p.user_id}", "role": p.role})
    return out


def run_generation(
    db: Session,
    meeting: Meeting,
    *,
    chat_log: list[dict] | None,
    participants: list[dict] | None,
    requested_by_id: int | None,
    recording: MeetingRecording | None = None,
) -> MeetingIntelligence:
    """Core generation pipeline used by both the API endpoint and the
    auto-trigger after recording upload.

    Always inserts a fresh row so history is preserved; sets status to
    `ready` or `failed` based on the AI call outcome.
    """
    if recording is None:
        recording = db.scalar(
            select(MeetingRecording)
            .where(MeetingRecording.meeting_id == meeting.id)
            .order_by(desc(MeetingRecording.created_at))
            .limit(1)
        )

    if chat_log is None or len(chat_log) == 0:
        chat_log = _load_chat_log_from_recording(recording) if recording else []
    if participants is None:
        participants = _resolve_participants(meeting, db)

    duration_seconds = recording.duration if recording else None

    intel = MeetingIntelligence(
        meeting_id=meeting.id,
        recording_id=recording.id if recording else None,
        requested_by_id=requested_by_id,
        status=INTEL_STATUS_GENERATING,
        source=INTEL_SOURCE_CHAT,
    )
    db.add(intel)
    db.commit()
    db.refresh(intel)

    result = ai_generate_intelligence(
        chat_log=chat_log,
        meeting_title=meeting.title,
        participants=participants,
        duration_seconds=duration_seconds,
    )

    intel.completed_at = datetime.now(timezone.utc)
    intel.model_used = result.pop("_model", None)
    intel.input_tokens = result.pop("_input_tokens", None)
    intel.output_tokens = result.pop("_output_tokens", None)
    intel.latency_ms = result.pop("_latency_ms", None)
    err = result.pop("_error", None)
    if err:
        intel.status = INTEL_STATUS_FAILED
        intel.error_message = err
        intel.payload = result
        intel.tldr = None
    else:
        intel.status = INTEL_STATUS_READY
        intel.payload = result
        intel.tldr = (result.get("tldr") or "")[:1000] or None

    db.commit()
    db.refresh(intel)
    return intel


def generate_for_recording_id(recording_id: int) -> None:
    """Entry point safe to call from a `BackgroundTasks` task.

    Opens its own DB session because the originating request's session has
    already closed by the time the task runs. Failures are swallowed (logged
    upstream by ai_generate_intelligence) so a transient AI outage never
    crashes the worker.
    """
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        rec = db.get(MeetingRecording, recording_id)
        if not rec:
            return
        meeting = db.get(Meeting, rec.meeting_id)
        if not meeting:
            return
        run_generation(
            db,
            meeting,
            chat_log=None,
            participants=None,
            requested_by_id=rec.user_id,
            recording=rec,
        )
    except Exception:
        # The pipeline already persists `failed` rows for AI errors; a bare
        # exception here means something below the AI layer (DB outage,
        # serialization) blew up. Swallow so the task queue keeps running.
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


def _load_chat_log_from_recording(rec: MeetingRecording) -> list[dict]:
    """Read the saved chat_log JSON for a recording, returning [] on any error.

    Chat logs are saved as JSON arrays at upload time (see api/recordings.py).
    Older recordings may be missing the file on disk after retention cleanup.
    """
    if not rec or not rec.chat_log_url:
        return []
    fname = rec.chat_log_url.rsplit("/", 1)[-1]
    fpath = os.path.join(RECORDINGS_DIR, fname)
    if not os.path.exists(fpath):
        return []
    try:
        with open(fpath, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("messages"), list):
            return data["messages"]
    except Exception:
        return []
    return []


@router.get("/{code}/intelligence", response_model=MeetingIntelligenceOut | None)
def get_intelligence(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the most recent intelligence row for the meeting, or null."""
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if not _has_access(meeting, user, db):
        raise HTTPException(status_code=403, detail="Not a participant of this meeting")

    rec = db.scalar(
        select(MeetingIntelligence)
        .where(MeetingIntelligence.meeting_id == meeting.id)
        .order_by(desc(MeetingIntelligence.created_at))
        .limit(1)
    )
    if not rec:
        return None
    return _intel_to_out(rec, meeting)


@router.post("/{code}/intelligence", response_model=MeetingIntelligenceOut, status_code=201)
def generate_intelligence(
    code: str,
    data: IntelligenceGenerateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Generate (or return cached) intelligence for a meeting.

    Source resolution:
      1. `data.chat_log` if supplied (typical: client posts the in-memory log
         right after the meeting ends).
      2. The latest recording's chat_log file on disk.

    Hosts + co-hosts can always generate. Plain participants can re-fetch but
    not regenerate, to prevent token-burn from arbitrary attendees.
    """
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if not _has_access(meeting, user, db):
        raise HTTPException(status_code=403, detail="Not a participant of this meeting")
    if not _is_host_or_cohost(meeting, user, db):
        raise HTTPException(
            status_code=403, detail="Only hosts and co-hosts can generate intelligence"
        )

    # Cached-recent short-circuit unless force=true.
    if not data.force:
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=_CACHE_SECONDS)
        cached = db.scalar(
            select(MeetingIntelligence)
            .where(
                MeetingIntelligence.meeting_id == meeting.id,
                MeetingIntelligence.status == INTEL_STATUS_READY,
                MeetingIntelligence.created_at >= cutoff,
            )
            .order_by(desc(MeetingIntelligence.created_at))
            .limit(1)
        )
        if cached:
            return _intel_to_out(cached, meeting)

    intel = run_generation(
        db,
        meeting,
        chat_log=data.chat_log,
        participants=data.participants,
        requested_by_id=user.id,
    )
    return _intel_to_out(intel, meeting)


@router.get("/{code}/intelligence/history", response_model=list[MeetingIntelligenceOut])
def list_intelligence_history(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """All intelligence runs for this meeting, newest first. Useful for
    debugging or comparing how a re-run changed the analysis."""
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if not _has_access(meeting, user, db):
        raise HTTPException(status_code=403, detail="Not a participant of this meeting")

    rows = db.scalars(
        select(MeetingIntelligence)
        .where(MeetingIntelligence.meeting_id == meeting.id)
        .order_by(desc(MeetingIntelligence.created_at))
        .limit(25)
    ).all()
    return [_intel_to_out(r, meeting) for r in rows]
