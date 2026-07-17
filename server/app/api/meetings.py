import base64
import csv
import hashlib
import hmac
import io
import json
import logging
import secrets
import string
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, and_, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.connect.media_service import service as media
from app.websocket import signaling as ws_signaling
from app.core.calendar import generate_ics
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user, get_current_participant
from app.core.guest import DisplayNameError, guest_avatar_color, sanitize_display_name
from app.core.guest_cleanup import purge_meeting_guests
from app.core.rate_limit import guest_join_limiter, invalid_room_limiter
from app.core.security import (
    create_guest_token,
    hash_password,
    verify_password,
)
from app.core.urls import meeting_url

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
from app.models.private_note import PrivateNote
from app.models.user import User
from app.schemas.meeting import (
    MeetingCreate,
    MeetingUpdate,
    MeetingOut,
    ParticipantOut,
    MeetingRoster,
    JoinMeetingIn,
    ParticipantActionIn,
    PrivateNotesUpdate,
    PrivateNotesOut,
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


def _client_ip(request: Request) -> str:
    """Best-effort client IP, honoring the proxy header Cloud Run sets."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _meeting_status(meeting: Meeting) -> str:
    """Derive a Google-Meet-style lifecycle status from the existing flags.

    Kept derived (not a stored column) so it can never drift from is_active /
    ended_at / cancelled_at / scheduled_at, which remain the source of truth.
    """
    if meeting.cancelled_at is not None:
        return "cancelled"
    if not meeting.is_active:
        return "ended"
    if meeting.scheduled_at is not None and meeting.scheduled_at > datetime.now(timezone.utc):
        return "scheduled"
    return "live"


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
        "guests_enabled": meeting.guests_enabled,
        "password_protected": meeting.password_hash is not None,
        "media_provider": meeting.media_provider or "mesh",
        "status": _meeting_status(meeting),
        "created_at": meeting.created_at,
        "ended_at": meeting.ended_at,
        "cancelled_at": meeting.cancelled_at,
    }


def _get_meeting_or_404(code: str, db: Session) -> Meeting:
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting


def _waiting_count(meeting_id: int, db: Session) -> int:
    """Live number of people sitting in this meeting's waiting room (pending).
    Drives the pre-join lobby's "N waiting" line — computed on demand, not
    stored, so it's always current when the lobby fetches meeting metadata."""
    return int(
        db.scalar(
            select(func.count())
            .select_from(MeetingParticipant)
            .where(
                MeetingParticipant.meeting_id == meeting_id,
                MeetingParticipant.status == STATUS_PENDING,
            )
        )
        or 0
    )


def _log_meeting_started_for_host(db: Session, meeting: Meeting, host: User) -> None:
    """Record a 'meeting started' activity entry the first time the host joins.

    A meeting only truly goes live when its host walks in, so this is the point
    we log it — instant meetings fire immediately, create-a-link meetings the
    host never opens don't fire, and scheduled meetings fire when they actually
    start rather than when they were created.

    Feeds the Team activity list on Home (which reads the notifications feed)
    and pushes live to the header notification bell over /ws/notifications, so
    the alert appears without a page reload.

    Best-effort by contract: callers commit the participant row first and wrap
    this in a try/except, so a failure here can never block someone joining.
    """
    from app.api.notifications import push_to_user
    from app.models.organization import Notification, NOTIF_MEETING_STARTED
    from app.websocket.manager import meet_manager

    data = json.dumps({"meeting_code": meeting.code})
    notif = Notification(
        user_id=host.id,
        type=NOTIF_MEETING_STARTED,
        title=f"Meeting started: {meeting.title}",
        body=f"\"{meeting.title}\" is now live.",
        data=data,
    )
    db.add(notif)
    db.commit()
    db.refresh(notif)

    # Real-time push to any open notification bell for the host. Scheduled onto
    # the event loop because this runs in a sync (threadpool) request handler;
    # `data` is sent as the same JSON string the REST feed returns so the client
    # parses it identically.
    meet_manager.schedule(
        push_to_user(
            host.id,
            {
                "type": "notification",
                "notification": {
                    "id": notif.id,
                    "type": notif.type,
                    "title": notif.title,
                    "body": notif.body,
                    "data": data,
                    "is_read": False,
                    "created_at": notif.created_at.isoformat(),
                },
            },
        )
    )


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


@router.get("/scheduled")
def scheduled_meetings(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """All of the caller's scheduled meetings (upcoming, past, and cancelled).

    Powers the dedicated Scheduled Meetings dashboard page. Includes the derived
    status and an invitee count so the client can render tabs + columns without
    a follow-up round-trip per row.
    """
    from app.models.organization import MeetingInvite

    meetings = db.scalars(
        select(Meeting)
        .where(
            Meeting.host_id == user.id,
            Meeting.scheduled_at.is_not(None),
        )
        .order_by(desc(Meeting.scheduled_at))
    ).all()
    if not meetings:
        return []

    meeting_ids = [m.id for m in meetings]
    # One grouped count query instead of N per-row lookups.
    counts_rows = db.execute(
        select(MeetingInvite.meeting_id, func.count())
        .where(MeetingInvite.meeting_id.in_(meeting_ids))
        .group_by(MeetingInvite.meeting_id)
    ).all()
    invite_counts = {mid: n for mid, n in counts_rows}

    result = []
    for m in meetings:
        out = _meeting_out(m)
        out["scheduled_at"] = m.scheduled_at.isoformat() if m.scheduled_at else None
        out["created_at"] = m.created_at.isoformat() if m.created_at else None
        out["ended_at"] = m.ended_at.isoformat() if m.ended_at else None
        out["cancelled_at"] = m.cancelled_at.isoformat() if m.cancelled_at else None
        out["invite_count"] = invite_counts.get(m.id, 0)
        out["host_name"] = user.name
        result.append(out)
    return result


@router.get("/{code}", response_model=MeetingOut)
def get_meeting(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = _get_meeting_or_404(code, db)
    return {**_meeting_out(meeting), "waiting_count": _waiting_count(meeting.id, db)}


# ── Guest (anonymous) join ───────────────────────────────────────────────────

class PublicMeetingOut(BaseModel):
    """Unauthenticated view of a meeting for the guest pre-join screen.

    Deliberately minimal — never exposes the password hash, host id, participant
    list, or any internal field. Just enough to render the lobby (title, who's
    hosting, branding) and decide which inputs to show (password, waiting room).
    """
    code: str
    title: str
    host_name: str | None = None
    org_logo_url: str | None = None
    is_active: bool
    password_protected: bool
    waiting_room_enabled: bool
    guests_enabled: bool
    waiting_count: int = 0


def _org_logo_for_host(host_id: int, db: Session) -> str | None:
    """Best-effort organization logo for branding the guest lobby.

    Meetings aren't tied to an org yet (no org_id column), so we surface the
    logo of an org the host owns, if any. Returns None otherwise; the client
    falls back to the Zoiko wordmark.
    """
    try:
        from app.models.organization import Organization

        org = db.scalar(
            select(Organization).where(Organization.owner_id == host_id)
        )
        return org.logo_url if org else None
    except Exception:
        return None


@router.get("/{code}/public", response_model=PublicMeetingOut)
def public_meeting_info(
    code: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Public meeting metadata for the guest pre-join screen (no auth).

    Throttled per IP so a scripted client can't enumerate valid meeting codes.
    """
    ip = _client_ip(request)
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        # Count misses toward the enumeration throttle; once over the limit,
        # 429 instead of a fast 404 so guessing codes is expensive.
        if not invalid_room_limiter.check(f"public:{ip}"):
            raise HTTPException(status_code=429, detail="Too many requests")
        raise HTTPException(status_code=404, detail="Meeting not found")

    host = db.get(User, meeting.host_id)
    return PublicMeetingOut(
        code=meeting.code,
        title=meeting.title,
        host_name=host.name if host else None,
        org_logo_url=_org_logo_for_host(meeting.host_id, db),
        is_active=meeting.is_active,
        password_protected=meeting.password_hash is not None,
        waiting_room_enabled=meeting.waiting_room_enabled,
        guests_enabled=meeting.guests_enabled,
        waiting_count=_waiting_count(meeting.id, db),
    )


class GuestTokenIn(BaseModel):
    display_name: str = Field(..., max_length=200)
    password: str | None = None
    # CAPTCHA hook — validated only when a provider is configured (none wired by
    # default). Present so the client contract is stable when one is added.
    captcha_token: str | None = None


class GuestTokenOut(BaseModel):
    access_token: str
    token_type: str = "guest"
    user_id: int
    name: str
    is_guest: bool = True
    # Mirrors the participant status the join will produce so the client knows
    # up front whether to expect the waiting room.
    waiting_room_enabled: bool


@router.post("/{code}/guest-token", response_model=GuestTokenOut, status_code=201)
def guest_token(
    code: str,
    data: GuestTokenIn,
    request: Request,
    db: Session = Depends(get_db),
):
    """Mint an anonymous guest identity + JWT for a meeting (no auth required).

    Creates an ephemeral `users` row (is_guest=True, no email/password) and
    returns a short-lived guest token. The client then uses this token against
    the existing /join + /media-token + control-WS exactly like a signed-in
    user — guest participant creation, waiting room, and admission all flow
    through unchanged code.

    Abuse controls: 20 tokens / IP / hour, password + locked + guests_enabled
    enforced server-side, display name sanitized. Never creates a permanent
    account; guest rows are purged when the meeting ends (see guest_cleanup).
    """
    ip = _client_ip(request)
    if not guest_join_limiter.check(f"guest:{ip}"):
        retry = guest_join_limiter.retry_after(f"guest:{ip}")
        raise HTTPException(
            status_code=429,
            detail="Too many guest join attempts. Please try again later.",
            headers={"Retry-After": str(retry)},
        )

    meeting = _get_meeting_or_404(code, db)
    if not meeting.is_active:
        raise HTTPException(status_code=410, detail="Meeting has ended")
    if not meeting.guests_enabled:
        raise HTTPException(
            status_code=403, detail="Guests are not allowed in this meeting"
        )
    if meeting.locked:
        raise HTTPException(status_code=403, detail="Meeting is locked")

    # Meeting password (guests are never the host, so always enforced).
    if meeting.password_hash:
        if not data.password or not verify_password(data.password, meeting.password_hash):
            raise HTTPException(status_code=403, detail="Incorrect meeting password")

    # Validate + sanitize the display name (never trust the client).
    try:
        name = sanitize_display_name(data.display_name)
    except DisplayNameError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    # Create the ephemeral guest account. email/password stay NULL; a 6h TTL
    # backstops cleanup if the meeting never formally ends.
    now = datetime.now(timezone.utc)
    ttl = get_settings().livekit_token_ttl_seconds
    guest = User(
        email=None,
        name=name,
        password_hash=None,
        avatar_color=guest_avatar_color(f"{code}:{name}:{now.timestamp()}"),
        is_guest=True,
        guest_expires_at=now + timedelta(seconds=ttl),
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)

    token = create_guest_token(guest.id)
    log.info(
        "[GUEST_JOIN] meeting=%s guest_user=%s name=%r ip=%s",
        meeting.id, guest.id, name, ip,
    )
    return GuestTokenOut(
        access_token=token,
        user_id=guest.id,
        name=name,
        waiting_room_enabled=meeting.waiting_room_enabled,
    )


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
    # Purge ephemeral guest accounts created for this meeting (participant rows
    # cascade). Best-effort — a failure here must not block ending the meeting.
    try:
        purge_meeting_guests(meeting.id, db)
    except Exception:
        log.exception("purge_meeting_guests failed for meeting=%s", meeting.id)
        db.rollback()
        meeting.is_active = False
        meeting.ended_at = datetime.now(timezone.utc)
        meeting.media_room_ref = None
    db.commit()
    db.refresh(meeting)

    if room_ref:
        try:
            await media.release_media_room(room_ref)
        except Exception:
            log.exception("release_media_room failed for %s", room_ref)

    return _meeting_out(meeting)


# ── Cancel (scheduled meeting) ──────────────────────────────────────────────

@router.post("/{code}/cancel", response_model=MeetingOut)
async def cancel_meeting(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host cancels a scheduled meeting.

    Marks it cancelled (distinct from a meeting that actually ran), tears down
    any allocated media room, and notifies every invitee by email + in-app
    notification. Idempotent — cancelling an already-cancelled meeting is a
    no-op that returns the current state.
    """
    from app.core.email import send_meeting_cancelled_email
    from app.models.organization import (
        MeetingInvite,
        Notification,
        NOTIF_MEETING_CANCELLED,
    )

    meeting = _get_meeting_or_404(code, db)
    if meeting.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only the host can cancel the meeting")

    if meeting.cancelled_at is not None:
        return _meeting_out(meeting)

    now = datetime.now(timezone.utc)
    meeting.cancelled_at = now
    meeting.is_active = False
    if meeting.ended_at is None:
        meeting.ended_at = now
    room_ref = meeting.media_room_ref
    meeting.media_room_ref = None

    scheduled_str = None
    if meeting.scheduled_at:
        local_scheduled_at = meeting.scheduled_at
        if meeting.timezone_name:
            local_scheduled_at = local_scheduled_at.astimezone(ZoneInfo(meeting.timezone_name))
        scheduled_str = local_scheduled_at.strftime("%b %d, %Y at %I:%M %p")
        if meeting.timezone_name:
            scheduled_str += f" ({meeting.timezone_name})"

    invites = db.scalars(
        select(MeetingInvite).where(MeetingInvite.meeting_id == meeting.id)
    ).all()

    # One METHOD:CANCEL object per invitee (ATTENDEE line varies), same UID as
    # the original invite so the receiving calendar client removes the right
    # event rather than creating a stray cancelled one.
    for invite in invites:
        cancel_ics = None
        if meeting.scheduled_at:
            cancel_ics = generate_ics(
                title=meeting.title,
                meeting_code=meeting.code,
                join_url=meeting_url(meeting.code),
                scheduled_at=meeting.scheduled_at,
                organizer_name=user.name,
                organizer_email=user.email,
                attendee_email=invite.invitee_email,
                method="CANCEL",
                sequence=1,
            )
        send_meeting_cancelled_email(
            to_email=invite.invitee_email,
            organizer_name=user.name,
            meeting_title=meeting.title,
            scheduled_at=scheduled_str,
            ics_data=cancel_ics,
        )
        if invite.invitee_user_id:
            db.add(
                Notification(
                    user_id=invite.invitee_user_id,
                    type=NOTIF_MEETING_CANCELLED,
                    title=f"Meeting cancelled: {meeting.title}",
                    body=f"{user.name} cancelled \"{meeting.title}\".",
                    data=None,
                )
            )

    db.commit()
    db.refresh(meeting)

    if room_ref:
        try:
            await media.release_media_room(room_ref)
        except Exception:
            log.exception("release_media_room failed for %s", room_ref)

    return _meeting_out(meeting)


# ── Delete ──────────────────────────────────────────────────────────────────

@router.delete("/{code}", status_code=204)
async def delete_meeting(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently delete a meeting the caller hosts (participants, invites,
    private notes cascade via FK ON DELETE CASCADE). Releases any live media
    room first so a deleted meeting can't leave a zombie SFU room behind."""
    meeting = _get_meeting_or_404(code, db)
    if meeting.host_id != user.id:
        raise HTTPException(status_code=403, detail="Only the host can delete the meeting")

    room_ref = meeting.media_room_ref
    db.delete(meeting)
    db.commit()

    if room_ref:
        try:
            await media.release_media_room(room_ref)
        except Exception:
            log.exception("release_media_room failed for %s", room_ref)
    return None


# ── Media token (LiveKit join) ──────────────────────────────────────────────

class MediaTokenOut(BaseModel):
    access_token: str
    ws_url: str
    room: str
    identity: str
    expires_at: int
    # Per-meeting end-to-end encryption key (base64, 32 bytes). Every admitted
    # participant derives the SAME value from the server secret + meeting code,
    # so it doubles as the LiveKit media-E2EE passphrase AND the AES-GCM key for
    # in-call chat/captions. The SFU and app server relay ciphertext they can't
    # read. Returned only to admitted participants over TLS.
    e2ee_key: str


def _derive_e2ee_key(code: str) -> str:
    """Deterministic 256-bit per-meeting E2EE key, base64-encoded.

    HMAC-SHA256(secret, "zoiko-e2ee-v1|<code>") is a PRF: stable across token
    refreshes and identical for every participant in the meeting, while the
    plaintext key never leaves the server (each client re-derives it from its
    own token response). Bump the "v1" tag to rotate all keys at once.
    """
    settings = get_settings()
    secret = (settings.e2ee_secret or settings.jwt_secret).encode()
    digest = hmac.new(secret, b"zoiko-e2ee-v1|" + code.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


@router.post("/{code}/media-token", response_model=MediaTokenOut)
async def issue_media_token(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_participant),
):
    """Issue a short-lived LiveKit JWT for the caller.

    Caller must already be an ADMITTED participant (created by POST /join).
    Lazy-provisions the LiveKit room on first call.
    """
    settings = get_settings()
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
        is_guest=user.is_guest,
        avatar_url=user.avatar_url if user.show_photo_in_meetings else None,
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
        e2ee_key=_derive_e2ee_key(meeting.code),
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
    user: User = Depends(get_current_participant),
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

    # Server-side recording is fundamentally incompatible with end-to-end
    # encryption: RoomCompositeEgress joins the SFU as a participant and would
    # only capture E2E-encrypted (opaque) frames. Since every meeting is now
    # E2E-encrypted, recording is disabled. Refuse loudly rather than write a
    # useless file. (If a "recorded meetings" product is needed later, it must
    # be client-side capture, which can decrypt what that client already sees.)
    raise HTTPException(
        status_code=409,
        detail="Recording is unavailable: this meeting is end-to-end encrypted.",
    )

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
    user: User = Depends(get_current_participant),
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
        # The host's first join is when the meeting goes live — log it to the
        # activity feed. Best-effort: the participant row is already committed,
        # so a failure here only rolls back the (isolated) notification insert.
        if is_host:
            try:
                _log_meeting_started_for_host(db, meeting, user)
            except Exception:
                log.exception("meeting_started notification failed (code=%s)", code)
                db.rollback()
        return participant
    except HTTPException:
        raise
    except SQLAlchemyError:
        # Roll back FIRST. The session's transaction is invalid at this point;
        # touching any ORM attribute (e.g. user.id below) before rollback
        # triggers a lazy reload that raises PendingRollbackError, masking the
        # real error and escaping this handler unhandled.
        db.rollback()
        # Surface DB problems with a logged traceback so future 500s on this
        # path show up in Cloud Run logs instead of an opaque "HTTP 500" chip
        # on the lobby.
        log.exception("join_meeting DB error (code=%s user=%s)", code, getattr(user, "id", None))
        raise HTTPException(status_code=500, detail="Could not join meeting — please retry")
    except Exception:
        log.exception("join_meeting unexpected error (code=%s user=%s)", code, getattr(user, "id", None))
        raise HTTPException(status_code=500, detail="Could not join meeting — please retry")


# ── Roster (participants list) ──────────────────────────────────────────────

@router.get("/{code}/participants", response_model=MeetingRoster)
def get_participants(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_participant),
):
    meeting = _get_meeting_or_404(code, db)
    participants = db.scalars(
        select(MeetingParticipant).where(MeetingParticipant.meeting_id == meeting.id)
    ).all()

    # Bulk-load every participant's user in ONE query (was an N+1: one db.get per
    # row, i.e. 1 + 100 queries for a 100-person meeting).
    _uids = [p.user_id for p in participants]
    _users = (
        {u.id: u for u in db.scalars(select(User).where(User.id.in_(_uids))).all()}
        if _uids else {}
    )

    roster = []
    for p in participants:
        u = _users.get(p.user_id)
        roster.append({
            "id": p.id,
            "user_id": p.user_id,
            "name": u.name if u else "Unknown",
            "avatar_color": u.avatar_color if u else "#5b8def",
            "is_guest": bool(u.is_guest) if u else False,
            "role": p.role,
            "status": p.status,
            "joined_at": p.joined_at.isoformat() if p.joined_at else None,
            "left_at": p.left_at.isoformat() if p.left_at else None,
        })

    return MeetingRoster(meeting=meeting, participants=roster)


# ── Host actions: admit / deny / promote ───────────────────────────────────

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

    await ws_signaling.signal_admitted_many(meeting.id, admitted_ids)
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


# ponytail: host "kick participant" endpoint removed — hosts can no longer
# force-disconnect anyone. STATUS_KICKED stays for historical rows + join guards.


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

    # Bulk-load users in ONE query instead of db.get() per row (N+1).
    _uids = [p.user_id for p in participants]
    _users = (
        {u.id: u for u in db.scalars(select(User).where(User.id.in_(_uids))).all()}
        if _uids else {}
    )

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Name", "Email", "Role", "Status", "Joined At", "Left At", "Duration (seconds)"])
    for p in participants:
        u = _users.get(p.user_id)
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


# ── Private notes (per-participant notebook) ───────────────────────────────
#
# Each participant owns one private notebook per meeting (rich-text notes +
# personal drawing canvas). This data is NEVER shared: it is fetched and saved
# only through these endpoints, always scoped to the JWT's user_id. There is no
# WS relay and no `user_id` query param — a caller can only ever touch their own
# notebook. Guests are allowed (get_current_participant) so anonymous attendees
# keep notes too.


def _require_meeting_access(meeting: Meeting, user: User, db: Session) -> None:
    """403 unless the caller is the host or has a participant row in this meeting.

    Gates the private-notes endpoints so only people actually in the meeting can
    create/read their notebook for it.
    """
    if meeting.host_id == user.id:
        return
    participant = db.scalars(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == user.id,
        )
    ).first()
    if not participant:
        raise HTTPException(status_code=403, detail="Not a participant of this meeting")


@router.get("/{code}/private-notes", response_model=PrivateNotesOut)
def get_private_notes(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_participant),
):
    meeting = _get_meeting_or_404(code, db)
    _require_meeting_access(meeting, user, db)
    note = db.scalar(
        select(PrivateNote).where(
            PrivateNote.meeting_id == meeting.id,
            PrivateNote.user_id == user.id,
        )
    )
    if not note:
        # No notebook yet — return an empty shell so the client renders a blank
        # editor rather than 404-ing on first open.
        return PrivateNotesOut()
    return note


@router.put("/{code}/private-notes", response_model=PrivateNotesOut)
def upsert_private_notes(
    code: str,
    data: PrivateNotesUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_participant),
):
    meeting = _get_meeting_or_404(code, db)
    _require_meeting_access(meeting, user, db)

    fields = data.model_dump(exclude_unset=True)
    note = db.scalar(
        select(PrivateNote).where(
            PrivateNote.meeting_id == meeting.id,
            PrivateNote.user_id == user.id,
        )
    )
    if note is None:
        note = PrivateNote(meeting_id=meeting.id, user_id=user.id, **fields)
        db.add(note)
        try:
            db.commit()
        except IntegrityError:
            # Concurrent first-write from another tab raced us to the unique
            # (meeting_id, user_id) row — fall back to updating the existing one.
            db.rollback()
            note = db.scalar(
                select(PrivateNote).where(
                    PrivateNote.meeting_id == meeting.id,
                    PrivateNote.user_id == user.id,
                )
            )
            for key, value in fields.items():
                setattr(note, key, value)
            db.commit()
    else:
        for key, value in fields.items():
            setattr(note, key, value)
        db.commit()

    db.refresh(note)
    return note


@router.delete("/{code}/private-notes", status_code=204)
def delete_private_notes(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_participant),
):
    meeting = _get_meeting_or_404(code, db)
    _require_meeting_access(meeting, user, db)
    note = db.scalar(
        select(PrivateNote).where(
            PrivateNote.meeting_id == meeting.id,
            PrivateNote.user_id == user.id,
        )
    )
    if note:
        db.delete(note)
        db.commit()
    return None
