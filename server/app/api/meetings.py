import csv
import io
import logging
import secrets
import string
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, desc, and_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.connect.media_service import service as media
from app.websocket import signaling as ws_signaling
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import hash_password, verify_password

log = logging.getLogger(__name__)
from app.models.meeting import (
    Meeting,
    MeetingParticipant,
    ROLE_HOST,
    ROLE_COHOST,
    ROLE_PARTICIPANT,
    STATUS_PENDING,
    STATUS_ADMITTED,
    STATUS_DISCONNECTED,
    STATUS_DENIED,
    STATUS_KICKED,
    STATUS_LEFT,
)
from app.models.user import User
from app.schemas.meeting import (
    MeetingCreate,
    MeetingUpdate,
    MeetingOut,
    ParticipantOut,
    MeetingRoster,
    JoinMeetingIn,
    ParticipantActionIn,
)

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


def _generate_code() -> str:
    alphabet = string.ascii_lowercase
    groups = [
        "".join(secrets.choice(alphabet) for _ in range(3)),
        "".join(secrets.choice(alphabet) for _ in range(4)),
        "".join(secrets.choice(alphabet) for _ in range(3)),
    ]
    return "-".join(groups)


def _meeting_out(meeting: Meeting) -> dict:
    """Convert a Meeting to MeetingOut-compatible dict with password_protected."""
    return {
        "id": meeting.id,
        "code": meeting.code,
        "title": meeting.title,
        "host_id": meeting.host_id,
        "is_active": meeting.is_active,
        "scheduled_at": meeting.scheduled_at,
        "timezone_name": meeting.timezone_name,
        "waiting_room_enabled": meeting.waiting_room_enabled,
        "locked": meeting.locked,
        "chat_enabled": meeting.chat_enabled,
        "screenshare_enabled": meeting.screenshare_enabled,
        "password_protected": meeting.password_hash is not None,
        "media_provider": meeting.media_provider or "mesh",
        "created_at": meeting.created_at,
        "ended_at": meeting.ended_at,
    }


def _get_meeting_or_404(code: str, db: Session) -> Meeting:
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


def _require_host_or_cohost(meeting: Meeting, user: User, db: Session) -> MeetingParticipant | None:
    """Return the caller's participant row if they are host or co-host, else 403."""
    if meeting.host_id == user.id:
        return None  # creator is always host even without a participant row
    participant = db.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == user.id,
            MeetingParticipant.role == ROLE_COHOST,
        )
    )
    if not participant:
        raise HTTPException(status_code=403, detail="Only the host or co-host can perform this action")
    return participant


# ── Create ──────────────────────────────────────────────────────────────────

@router.post("", response_model=MeetingOut, status_code=201)
def create_meeting(
    data: MeetingCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    for _ in range(5):
        code = _generate_code()
        if not db.scalar(select(Meeting).where(Meeting.code == code)):
            break
    else:
        raise HTTPException(status_code=500, detail="Could not allocate meeting code")
    # Default the per-meeting media plane to the global setting at create time.
    # Existing meetings remain on whatever they were last set to (e.g. "mesh"
    # for everything pre-migration). Future per-meeting overrides can be added
    # to the create schema if/when we expose a UI toggle.
    default_provider = (get_settings().media_provider or "mesh").lower()
    meeting = Meeting(
        code=code,
        title=data.title or "Instant meeting",
        host_id=user.id,
        scheduled_at=data.scheduled_at,
        timezone_name=data.timezone_name,
        waiting_room_enabled=data.waiting_room_enabled,
        password_hash=hash_password(data.password) if data.password else None,
        media_provider=default_provider if default_provider in ("mesh", "livekit") else "mesh",
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return _meeting_out(meeting)


# ── Read ────────────────────────────────────────────────────────────────────

@router.get("/recent", response_model=list[MeetingOut])
def recent_meetings(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    stmt = (
        select(Meeting)
        .where(Meeting.host_id == user.id)
        .order_by(desc(Meeting.created_at))
        .limit(10)
    )
    return [_meeting_out(m) for m in db.scalars(stmt).all()]


@router.get("/{code}", response_model=MeetingOut)
def get_meeting(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return _meeting_out(_get_meeting_or_404(code, db))


# ── Update ──────────────────────────────────────────────────────────────────

@router.patch("/{code}", response_model=MeetingOut)
def update_meeting(
    code: str,
    data: MeetingUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    _require_host_or_cohost(meeting, user, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(meeting, field, value)
    db.commit()
    db.refresh(meeting)
    return _meeting_out(meeting)


# ── End ─────────────────────────────────────────────────────────────────────

@router.post("/{code}/end", response_model=MeetingOut)
async def end_meeting(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    if meeting.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only host can end the meeting")
    meeting.is_active = False
    meeting.ended_at = datetime.now(timezone.utc)

    # Tear down the LiveKit room so any zombie participants are disconnected
    # and the SFU reclaims the slot immediately. We swallow errors — the DB
    # is the source of truth for "meeting ended"; LiveKit will GC anyway.
    room_ref = meeting.media_room_ref
    meeting.media_room_ref = None
    db.commit()
    db.refresh(meeting)

    if room_ref:
        try:
            await media.release_media_room(room_ref)
        except Exception:
            log.exception("release_media_room failed for %s", room_ref)

    return _meeting_out(meeting)


# ── Media token (LiveKit join) ──────────────────────────────────────────────

class MediaTokenOut(BaseModel):
    access_token: str
    ws_url: str
    room: str
    identity: str
    expires_at: int


@router.post("/{code}/media-token", response_model=MediaTokenOut)
async def issue_media_token(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Issue a short-lived LiveKit JWT for the caller.

    Caller must already be an ADMITTED participant (created by POST /join).
    Lazy-provisions the LiveKit room on first call.
    """
    settings = get_settings()
    if settings.media_provider.lower() != "livekit":
        # The lobby falls back to the mesh room when this 503s and the
        # meeting's media_provider is not 'livekit'; this only fires when
        # someone deep-links /room-lk on a deployment that hasn't enabled
        # the SFU yet. Keep the detail actionable so the failure mode
        # surfaces in admin/support tickets instead of a generic 500.
        raise HTTPException(
            status_code=503,
            detail=(
                "LiveKit is not enabled in this environment. "
                "Set MEDIA_PROVIDER=livekit + LIVEKIT_* credentials on the "
                "server (see infra/livekit/README.md) to enable the SFU room."
            ),
        )

    meeting = _get_meeting_or_404(code, db)
    if not meeting.is_active:
        raise HTTPException(status_code=410, detail="Meeting has ended")

    # `.scalars().first()` not `.scalar()` — see join_meeting for context:
    # the table has no UNIQUE(meeting_id, user_id) constraint, and a
    # historical duplicate row would otherwise raise MultipleResultsFound.
    participant = db.scalars(
        select(MeetingParticipant)
        .where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == user.id,
        )
        .order_by(desc(MeetingParticipant.id))
    ).first()
    if not participant:
        raise HTTPException(status_code=403, detail="Call POST /join first")
    if participant.status != STATUS_ADMITTED:
        raise HTTPException(
            status_code=403,
            detail=f"Participant status is '{participant.status}', not 'admitted'",
        )

    # Lazy-allocate the LiveKit room ref + create on SFU
    if not meeting.media_room_ref:
        # tenant_id is the host's user id for now; switch to org_id when
        # multi-org meetings ship.
        ref = await media.create_media_room(
            session_id=meeting.code, tenant_id=str(meeting.host_id)
        )
        meeting.media_room_ref = ref
        db.commit()
        db.refresh(meeting)

    await media.ensure_media_room(meeting.media_room_ref)

    token = await media.generate_token(
        media_room_ref=meeting.media_room_ref,
        user_id=user.id,
        display_name=user.name,
        role=participant.role,
    )

    # Public WS URL the browser dials. server-side LIVEKIT_WS_URL points at
    # the container (ws://livekit:7880); the browser needs the host URL.
    public_ws = (
        getattr(settings, "livekit_public_ws_url", None)
        or settings.livekit_ws_url.replace("livekit:7880", "localhost:7880")
    )

    return MediaTokenOut(
        access_token=token.access_token,
        ws_url=public_ws,
        room=token.room_name,
        identity=token.identity,
        expires_at=token.expires_at,
    )


# ── Recording (LiveKit Egress) ──────────────────────────────────────────────

class RecordingStateOut(BaseModel):
    recording: bool
    recording_id: int | None
    egress_id: str | None


def _active_recording(meeting: Meeting, db: Session):
    from app.models.meeting import MeetingRecording, REC_STATUS_RECORDING
    return db.scalar(
        select(MeetingRecording).where(
            MeetingRecording.meeting_id == meeting.id,
            MeetingRecording.status == REC_STATUS_RECORDING,
            MeetingRecording.egress_id.is_not(None),
        )
    )


@router.get("/{code}/recording", response_model=RecordingStateOut)
def recording_state(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    rec = _active_recording(meeting, db)
    if rec is None:
        return RecordingStateOut(recording=False, recording_id=None, egress_id=None)
    return RecordingStateOut(recording=True, recording_id=rec.id, egress_id=rec.egress_id)


@router.post("/{code}/recording/start", response_model=RecordingStateOut)
async def recording_start(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host kicks off a RoomCompositeEgress writing to /out/<code>-<uuid>.mp4
    inside the LiveKit egress container. The file ends up on the shared
    zoiko_recordings volume so the FastAPI side can serve it after egress
    finishes (see webhooks.py / egress_ended)."""
    import uuid as _uuid

    settings = get_settings()
    if settings.media_provider.lower() != "livekit":
        raise HTTPException(status_code=503, detail="recording requires livekit provider")

    meeting = _get_meeting_or_404(code, db)
    if meeting.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only the host can start recording")
    if not meeting.media_room_ref:
        raise HTTPException(status_code=409, detail="Meeting has no active media room")

    if _active_recording(meeting, db):
        raise HTTPException(status_code=409, detail="Recording already in progress")

    from app.models.meeting import MeetingRecording, REC_STATUS_RECORDING

    # Egress runs inside the livekit-egress container which mounts the same
    # /out volume that FastAPI mounts at /app/recordings — so a path of
    # /out/foo.mp4 in egress is /app/recordings/foo.mp4 to us.
    fname = f"{meeting.code}-{_uuid.uuid4().hex[:10]}.mp4"
    egress_path = f"/out/{fname}"
    file_url = f"/api/recordings/files/{fname}"

    try:
        egress_id = await media.start_recording(
            media_room_ref=meeting.media_room_ref,
            file_path=egress_path,
        )
    except Exception as e:
        log.exception("egress start failed")
        raise HTTPException(status_code=502, detail=f"egress start failed: {e}") from e

    rec = MeetingRecording(
        meeting_id=meeting.id,
        user_id=user.id,
        file_url=file_url,
        file_name=fname,
        status=REC_STATUS_RECORDING,
        egress_id=egress_id,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    # Tell everyone in the room recording is live so non-host clients show the
    # REC indicator + a notification (the host's own UI updates locally).
    await ws_signaling.broadcast_event(
        code, {"type": "recording", "recording": True, "recording_id": rec.id, "by": user.id}
    )
    return RecordingStateOut(recording=True, recording_id=rec.id, egress_id=rec.egress_id)


@router.post("/{code}/recording/stop", response_model=RecordingStateOut)
async def recording_stop(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    if meeting.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only the host can stop recording")

    rec = _active_recording(meeting, db)
    if rec is None:
        return RecordingStateOut(recording=False, recording_id=None, egress_id=None)

    try:
        await media.stop_recording(rec.egress_id)
    except Exception as e:
        log.exception("egress stop failed")
        raise HTTPException(status_code=502, detail=f"egress stop failed: {e}") from e

    # Status is flipped to READY by the egress_ended webhook once the file is
    # finalized on disk. We don't touch it here — the egress process is still
    # writing the moov atom.
    await ws_signaling.broadcast_event(
        code, {"type": "recording", "recording": False, "recording_id": None, "by": user.id}
    )
    return RecordingStateOut(recording=True, recording_id=rec.id, egress_id=rec.egress_id)


# ── Join (waiting-room aware) ───────────────────────────────────────────────

@router.post("/{code}/join", response_model=ParticipantOut, status_code=200)
def join_meeting(
    code: str,
    data: JoinMeetingIn | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    try:
        meeting = _get_meeting_or_404(code, db)

        if not meeting.is_active:
            raise HTTPException(status_code=410, detail="Meeting has ended")

        if meeting.locked and meeting.host_id != user.id:
            raise HTTPException(status_code=403, detail="Meeting is locked")

        # Meeting password check (host is exempt)
        if meeting.password_hash and meeting.host_id != user.id:
            provided = data.password if data else None
            if not provided or not verify_password(provided, meeting.password_hash):
                raise HTTPException(status_code=403, detail="Incorrect meeting password")

        # Check for existing participant row (reconnection). Use `.first()`
        # instead of `.scalar()` because the table has no UNIQUE
        # (meeting_id, user_id) constraint — historical duplicate rows
        # (race on first join, or pre-fix data) would otherwise raise
        # MultipleResultsFound and bubble up as an opaque 500.
        existing = db.scalars(
            select(MeetingParticipant)
            .where(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.user_id == user.id,
            )
            .order_by(desc(MeetingParticipant.id))
        ).first()

        if existing:
            if existing.status in (STATUS_DENIED, STATUS_KICKED):
                raise HTTPException(status_code=403, detail="You have been removed from this meeting")
            if existing.status in (STATUS_ADMITTED, STATUS_DISCONNECTED):
                # Reconnect: mark admitted again
                existing.status = STATUS_ADMITTED
                existing.last_seen_at = datetime.now(timezone.utc)
                existing.left_at = None
                db.commit()
                db.refresh(existing)
                return existing
            if existing.status == STATUS_LEFT:
                # Re-joining after voluntarily leaving — treat like new join
                existing.status = STATUS_PENDING if meeting.waiting_room_enabled and meeting.host_id != user.id else STATUS_ADMITTED
                existing.last_seen_at = datetime.now(timezone.utc)
                existing.left_at = None
                db.commit()
                db.refresh(existing)
                return existing
            # STATUS_PENDING — still waiting
            return existing

        # New participant
        is_host = meeting.host_id == user.id
        status = STATUS_ADMITTED if is_host or not meeting.waiting_room_enabled else STATUS_PENDING
        role = ROLE_HOST if is_host else ROLE_PARTICIPANT

        participant = MeetingParticipant(
            meeting_id=meeting.id,
            user_id=user.id,
            role=role,
            status=status,
        )
        db.add(participant)
        try:
            db.commit()
        except IntegrityError:
            # Concurrent first-join from the same user (double-click on
            # "Join now", or a fast lobby retry) can race two INSERTs. The
            # loser's commit fails; recover by reading the winner's row.
            db.rollback()
            participant = db.scalars(
                select(MeetingParticipant)
                .where(
                    MeetingParticipant.meeting_id == meeting.id,
                    MeetingParticipant.user_id == user.id,
                )
                .order_by(desc(MeetingParticipant.id))
            ).first()
            if participant is None:
                raise HTTPException(status_code=500, detail="Could not join meeting")
            return participant
        db.refresh(participant)
        return participant
    except HTTPException:
        raise
    except SQLAlchemyError:
        # Surface DB problems with a logged traceback so future 500s on this
        # path show up in Cloud Run logs instead of an opaque "HTTP 500" chip
        # on the lobby.
        log.exception("join_meeting DB error (code=%s user=%s)", code, getattr(user, "id", None))
        db.rollback()
        raise HTTPException(status_code=500, detail="Could not join meeting — please retry")
    except Exception:
        log.exception("join_meeting unexpected error (code=%s user=%s)", code, getattr(user, "id", None))
        raise HTTPException(status_code=500, detail="Could not join meeting — please retry")


# ── Roster (participants list) ──────────────────────────────────────────────

@router.get("/{code}/participants", response_model=MeetingRoster)
def get_participants(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    participants = db.scalars(
        select(MeetingParticipant).where(MeetingParticipant.meeting_id == meeting.id)
    ).all()

    roster = []
    for p in participants:
        u = db.get(User, p.user_id)
        roster.append({
            "id": p.id,
            "user_id": p.user_id,
            "name": u.name if u else "Unknown",
            "avatar_color": u.avatar_color if u else "#5b8def",
            "role": p.role,
            "status": p.status,
            "joined_at": p.joined_at.isoformat() if p.joined_at else None,
            "left_at": p.left_at.isoformat() if p.left_at else None,
        })

    return MeetingRoster(meeting=meeting, participants=roster)


# ── Host actions: admit / deny / kick / promote ────────────────────────────

@router.post("/{code}/admit", response_model=ParticipantOut)
async def admit_participant(
    code: str,
    data: ParticipantActionIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    _require_host_or_cohost(meeting, user, db)
    log.info("[ADMISSION_REQUEST] meeting=%s host=%s target=%s via=rest", meeting.id, user.id, data.user_id)

    # Latest row for this user (no UNIQUE(meeting_id,user_id) — see join_meeting).
    participant = db.scalars(
        select(MeetingParticipant)
        .where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == data.user_id,
        )
        .order_by(desc(MeetingParticipant.id))
    ).first()
    if not participant:
        raise HTTPException(status_code=404, detail="No pending participant found")

    # Idempotent: a double-click / retry against an already-admitted user must
    # not 404. Re-emit the realtime signal in case the first push was lost, and
    # return success so the host UI stays consistent.
    if participant.status == STATUS_ADMITTED:
        await ws_signaling.signal_admitted(meeting.id, data.user_id)
        return participant
    if participant.status != STATUS_PENDING:
        raise HTTPException(status_code=404, detail="No pending participant found")

    participant.status = STATUS_ADMITTED
    participant.last_seen_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(participant)
    log.info("[ADMIT_SUCCESS] meeting=%s target=%s", meeting.id, data.user_id)

    # Push instantly to the waiting socket + wake its hold loop, then refresh
    # the host roster. This is what makes admission < 1 s end-to-end with no
    # polling.
    await ws_signaling.signal_admitted(meeting.id, data.user_id)
    await ws_signaling.broadcast_waiting_list(code, meeting.id)
    return participant


class AdmitAllOut(BaseModel):
    admitted: list[int]


@router.post("/{code}/admit-all", response_model=AdmitAllOut)
async def admit_all(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Batch-admit every pending participant in one request. Fixes the old
    Admit-Everyone N+1 (N sequential REST round-trips)."""
    meeting = _get_meeting_or_404(code, db)
    _require_host_or_cohost(meeting, user, db)

    pending = db.scalars(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.status == STATUS_PENDING,
        )
    ).all()
    now = datetime.now(timezone.utc)
    admitted_ids = [p.user_id for p in pending]
    for p in pending:
        p.status = STATUS_ADMITTED
        p.last_seen_at = now
    db.commit()
    log.info("[ADMIT_SUCCESS] meeting=%s host=%s admit-all count=%s", meeting.id, user.id, len(admitted_ids))

    for uid in admitted_ids:
        await ws_signaling.signal_admitted(meeting.id, uid)
    await ws_signaling.broadcast_waiting_list(code, meeting.id)
    return AdmitAllOut(admitted=admitted_ids)


@router.post("/{code}/deny", response_model=ParticipantOut)
async def deny_participant(
    code: str,
    data: ParticipantActionIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    _require_host_or_cohost(meeting, user, db)

    participant = db.scalars(
        select(MeetingParticipant)
        .where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == data.user_id,
        )
        .order_by(desc(MeetingParticipant.id))
    ).first()
    if not participant or participant.status != STATUS_PENDING:
        raise HTTPException(status_code=404, detail="No pending participant found")

    participant.status = STATUS_DENIED
    db.commit()
    db.refresh(participant)

    await ws_signaling.signal_denied(meeting.id, data.user_id)
    await ws_signaling.broadcast_waiting_list(code, meeting.id)
    return participant


@router.post("/{code}/kick", response_model=ParticipantOut)
def kick_participant(
    code: str,
    data: ParticipantActionIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    _require_host_or_cohost(meeting, user, db)

    if data.user_id == meeting.host_id:
        raise HTTPException(status_code=403, detail="Cannot kick the host")

    participant = db.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == data.user_id,
            MeetingParticipant.status == STATUS_ADMITTED,
        )
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found or not admitted")

    participant.status = STATUS_KICKED
    participant.left_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(participant)
    return participant


# ── Attendance export (host-only CSV) ──────────────────────────────────────

@router.get("/{code}/attendance")
def export_attendance(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    if meeting.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only the host can export attendance")

    participants = db.scalars(
        select(MeetingParticipant)
        .where(MeetingParticipant.meeting_id == meeting.id)
        .order_by(MeetingParticipant.joined_at)
    ).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Name", "Email", "Role", "Status", "Joined At", "Left At", "Duration (seconds)"])
    for p in participants:
        u = db.get(User, p.user_id)
        end = p.left_at or p.last_seen_at
        duration = int((end - p.joined_at).total_seconds()) if (end and p.joined_at) else ""
        writer.writerow([
            u.name if u else "Unknown",
            u.email if u else "",
            p.role,
            p.status,
            p.joined_at.isoformat() if p.joined_at else "",
            p.left_at.isoformat() if p.left_at else "",
            duration,
        ])

    buf.seek(0)
    filename = f"attendance-{meeting.code}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{code}/promote", response_model=ParticipantOut)
def promote_participant(
    code: str,
    data: ParticipantActionIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    if meeting.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only the host can promote participants")

    participant = db.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == data.user_id,
            MeetingParticipant.status == STATUS_ADMITTED,
        )
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found or not admitted")

    participant.role = ROLE_COHOST if participant.role == ROLE_PARTICIPANT else ROLE_PARTICIPANT
    db.commit()
    db.refresh(participant)
    return participant
