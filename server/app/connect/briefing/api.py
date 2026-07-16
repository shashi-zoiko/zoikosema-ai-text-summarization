"""REST facade for the Executive Briefing service. Thin: parse -> call service -> serialize."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session as DbSession

from app.connect.briefing import service
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/briefing", tags=["connect.briefing"])


def _ctx(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> TenantContext:
    return resolve_tenant(db, user)


@router.get("/executive")
def get_executive_briefing(
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    return service.generate_executive_briefing(db, ctx)
