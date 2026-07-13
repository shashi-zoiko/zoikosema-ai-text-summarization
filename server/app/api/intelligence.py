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

from app.api.admin import _is_admin
from app.core.ai import ai_generate_intelligence, groq_summarize_transcript
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
    INTEL_SOURCE_TRANSCRIPT,
    ROLE_HOST,
    ROLE_COHOST,
)
from app.models.user import User
from app.schemas.meeting import IntelligenceEditIn, IntelligenceGenerateIn, MeetingIntelligenceOut

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


def _is_host_or_platform_admin(meeting: Meeting, user: User) -> bool:
    """Strict gate for transcript-sourced summaries — host or platform admin
    ONLY, deliberately excluding co-hosts and other participants (per the
    product ask: not visible to other viewers). Unlike `_is_host_or_cohost`,
    this never touches the DB (no MeetingParticipant lookup needed)."""
    return meeting.host_id == user.id or _is_admin(user)


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
    transcript: list[dict] | None = None,
    language: str = "english",
) -> MeetingIntelligence:
    """Core generation pipeline used by both the API endpoint and the
    auto-trigger after recording upload.

    Always inserts a fresh row so history is preserved; sets status to
    `ready` or `failed` based on the AI call outcome.

    Branches on `transcript`: when present (the post-meeting spoken
    transcript, posted by the client when the host leaves), calls Groq via
    `groq_summarize_transcript` and stores `{title, summary, key_takeaways}`
    with `source=INTEL_SOURCE_TRANSCRIPT`. Otherwise runs the existing
    chat-log → Claude path with `source=INTEL_SOURCE_CHAT`, unchanged.
    """
    is_transcript = bool(transcript)

    if not is_transcript:
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
        source=INTEL_SOURCE_TRANSCRIPT if is_transcript else INTEL_SOURCE_CHAT,
    )
    db.add(intel)
    db.commit()
    db.refresh(intel)

    if is_transcript:
        result = groq_summarize_transcript(transcript=transcript, meeting_title=meeting.title, language=language)
    else:
        result = ai_generate_intelligence(
            chat_log=chat_log,
            meeting_title=meeting.title,
            participants=participants,
            duration_seconds=duration_seconds,
            language=language,
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
        # Chat-based payloads have `tldr`; transcript-based ones have `title`
        # instead — either way this column is the cheap-list-view headline.
        headline = result.get("tldr") or result.get("title") or ""
        intel.tldr = headline[:1000] or None

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
    """Return the most recent intelligence row for the meeting, or null.

    Access is source-aware: transcript-sourced rows (the post-meeting Groq
    summary) are host/admin-only — not visible to co-hosts or other
    participants — while chat-sourced rows keep the original any-participant
    read access. We fetch the row first since the check depends on it.
    """
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    rec = db.scalar(
        select(MeetingIntelligence)
        .where(MeetingIntelligence.meeting_id == meeting.id)
        .order_by(desc(MeetingIntelligence.created_at))
        .limit(1)
    )
    if not rec:
        if not _has_access(meeting, user, db):
            raise HTTPException(status_code=403, detail="Not a participant of this meeting")
        return None

    if rec.source == INTEL_SOURCE_TRANSCRIPT:
        if not _is_host_or_platform_admin(meeting, user):
            raise HTTPException(status_code=403, detail="Only the host or an admin can view this summary")
    elif not _has_access(meeting, user, db):
        raise HTTPException(status_code=403, detail="Not a participant of this meeting")

    return _intel_to_out(rec, meeting)


@router.post("/{code}/intelligence", response_model=MeetingIntelligenceOut, status_code=201)
def generate_intelligence(
    code: str,
    data: IntelligenceGenerateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Generate (or return cached) intelligence for a meeting.

    Two independent paths, chosen by whether `data.transcript` is present:
      - Transcript path (post-meeting spoken transcript → Groq): host or
        platform admin ONLY — stricter than the chat path below, per the
        product ask that this summary is not visible to other viewers.
        Always generates fresh (no cache short-circuit — this only ever
        fires once, automatically, when the host leaves).
      - Chat path (unchanged): `data.chat_log` if supplied, else the latest
        recording's chat_log file. Hosts + co-hosts can generate; plain
        participants can re-fetch but not regenerate, to prevent token-burn
        from arbitrary attendees. Cached short-circuit within
        `_CACHE_SECONDS` unless `force=true`.
    """
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if data.transcript:
        if not _is_host_or_platform_admin(meeting, user):
            raise HTTPException(status_code=403, detail="Only the host or an admin can generate this summary")
        intel = run_generation(
            db,
            meeting,
            chat_log=None,
            participants=None,
            requested_by_id=user.id,
            transcript=data.transcript,
            language=data.language,
        )
        return _intel_to_out(intel, meeting)

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
                MeetingIntelligence.source == INTEL_SOURCE_CHAT,
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
        language=data.language,
    )
    return _intel_to_out(intel, meeting)


@router.patch("/{code}/intelligence", response_model=MeetingIntelligenceOut)
def edit_intelligence(
    code: str,
    data: IntelligenceEditIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Edit the latest transcript-sourced summary's fields in place (no new
    row — this corrects the existing one). Host/admin-only, same gate as
    generating and reading a transcript-sourced summary.

    Only chat-sourced meetings have no transcript-sourced row to edit yet —
    404s rather than silently editing the wrong kind of row.
    """
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    if not _is_host_or_platform_admin(meeting, user):
        raise HTTPException(status_code=403, detail="Only the host or an admin can edit this summary")

    rec = db.scalar(
        select(MeetingIntelligence)
        .where(
            MeetingIntelligence.meeting_id == meeting.id,
            MeetingIntelligence.source == INTEL_SOURCE_TRANSCRIPT,
        )
        .order_by(desc(MeetingIntelligence.created_at))
        .limit(1)
    )
    if not rec:
        raise HTTPException(status_code=404, detail="No transcript summary to edit")

    payload = dict(rec.payload or {})
    if data.title is not None:
        payload["title"] = data.title
        rec.tldr = data.title[:1000] or None
    if data.summary is not None:
        payload["summary"] = data.summary
    if data.key_takeaways is not None:
        payload["key_takeaways"] = data.key_takeaways
    rec.payload = payload

    db.commit()
    db.refresh(rec)
    return _intel_to_out(rec, meeting)


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


# ── Action items (cross-meeting aggregation) ───────────────────────────────
# Action items aren't a table of their own — they're generated per meeting and
# live inside each MeetingIntelligence.payload["action_items"]. The Actions page
# flattens them across every meeting the caller hosted or joined.
actions_router = APIRouter(prefix="/api/action-items", tags=["action-items"])

_PRIORITY_ORDER = {"high": 0, "med": 1, "medium": 1, "low": 2}


@actions_router.get("")
def list_action_items(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Every action item across the caller's meetings, high-priority first.

    ponytail: naive per-request scan of the caller's ready intelligence rows,
    no pagination. Fine for a personal action list; add a materialized
    action_items table + paging if a workspace ever has thousands of meetings.
    """
    hosted = db.scalars(select(Meeting.id).where(Meeting.host_id == user.id)).all()
    joined = db.scalars(
        select(MeetingParticipant.meeting_id).where(MeetingParticipant.user_id == user.id)
    ).all()
    meeting_ids = set(hosted) | set(joined)
    if not meeting_ids:
        return []

    # Newest ready row per meeting: rows come back newest-first, so the first
    # one seen for a meeting_id is the latest.
    ready = db.scalars(
        select(MeetingIntelligence)
        .where(
            MeetingIntelligence.meeting_id.in_(meeting_ids),
            MeetingIntelligence.status == INTEL_STATUS_READY,
        )
        .order_by(desc(MeetingIntelligence.created_at))
    ).all()
    latest_by_meeting: dict[int, MeetingIntelligence] = {}
    for r in ready:
        latest_by_meeting.setdefault(r.meeting_id, r)
    if not latest_by_meeting:
        return []

    meetings = {
        m.id: m
        for m in db.scalars(
            select(Meeting).where(Meeting.id.in_(latest_by_meeting.keys()))
        ).all()
    }

    out: list[dict] = []
    for mid, rec in latest_by_meeting.items():
        m = meetings.get(mid)
        for idx, it in enumerate((rec.payload or {}).get("action_items") or []):
            if not isinstance(it, dict) or not (it.get("task") or "").strip():
                continue
            when = (m.scheduled_at or m.created_at) if m else None
            out.append({
                "id": f"{rec.id}:{idx}",
                "task": it.get("task"),
                "owner": it.get("owner"),
                "due": it.get("due"),
                "priority": (it.get("priority") or "med").lower(),
                "depends_on": it.get("depends_on"),
                "meeting_code": m.code if m else None,
                "meeting_title": (m.title if m else None) or "Meeting",
                "meeting_date": when.isoformat() if when else None,
            })

    # Priority-major, newest-meeting-minor. Stable sort keeps the date order.
    out.sort(key=lambda a: a["meeting_date"] or "", reverse=True)
    out.sort(key=lambda a: _PRIORITY_ORDER.get(a["priority"], 1))
    return out
