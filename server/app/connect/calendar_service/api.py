"""REST facade for Calendar Service. Thin: parse → call service → serialize."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.calendar_service import service
from app.connect.shared.errors import DomainError
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/calendar", tags=["connect.calendar"])


class SyncCalendarIn(BaseModel):
    provider: Literal["google_calendar", "microsoft_calendar"]


class CalendarEventOut(BaseModel):
    id: str
    provider: str
    title: str | None
    description: str | None
    location: str | None
    start_at: datetime | None
    end_at: datetime | None
    all_day: bool
    status: str
    attendees: list[dict]


def _to_out(e) -> CalendarEventOut:
    return CalendarEventOut(
        id=e.id, provider=e.provider, title=e.title, description=e.description,
        location=e.location, start_at=e.start_at, end_at=e.end_at,
        all_day=e.all_day, status=e.status, attendees=e.attendees,
    )


def _ctx(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> TenantContext:
    return resolve_tenant(db, user)


def _to_http(e: DomainError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, **e.details})


@router.post("/sync", status_code=200)
async def sync_calendar(
    data: SyncCalendarIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        return await service.sync_calendar(db, ctx, provider=data.provider)
    except DomainError as e:
        raise _to_http(e) from e


@router.get("/events", response_model=list[CalendarEventOut])
def list_calendar_events(
    time_min: datetime | None = Query(default=None),
    time_max: datetime | None = Query(default=None),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    events = service.list_calendar_events(db, ctx, time_min=time_min, time_max=time_max)
    return [_to_out(e) for e in events]
