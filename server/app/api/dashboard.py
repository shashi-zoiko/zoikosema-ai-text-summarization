from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc, or_, and_, case, extract
from sqlalchemy.orm import Session, aliased

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.meeting import Meeting, MeetingParticipant, MeetingRecording
from app.schemas.organization import DashboardStats, MeetingHistoryItem

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStats)
def get_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """One Meeting roll-up query + one recording count + one participant count.

    Was 6 separate queries plus a Python loop that pulled every ended meeting
    into memory just to sum durations; now everything that can roll up in SQL
    does so server-side.
    """
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    user_meeting_ids = (
        select(Meeting.id).where(Meeting.host_id == user.id)
        .union(
            select(MeetingParticipant.meeting_id).where(
                MeetingParticipant.user_id == user.id
            )
        )
    ).subquery()

    # Duration delta in minutes; portable across Postgres + SQLite by using
    # the JULIANDAY/EPOCH trick. Postgres path uses EXTRACT; SQLite test path
    # falls back to seconds difference via strftime — both yield minutes.
    dialect = db.bind.dialect.name if db.bind else "postgresql"
    if dialect == "sqlite":
        duration_min_expr = (
            (func.strftime("%s", Meeting.ended_at) - func.strftime("%s", Meeting.created_at)) / 60
        )
    else:
        duration_min_expr = (
            extract("epoch", Meeting.ended_at - Meeting.created_at) / 60
        )

    row = db.execute(
        select(
            func.count(Meeting.id).label("total_meetings"),
            func.count(case((Meeting.created_at >= week_ago, Meeting.id))).label("week"),
            func.count(case((Meeting.created_at >= month_ago, Meeting.id))).label("month"),
            func.coalesce(
                func.sum(
                    case(
                        (Meeting.ended_at.is_not(None), duration_min_expr),
                        else_=0,
                    )
                ),
                0,
            ).label("duration_min"),
        )
        .where(Meeting.id.in_(select(user_meeting_ids)))
    ).one()

    total_participants = db.scalar(
        select(func.count()).where(
            MeetingParticipant.meeting_id.in_(
                select(Meeting.id).where(Meeting.host_id == user.id)
            )
        )
    ) or 0

    total_recordings = db.scalar(
        select(func.count()).where(MeetingRecording.user_id == user.id)
    ) or 0

    return DashboardStats(
        total_meetings=row.total_meetings or 0,
        meetings_this_week=row.week or 0,
        meetings_this_month=row.month or 0,
        total_participants=total_participants,
        total_duration_minutes=int(row.duration_min or 0),
        total_recordings=total_recordings,
    )


@router.get("/history", response_model=list[MeetingHistoryItem])
def meeting_history(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Single-query history. Previously ran 1 + 2N queries (host lookup +
    participant count per row); now joins the host and uses a correlated
    subquery for the count so the whole page fits in one round-trip."""
    offset = (page - 1) * limit

    user_meeting_ids = (
        select(Meeting.id).where(Meeting.host_id == user.id)
        .union(
            select(MeetingParticipant.meeting_id).where(
                MeetingParticipant.user_id == user.id
            )
        )
    ).subquery()

    host = aliased(User)
    participant_count_subq = (
        select(func.count())
        .where(MeetingParticipant.meeting_id == Meeting.id)
        .correlate(Meeting)
        .scalar_subquery()
    )

    rows = db.execute(
        select(
            Meeting.id,
            Meeting.code,
            Meeting.title,
            Meeting.host_id,
            host.name.label("host_name"),
            Meeting.is_active,
            Meeting.scheduled_at,
            Meeting.created_at,
            Meeting.ended_at,
            participant_count_subq.label("participant_count"),
        )
        .join(host, host.id == Meeting.host_id)
        .where(Meeting.id.in_(select(user_meeting_ids)))
        .order_by(desc(Meeting.created_at))
        .offset(offset)
        .limit(limit)
    ).all()

    result = []
    for r in rows:
        duration_minutes = None
        if r.ended_at and r.created_at:
            duration_minutes = int((r.ended_at - r.created_at).total_seconds() / 60)
        result.append({
            "id": r.id,
            "code": r.code,
            "title": r.title,
            "host_id": r.host_id,
            "host_name": r.host_name,
            "is_active": r.is_active,
            "scheduled_at": r.scheduled_at,
            "created_at": r.created_at,
            "ended_at": r.ended_at,
            "participant_count": r.participant_count or 0,
            "duration_minutes": duration_minutes,
        })

    return result


@router.get("/upcoming")
def upcoming_meetings(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get upcoming scheduled meetings for the current user."""
    now = datetime.now(timezone.utc)

    meetings = db.scalars(
        select(Meeting)
        .where(
            Meeting.host_id == user.id,
            Meeting.scheduled_at.is_not(None),
            Meeting.scheduled_at > now,
            Meeting.is_active == True,  # noqa: E712
        )
        .order_by(Meeting.scheduled_at)
        .limit(10)
    ).all()

    result = []
    for m in meetings:
        result.append({
            "id": m.id,
            "code": m.code,
            "title": m.title,
            "scheduled_at": m.scheduled_at.isoformat() if m.scheduled_at else None,
            "timezone_name": m.timezone_name,
        })
    return result
