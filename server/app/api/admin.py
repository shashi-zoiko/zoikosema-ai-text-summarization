"""Admin-only dashboard endpoints — system-wide stats, user management, monitoring."""
from datetime import datetime, timezone, timedelta


from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, desc, update, delete
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.recording_cleanup import purge_expired_recordings
from app.models.user import User
from app.models.meeting import (
    Meeting, MeetingParticipant, MeetingRecording, MeetingIntelligence,
)
from app.models.organization import (
    Organization, OrganizationMember, MeetingInvite, Notification,
)
from app.models.chat import (
    Channel, ChannelMember, Message, MessageReaction, MessageReadReceipt,
)
from app.models.private_note import PrivateNote
from app.models.support import SupportCase

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Legacy bootstrap: the very first registered user stays an admin so existing
# single-owner installs keep working even before anyone sets ADMIN_EMAILS.
LEGACY_ADMIN_USER_IDS = {1}


def _is_admin(user: User) -> bool:
    """Effective admin check: the real role column, the ADMIN_EMAILS allowlist,
    or the legacy first-user bootstrap."""
    if getattr(user, "is_admin", False):
        return True
    if user.id in LEGACY_ADMIN_USER_IDS:
        return True
    if user.email and user.email.lower() in get_settings().admin_email_list:
        return True
    return False


def _require_admin(user: User):
    # The ONE gate all admin endpoints route through. Non-admins get a hard 403
    # (zero data) — the panel exposes tenant-wide users, emails, activity and
    # destructive controls, so authentication alone is not enough.
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin access required")


# ── System-wide stats ─────────────────────────────────────────────────────

@router.get("/stats")
def system_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    total_users = db.scalar(select(func.count()).select_from(User)) or 0
    users_this_week = db.scalar(
        select(func.count()).where(User.created_at >= week_ago)
    ) or 0
    total_meetings = db.scalar(select(func.count()).select_from(Meeting)) or 0
    meetings_this_week = db.scalar(
        select(func.count()).where(Meeting.created_at >= week_ago)
    ) or 0
    meetings_this_month = db.scalar(
        select(func.count()).where(Meeting.created_at >= month_ago)
    ) or 0
    active_meetings = db.scalar(
        select(func.count()).where(Meeting.is_active == True)  # noqa: E712
    ) or 0
    total_recordings = db.scalar(select(func.count()).select_from(MeetingRecording)) or 0
    total_orgs = db.scalar(select(func.count()).select_from(Organization)) or 0
    total_participants = db.scalar(select(func.count()).select_from(MeetingParticipant)) or 0

    return {
        "total_users": total_users,
        "users_this_week": users_this_week,
        "total_meetings": total_meetings,
        "meetings_this_week": meetings_this_week,
        "meetings_this_month": meetings_this_month,
        "active_meetings": active_meetings,
        "total_recordings": total_recordings,
        "total_organizations": total_orgs,
        "total_participants_joined": total_participants,
    }


# ── Recordings retention ──────────────────────────────────────────────────

@router.post("/recordings/purge")
def purge_recordings_now(
    days: int | None = Query(default=None, ge=1),
    user: User = Depends(get_current_user),
):
    """Manually trigger the expired-recording sweep. Defaults to the configured retention."""
    _require_admin(user)
    retention = days if days is not None else get_settings().recording_retention_days
    if retention <= 0:
        raise HTTPException(status_code=400, detail="retention must be > 0")
    purged = purge_expired_recordings(retention)
    return {"purged": purged, "retention_days": retention}


# ── User management ──────────────────────────────────────────────────────

@router.get("/users")
def list_users(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, le=200),
    search: str = Query(default=""),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    offset = (page - 1) * limit
    stmt = select(User)
    if search:
        stmt = stmt.where(
            User.name.ilike(f"%{search}%") | User.email.ilike(f"%{search}%")
        )
    stmt = stmt.order_by(desc(User.created_at)).offset(offset).limit(limit)
    users = db.scalars(stmt).all()
    if not users:
        return []

    # Single GROUP BY instead of N "count meetings hosted by user X" round-trips.
    user_ids = [u.id for u in users]
    counts = dict(
        db.execute(
            select(Meeting.host_id, func.count(Meeting.id))
            .where(Meeting.host_id.in_(user_ids))
            .group_by(Meeting.host_id)
        ).all()
    )

    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "avatar_color": u.avatar_color,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "meeting_count": counts.get(u.id, 0),
            "is_admin": _is_admin(u),
        }
        for u in users
    ]


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently delete a user and the content they own.

    Most tables reference ``users.id`` with the default ``ON DELETE`` (RESTRICT),
    so a bare ``db.delete(user)`` raised an IntegrityError for any user who had
    ever hosted a meeting or sent a message — the delete silently failed and the
    row stayed (the reported "Delete User does nothing" bug). We instead unwind
    the dependents explicitly, in FK-safe order, inside one transaction:

      • their hosted meetings (cascades participants/recordings/intel/invites/
        notes via ``meetings.id`` ON DELETE CASCADE),
      • their participation, recordings, invites, chat activity, memberships and
        notifications elsewhere,
      • channels they created are reassigned to the acting admin rather than
        deleted, so shared team channels survive.

    If the user OWNS an organization we refuse (400) and ask for ownership to be
    transferred first — deleting an org here would silently wipe every member and
    invite under it, which is never what a single-user delete should do.
    """
    _require_admin(user)
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Guard: block if the user still owns organizations (destructive blast radius).
    owned_orgs = db.scalars(
        select(Organization.name).where(Organization.owner_id == user_id)
    ).all()
    if owned_orgs:
        raise HTTPException(
            status_code=400,
            detail=(
                "This user owns "
                + (", ".join(f'"{n}"' for n in owned_orgs))
                + ". Transfer organization ownership before deleting them."
            ),
        )

    try:
        # 1. Meetings they hosted — deleting the meeting cascades its participants,
        #    recordings, intelligence, invites and private notes (all keyed on
        #    meetings.id ON DELETE CASCADE).
        db.execute(delete(Meeting).where(Meeting.host_id == user_id))

        # 2. Their footprint in *other* people's meetings.
        db.execute(delete(MeetingParticipant).where(MeetingParticipant.user_id == user_id))
        db.execute(delete(MeetingRecording).where(MeetingRecording.user_id == user_id))
        db.execute(
            delete(MeetingInvite).where(
                (MeetingInvite.inviter_id == user_id)
                | (MeetingInvite.invitee_user_id == user_id)
            )
        )
        # Intelligence they requested elsewhere: detach (column is nullable).
        db.execute(
            update(MeetingIntelligence)
            .where(MeetingIntelligence.requested_by_id == user_id)
            .values(requested_by_id=None)
        )

        # 3. Chat. Order matters: clear references to their messages before the
        #    messages themselves (reply pointers + read receipts are RESTRICT).
        db.execute(delete(MessageReaction).where(MessageReaction.user_id == user_id))
        db.execute(delete(MessageReadReceipt).where(MessageReadReceipt.user_id == user_id))
        their_msg_ids = db.scalars(
            select(Message.id).where(Message.sender_id == user_id)
        ).all()
        if their_msg_ids:
            db.execute(
                delete(MessageReadReceipt).where(
                    MessageReadReceipt.last_read_message_id.in_(their_msg_ids)
                )
            )
            db.execute(
                update(Message)
                .where(Message.reply_to_id.in_(their_msg_ids))
                .values(reply_to_id=None)
            )
            # Reactions on their messages cascade via messages.id ON DELETE CASCADE.
            db.execute(delete(Message).where(Message.sender_id == user_id))
        db.execute(delete(ChannelMember).where(ChannelMember.user_id == user_id))
        # Reassign (don't delete) channels they created — keeps shared channels alive.
        db.execute(
            update(Channel).where(Channel.created_by == user_id).values(created_by=user.id)
        )

        # 4. Org memberships + notifications.
        db.execute(delete(OrganizationMember).where(OrganizationMember.user_id == user_id))
        db.execute(delete(Notification).where(Notification.user_id == user_id))

        # 5. Per-user side tables (also ON DELETE CASCADE, deleted explicitly so a
        #    stale prod constraint can't turn the final delete into a 500).
        db.execute(delete(PrivateNote).where(PrivateNote.user_id == user_id))
        db.execute(delete(SupportCase).where(SupportCase.user_id == user_id))

        db.delete(target)
        db.commit()
    except Exception:
        db.rollback()
        raise


# ── Recent meetings (system-wide) ────────────────────────────────────────

@router.get("/meetings")
def list_meetings(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, le=200),
    active_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)
    offset = (page - 1) * limit
    stmt = select(Meeting)
    if active_only:
        stmt = stmt.where(Meeting.is_active == True)  # noqa: E712
    stmt = stmt.order_by(desc(Meeting.created_at)).offset(offset).limit(limit)
    meetings = db.scalars(stmt).all()
    if not meetings:
        return []

    # Batch the host + participant-count lookups so each list row is constant
    # work in Python instead of two extra round-trips to the DB.
    host_ids = {m.host_id for m in meetings}
    meeting_ids = [m.id for m in meetings]
    hosts = {
        u.id: u for u in db.scalars(select(User).where(User.id.in_(host_ids))).all()
    }
    p_counts = dict(
        db.execute(
            select(MeetingParticipant.meeting_id, func.count(MeetingParticipant.id))
            .where(MeetingParticipant.meeting_id.in_(meeting_ids))
            .group_by(MeetingParticipant.meeting_id)
        ).all()
    )

    return [
        {
            "id": m.id,
            "code": m.code,
            "title": m.title,
            "host_name": hosts[m.host_id].name if m.host_id in hosts else "Unknown",
            "host_email": hosts[m.host_id].email if m.host_id in hosts else "",
            "is_active": m.is_active,
            "locked": m.locked,
            "password_protected": m.password_hash is not None,
            "waiting_room_enabled": m.waiting_room_enabled,
            "participant_count": p_counts.get(m.id, 0),
            "scheduled_at": m.scheduled_at.isoformat() if m.scheduled_at else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "ended_at": m.ended_at.isoformat() if m.ended_at else None,
        }
        for m in meetings
    ]


# ── Activity feed ─────────────────────────────────────────────────────────

@router.get("/activity")
def activity_feed(
    limit: int = Query(default=30, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_admin(user)

    # Recent user signups
    recent_users = db.scalars(
        select(User).order_by(desc(User.created_at)).limit(limit)
    ).all()

    # Recent meetings
    recent_meetings = db.scalars(
        select(Meeting).order_by(desc(Meeting.created_at)).limit(limit)
    ).all()

    # Batch the host lookups across all recent meetings (was N round-trips).
    host_ids = {m.host_id for m in recent_meetings}
    hosts = (
        {u.id: u for u in db.scalars(select(User).where(User.id.in_(host_ids))).all()}
        if host_ids
        else {}
    )

    events = []
    for u in recent_users:
        events.append({
            "type": "user_signup",
            "message": f"{u.name} signed up",
            "email": u.email,
            "timestamp": u.created_at.isoformat() if u.created_at else None,
        })
    for m in recent_meetings:
        host = hosts.get(m.host_id)
        events.append({
            "type": "meeting_created",
            "message": f"{host.name if host else 'Unknown'} created \"{m.title}\"",
            "code": m.code,
            "timestamp": m.created_at.isoformat() if m.created_at else None,
        })

    events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    return events[:limit]
