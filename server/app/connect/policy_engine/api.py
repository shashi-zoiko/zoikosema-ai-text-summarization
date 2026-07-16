"""REST facade for Policy Engine Service. Thin: parse → call service → serialize.

Admin-only: setting an autonomy ceiling is a tenant-wide governance action.
MVP has no dedicated admin-role check module for the connect_* plane yet, so
this reuses TenantContext.role (owner/admin/member/personal) already
resolved by resolve_tenant() — same coarse check other admin-ish connect_*
surfaces use until a real RBAC module exists.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from app.connect.policy_engine import service
from app.connect.shared.errors import DomainError, Forbidden
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/policy", tags=["connect.policy_engine"])

_CATEGORY = Literal["calendar"]
# "personal" (no org membership, see resolve_tenant()) is included: a solo
# tenant has exactly one member, who is definitionally its own admin — this
# is not a privilege escalation, it's the only way a personal tenant could
# ever configure its own policy.
_ADMIN_ROLES = {"owner", "admin", "personal"}


def _ctx(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> TenantContext:
    return resolve_tenant(db, user)


def _to_http(e: DomainError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, **e.details})


class SetCeilingIn(BaseModel):
    category: _CATEGORY
    autonomy_ceiling: int = Field(ge=0, le=service.MAX_AUTONOMY_LEVEL)
    diff_ref: str | None = None


class PolicyVersionOut(BaseModel):
    id: str
    category: str
    version: int
    autonomy_ceiling: int
    author_user_id: int
    diff_ref: str | None
    effective_at: datetime


class ResolvedAutonomyOut(BaseModel):
    category: str
    effective_level: int
    inputs: dict[str, int]


def _to_out(row) -> PolicyVersionOut:
    return PolicyVersionOut(
        id=row.id, category=row.category, version=row.version, autonomy_ceiling=row.autonomy_ceiling,
        author_user_id=row.author_user_id, diff_ref=row.diff_ref, effective_at=row.effective_at,
    )


@router.get("/{category}/resolve", response_model=ResolvedAutonomyOut)
def resolve_autonomy(
    category: _CATEGORY,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        resolved = service.resolve_effective_autonomy(db, ctx, category=category)
    except DomainError as e:
        raise _to_http(e) from e
    return ResolvedAutonomyOut(category=category, effective_level=resolved.level, inputs=resolved.inputs)


@router.get("/{category}/history", response_model=list[PolicyVersionOut])
def policy_history(
    category: _CATEGORY,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        rows = service.list_policy_history(db, ctx, category=category)
    except DomainError as e:
        raise _to_http(e) from e
    return [_to_out(r) for r in rows]


@router.post("/ceiling", response_model=PolicyVersionOut, status_code=201)
async def set_ceiling(
    data: SetCeilingIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    if ctx.role not in _ADMIN_ROLES:
        raise _to_http(Forbidden("Only workspace owners/admins can change the autonomy ceiling"))
    try:
        row = await service.set_autonomy_ceiling(
            db, ctx, category=data.category, autonomy_ceiling=data.autonomy_ceiling, diff_ref=data.diff_ref,
        )
    except DomainError as e:
        raise _to_http(e) from e
    return _to_out(row)
