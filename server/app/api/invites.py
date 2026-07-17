import json
import secrets
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select, desc
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.email import send_meeting_invite_email, send_meeting_rsvp_email
from app.core.calendar import generate_ics
from app.core.urls import meeting_url
from app.models.user import User
from app.models.meeting import Meeting
from app.models.organization import (
    MeetingInvite,
    Notification,
    INVITE_PENDING,
    INVITE_ACCEPTED,
    INVITE_DECLINED,
    NOTIF_MEETING_INVITE,
    NOTIF_MEETING_RSVP,
)
from app.schemas.organization import MeetingInviteIn, MeetingInviteOut

router = APIRouter(prefix="/api/meetings", tags=["invites"])


# ── Send invites ──────────────────────────────────────────────────────────

@router.post("/{code}/invite", status_code=201)
def invite_to_meeting(
    code: str,
    data: MeetingInviteIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    join_url = meeting_url(meeting.code)
    results = []

    scheduled_str = None
    if meeting.scheduled_at:
        local_scheduled_at = meeting.scheduled_at
        if meeting.timezone_name:
            local_scheduled_at = local_scheduled_at.astimezone(ZoneInfo(meeting.timezone_name))
        scheduled_str = local_scheduled_at.strftime("%b %d, %Y at %I:%M %p")
        if meeting.timezone_name:
            scheduled_str += f" ({meeting.timezone_name})"

    for email in data.emails:
        email = email.strip().lower()
        if not email:
            continue

        # Check for existing invite
        existing = db.scalar(
            select(MeetingInvite).where(
                MeetingInvite.meeting_id == meeting.id,
                MeetingInvite.invitee_email == email,
            )
        )
        if existing:
            results.append({"email": email, "status": "already_invited"})
            continue

        # Look up user by email
        invitee = db.scalar(select(User).where(User.email == email))

        token = secrets.token_urlsafe(32)
        invite = MeetingInvite(
            meeting_id=meeting.id,
            inviter_id=user.id,
            invitee_email=email,
            invitee_user_id=invitee.id if invitee else None,
            token=token,
        )
        db.add(invite)

        # In-app notification for registered users
        if invitee:
            notif = Notification(
                user_id=invitee.id,
                type=NOTIF_MEETING_INVITE,
                title=f"Meeting invite: {meeting.title}",
                body=f"{user.name} invited you to join \"{meeting.title}\"",
                data=json.dumps({
                    "meeting_code": meeting.code,
                    "meeting_title": meeting.title,
                    "inviter_name": user.name,
                }),
            )
            db.add(notif)

        # Generate .ics for scheduled meetings
        ics_data = None
        if meeting.scheduled_at:
            ics_data = generate_ics(
                title=meeting.title,
                meeting_code=meeting.code,
                join_url=join_url,
                scheduled_at=meeting.scheduled_at,
                organizer_name=user.name,
                organizer_email=user.email,
                attendee_email=email,
            )

        # Send email invite
        send_meeting_invite_email(
            to_email=email,
            inviter_name=user.name,
            meeting_title=meeting.title,
            meeting_code=meeting.code,
            join_url=join_url,
            scheduled_at=scheduled_str,
            ics_data=ics_data,
            organizer_email=user.email,
            timezone=meeting.timezone_name,
            ics_download_url=f"/api/meetings/{meeting.code}/calendar",
            scheduled_at_dt=meeting.scheduled_at,
        )

        results.append({"email": email, "status": "invited"})

    db.commit()
    return {"invites": results}


# ── List invites for a meeting ────────────────────────────────────────────

@router.get("/{code}/invites", response_model=list[MeetingInviteOut])
def list_meeting_invites(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    invites = db.scalars(
        select(MeetingInvite)
        .where(MeetingInvite.meeting_id == meeting.id)
        .order_by(desc(MeetingInvite.created_at))
    ).all()
    if not invites:
        return []

    inviter_ids = {inv.inviter_id for inv in invites}
    inviters = {
        u.id: u for u in db.scalars(select(User).where(User.id.in_(inviter_ids))).all()
    }

    return [
        {
            "id": inv.id,
            "meeting_id": inv.meeting_id,
            "inviter_id": inv.inviter_id,
            "invitee_email": inv.invitee_email,
            "status": inv.status,
            "created_at": inv.created_at,
            "meeting_code": meeting.code,
            "meeting_title": meeting.title,
            "inviter_name": inviters[inv.inviter_id].name if inv.inviter_id in inviters else None,
        }
        for inv in invites
    ]


# ── User's pending invites ────────────────────────────────────────────────

@router.get("/invites/mine", response_model=list[MeetingInviteOut])
def my_invites(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invites = db.scalars(
        select(MeetingInvite)
        .where(
            MeetingInvite.invitee_user_id == user.id,
            MeetingInvite.status == INVITE_PENDING,
        )
        .order_by(desc(MeetingInvite.created_at))
    ).all()
    if not invites:
        return []

    meeting_ids = {inv.meeting_id for inv in invites}
    inviter_ids = {inv.inviter_id for inv in invites}
    meetings = {
        m.id: m for m in db.scalars(select(Meeting).where(Meeting.id.in_(meeting_ids))).all()
    }
    inviters = {
        u.id: u for u in db.scalars(select(User).where(User.id.in_(inviter_ids))).all()
    }

    return [
        {
            "id": inv.id,
            "meeting_id": inv.meeting_id,
            "inviter_id": inv.inviter_id,
            "invitee_email": inv.invitee_email,
            "status": inv.status,
            "created_at": inv.created_at,
            "meeting_code": meetings[inv.meeting_id].code if inv.meeting_id in meetings else None,
            "meeting_title": meetings[inv.meeting_id].title if inv.meeting_id in meetings else None,
            "inviter_name": inviters[inv.inviter_id].name if inv.inviter_id in inviters else None,
        }
        for inv in invites
    ]


# ── RSVP → organizer notification ────────────────────────────────────────

def _notify_organizer_of_rsvp(db: Session, invite: MeetingInvite, meeting: Meeting, accepted: bool) -> None:
    """Email + in-app notify the organizer with a standards-compliant
    METHOD:REPLY iTIP object (RFC 5546) echoing the invitee's PARTSTAT.

    Best-effort: ``send_email`` never raises on delivery failure, so a bad
    mail provider degrades to "no email sent" rather than blocking the
    caller's status-change commit.
    """
    if not meeting.scheduled_at:
        return
    organizer = db.get(User, meeting.host_id)
    if not organizer or not organizer.email:
        return

    invitee_label = invite.invitee_email
    if invite.invitee_user_id:
        invitee = db.get(User, invite.invitee_user_id)
        if invitee and invitee.name:
            invitee_label = invitee.name

    reply_ics = generate_ics(
        title=meeting.title,
        meeting_code=meeting.code,
        join_url=meeting_url(meeting.code),
        scheduled_at=meeting.scheduled_at,
        organizer_name=organizer.name,
        organizer_email=organizer.email,
        attendee_email=invite.invitee_email,
        method="REPLY",
        partstat="ACCEPTED" if accepted else "DECLINED",
    )
    send_meeting_rsvp_email(
        to_email=organizer.email,
        invitee_label=invitee_label,
        meeting_title=meeting.title,
        accepted=accepted,
        ics_data=reply_ics,
    )
    db.add(
        Notification(
            user_id=organizer.id,
            type=NOTIF_MEETING_RSVP,
            title=f"{invitee_label} {'accepted' if accepted else 'declined'} your invite",
            body=f'"{meeting.title}"',
            data=None,
        )
    )


# ── Accept invite ─────────────────────────────────────────────────────────

@router.post("/invites/{invite_id}/accept")
def accept_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invite = db.scalar(
        select(MeetingInvite).where(
            MeetingInvite.id == invite_id,
            MeetingInvite.invitee_user_id == user.id,
        )
    )
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite.status = INVITE_ACCEPTED
    meeting = db.get(Meeting, invite.meeting_id)
    if meeting:
        _notify_organizer_of_rsvp(db, invite, meeting, accepted=True)
    db.commit()
    return {"detail": "Invite accepted", "meeting_code": meeting.code if meeting else None}


@router.post("/invites/{invite_id}/decline")
def decline_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invite = db.scalar(
        select(MeetingInvite).where(
            MeetingInvite.id == invite_id,
            MeetingInvite.invitee_user_id == user.id,
        )
    )
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite.status = INVITE_DECLINED
    meeting = db.get(Meeting, invite.meeting_id)
    if meeting:
        _notify_organizer_of_rsvp(db, invite, meeting, accepted=False)
    db.commit()
    return {"detail": "Invite declined"}


# ── Download .ics for a meeting ───────────────────────────────────────────

@router.get("/{code}/calendar")
def download_calendar(
    code: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meeting = db.scalar(select(Meeting).where(Meeting.code == code))
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if not meeting.scheduled_at:
        raise HTTPException(status_code=400, detail="Meeting is not scheduled")

    host = db.get(User, meeting.host_id)

    ics_data = generate_ics(
        title=meeting.title,
        meeting_code=meeting.code,
        join_url=meeting_url(meeting.code),
        scheduled_at=meeting.scheduled_at,
        organizer_name=host.name if host else "ZoikoSema",
        organizer_email=host.email if host and host.email else None,
        attendee_email=user.email,
    )

    return Response(
        content=ics_data,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="{meeting.title}.ics"'},
    )
