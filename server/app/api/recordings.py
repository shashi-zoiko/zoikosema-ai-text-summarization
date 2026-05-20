import os
import secrets
import uuid
import json
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select, desc
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.meeting import (
    Meeting,
    MeetingRecording,
    REC_STATUS_READY,
    REC_STATUS_FAILED,
)
from app.models.user import User
from app.schemas.meeting import RecordingOut, RecordingShareOut

router = APIRouter(prefix="/api/recordings", tags=["recordings"])

RECORDINGS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "recordings")
os.makedirs(RECORDINGS_DIR, exist_ok=True)

MAX_RECORDING_SIZE = 500 * 1024 * 1024  # 500 MB


def _recording_to_out(rec: MeetingRecording, db: Session) -> dict:
    """Single-recording serializer. The list endpoints call `_serialize_many`
    instead which batches the meeting + user lookups."""
    meeting = db.get(Meeting, rec.meeting_id)
    user = db.get(User, rec.user_id)
    return {
        **{c.name: getattr(rec, c.name) for c in rec.__table__.columns},
        "meeting_code": meeting.code if meeting else None,
        "meeting_title": meeting.title if meeting else None,
        "recorder_name": user.name if user else None,
    }


def _serialize_many(recs: list[MeetingRecording], db: Session) -> list[dict]:
    """Batch-load related meetings + users in two queries total instead of
    2 per recording. For a 50-row recordings list this drops 100 round trips
    to 2."""
    if not recs:
        return []
    meeting_ids = {r.meeting_id for r in recs}
    user_ids = {r.user_id for r in recs}
    meetings = {
        m.id: m for m in db.scalars(select(Meeting).where(Meeting.id.in_(meeting_ids))).all()
    }
    users = {
        u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids))).all()
    }
    out = []
    for rec in recs:
        m = meetings.get(rec.meeting_id)
        u = users.get(rec.user_id)
        out.append({
            **{c.name: getattr(rec, c.name) for c in rec.__table__.columns},
            "meeting_code": m.code if m else None,
            "meeting_title": m.title if m else None,
            "recorder_name": u.name if u else None,
        })
    return out


# ── Upload recording ─────────────────────────────────────────────────────

@router.post("/upload", response_model=RecordingOut, status_code=201)
async def upload_recording(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    meeting_code: str = Form(...),
    duration: int = Form(0),
    include_chat: bool = Form(False),
    chat_log: str = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = db.scalar(select(Meeting).where(Meeting.code == meeting_code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    # Stream the upload to disk in 1 MB chunks. Previously the whole body was
    # held in memory via `await file.read()` — for a 500 MB max-size upload
    # that's 500 MB of RAM per concurrent uploader. The streaming form caps
    # peak RSS at one chunk size and aborts/deletes early when the limit is
    # exceeded so we never write a partial 500 MB file to disk.
    ext = os.path.splitext(file.filename or "recording.webm")[1] or ".webm"
    safe_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(RECORDINGS_DIR, safe_name)

    CHUNK = 1024 * 1024
    total = 0
    try:
        with open(file_path, "wb") as f:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_RECORDING_SIZE:
                    f.close()
                    try:
                        os.unlink(file_path)
                    except OSError:
                        pass
                    raise HTTPException(status_code=413, detail="Recording too large (max 500 MB)")
                f.write(chunk)
    except HTTPException:
        raise
    except Exception:
        # Don't leave half-written files around if something else blows up.
        try:
            os.unlink(file_path)
        except OSError:
            pass
        raise

    # Save chat log if provided
    chat_log_url = None
    if include_chat and chat_log:
        chat_name = f"{uuid.uuid4().hex}.json"
        chat_path = os.path.join(RECORDINGS_DIR, chat_name)
        with open(chat_path, "w", encoding="utf-8") as f:
            f.write(chat_log)
        chat_log_url = f"/api/recordings/files/{chat_name}"

    recording = MeetingRecording(
        meeting_id=meeting.id,
        user_id=user.id,
        file_url=f"/api/recordings/files/{safe_name}",
        file_name=file.filename or "recording.webm",
        file_size=total,
        duration=duration,
        includes_chat=include_chat,
        chat_log_url=chat_log_url,
        status=REC_STATUS_READY,
    )
    db.add(recording)
    db.commit()
    db.refresh(recording)

    # Fire-and-forget structured intelligence generation when we have a chat
    # log to analyze. Import is local so removing the intelligence module
    # later wouldn't break upload.
    if include_chat and chat_log:
        from app.api.intelligence import generate_for_recording_id
        background_tasks.add_task(generate_for_recording_id, recording.id)

    return _recording_to_out(recording, db)


# ── List my recordings ───────────────────────────────────────────────────

@router.get("", response_model=list[RecordingOut])
def list_recordings(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    recs = db.scalars(
        select(MeetingRecording)
        .where(MeetingRecording.user_id == user.id)
        .order_by(desc(MeetingRecording.created_at))
        .limit(50)
    ).all()
    return _serialize_many(recs, db)


# ── List recordings for a specific meeting ────────────────────────────────

@router.get("/meeting/{code}", response_model=list[RecordingOut])
def list_meeting_recordings(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    recs = db.scalars(
        select(MeetingRecording)
        .where(MeetingRecording.meeting_id == meeting.id)
        .order_by(desc(MeetingRecording.created_at))
    ).all()
    return _serialize_many(recs, db)


# ── Get single recording ─────────────────────────────────────────────────

@router.get("/{recording_id}", response_model=RecordingOut)
def get_recording(
    recording_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rec = db.get(MeetingRecording, recording_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")
    return _recording_to_out(rec, db)


# ── Delete recording ─────────────────────────────────────────────────────

@router.delete("/{recording_id}", status_code=204)
def delete_recording(
    recording_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rec = db.get(MeetingRecording, recording_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")
    if rec.user_id != user.id:
        meeting = db.get(Meeting, rec.meeting_id)
        if not meeting or meeting.host_id != user.id:
            raise HTTPException(status_code=403, detail="Only the recorder or meeting host can delete")

    # Remove files from disk
    if rec.file_url:
        fname = rec.file_url.split("/")[-1]
        fpath = os.path.join(RECORDINGS_DIR, fname)
        if os.path.exists(fpath):
            os.remove(fpath)
    if rec.chat_log_url:
        cname = rec.chat_log_url.split("/")[-1]
        cpath = os.path.join(RECORDINGS_DIR, cname)
        if os.path.exists(cpath):
            os.remove(cpath)

    db.delete(rec)
    db.commit()


# ── Generate share link ──────────────────────────────────────────────────

@router.post("/{recording_id}/share", response_model=RecordingOut)
def share_recording(
    recording_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rec = db.get(MeetingRecording, recording_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")
    if rec.user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the recorder can share")

    if not rec.share_token:
        rec.share_token = secrets.token_urlsafe(32)
        db.commit()
        db.refresh(rec)

    return _recording_to_out(rec, db)


# ── Revoke share link ────────────────────────────────────────────────────

@router.delete("/{recording_id}/share", response_model=RecordingOut)
def unshare_recording(
    recording_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rec = db.get(MeetingRecording, recording_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")
    if rec.user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the recorder can manage sharing")

    rec.share_token = None
    db.commit()
    db.refresh(rec)
    return _recording_to_out(rec, db)


# ── Public access via share token ─────────────────────────────────────────

@router.get("/shared/{token}", response_model=RecordingShareOut)
def get_shared_recording(
    token: str,
    db: Session = Depends(get_db),
):
    rec = db.scalar(
        select(MeetingRecording).where(MeetingRecording.share_token == token)
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found or link expired")

    meeting = db.get(Meeting, rec.meeting_id)
    user = db.get(User, rec.user_id)
    return {
        **{c.name: getattr(rec, c.name) for c in rec.__table__.columns},
        "meeting_title": meeting.title if meeting else None,
        "recorder_name": user.name if user else None,
    }
