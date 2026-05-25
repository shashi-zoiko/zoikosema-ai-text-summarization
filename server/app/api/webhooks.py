"""LiveKit webhook receiver.

LiveKit POSTs signed events to /api/webhooks/livekit. We use these to:
  - flip MeetingParticipant.status when a participant disconnects from the SFU
  - mark a Meeting inactive when the SFU closes the room
  - (future) close out recording rows when egress finishes

The signature is verified against LIVEKIT_API_SECRET; unsigned/forged requests
return 401 without touching the DB.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.meeting import (
    Meeting,
    MeetingParticipant,
    MeetingRecording,
    REC_STATUS_FAILED,
    REC_STATUS_READY,
    STATUS_ADMITTED,
    STATUS_DISCONNECTED,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


def _user_id_from_identity(identity: str | None) -> int | None:
    # We mint tokens with identity = f"u:{user_id}" — see livekit_provider.py.
    if not identity or not identity.startswith("u:"):
        return None
    try:
        return int(identity[2:])
    except ValueError:
        return None


def _handle_participant_left(db: Session, room: str, identity: str | None) -> None:
    uid = _user_id_from_identity(identity)
    if uid is None:
        return
    meeting = db.scalar(select(Meeting).where(Meeting.media_room_ref == room))
    if not meeting:
        return
    p = db.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == uid,
        )
    )
    if not p or p.status != STATUS_ADMITTED:
        return
    p.status = STATUS_DISCONNECTED
    p.last_seen_at = datetime.now(timezone.utc)
    db.commit()


def _handle_room_finished(db: Session, room: str) -> None:
    meeting = db.scalar(select(Meeting).where(Meeting.media_room_ref == room))
    if not meeting:
        return
    if meeting.is_active:
        meeting.is_active = False
        meeting.ended_at = datetime.now(timezone.utc)
    # Clear the room ref either way — the SFU has GCed it.
    meeting.media_room_ref = None
    db.commit()


def _handle_egress_ended(db: Session, event) -> None:
    """The egress_ended webhook carries the EgressInfo in `egress_info`. Find
    the matching recording row and flip its status based on success."""
    info = getattr(event, "egress_info", None)
    if info is None:
        return
    egress_id = getattr(info, "egress_id", None)
    if not egress_id:
        return
    rec = db.scalar(select(MeetingRecording).where(MeetingRecording.egress_id == egress_id))
    if not rec:
        return
    # EgressStatus: 0=STARTING, 1=ACTIVE, 2=ENDING, 3=COMPLETE, 4=FAILED, 5=ABORTED, 6=LIMIT_REACHED
    status_int = getattr(info, "status", 0)
    success = status_int == 3  # EGRESS_COMPLETE
    rec.status = REC_STATUS_READY if success else REC_STATUS_FAILED
    # Pull duration if present (microseconds on EgressInfo)
    duration_us = getattr(info, "duration", 0)
    if duration_us:
        rec.duration = int(duration_us / 1_000_000)
    # File size — file_results[0].size on success
    try:
        file_results = list(getattr(info, "file_results", []) or [])
        if file_results:
            size = getattr(file_results[0], "size", None)
            if size:
                rec.file_size = int(size)
    except Exception:
        pass
    db.commit()


@router.post("/livekit")
async def livekit_webhook(request: Request):
    settings = get_settings()
    if settings.media_provider.lower() != "livekit":
        raise HTTPException(status_code=503, detail="LiveKit not configured")

    # Signature verification — the receiver expects the raw body + Authorization
    # header (LiveKit sends a JWT signed with the API secret).
    auth_header = request.headers.get("Authorization", "")
    body_bytes = await request.body()

    from livekit.api import TokenVerifier, WebhookReceiver  # lazy import

    verifier = TokenVerifier(settings.livekit_api_key, settings.livekit_api_secret)
    receiver = WebhookReceiver(verifier)
    try:
        event = receiver.receive(body_bytes.decode("utf-8"), auth_header)
    except Exception as e:
        log.warning("rejected livekit webhook: %s", e)
        raise HTTPException(status_code=401, detail="invalid webhook signature") from e

    kind = event.event
    # protobuf-default-empty messages aren't truthy via `if event.room` — they
    # exist with empty fields. Always check `.name` / `.identity` directly.
    room = event.room.name if (event.room and event.room.name) else None
    identity = (
        event.participant.identity
        if (event.participant and event.participant.identity)
        else None
    )
    log.info("livekit webhook: event=%s room=%s identity=%s", kind, room, identity)

    db = SessionLocal()
    try:
        if kind == "participant_left" and room:
            _handle_participant_left(db, room, identity)
        elif kind == "room_finished" and room:
            _handle_room_finished(db, room)
        elif kind == "egress_ended":
            # egress_* events carry the room *inside* egress_info, not at the
            # top level — don't gate on `room`.
            _handle_egress_ended(db, event)
        # room_started / participant_joined / track_* / egress_started / egress_updated
        # are logged only.
    finally:
        db.close()

    return {"ok": True}
