"""REST facade for Shared Mailboxes / Delegated Access. Thin: parse -> call service -> serialize."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.shared_mailboxes import service
from app.connect.shared.errors import DomainError
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/shared-mailboxes", tags=["connect.shared_mailboxes"])


class GrantDelegateIn(BaseModel):
    provider_connection_id: str
    delegate_user_id: int


class DelegateOut(BaseModel):
    id: str
    provider_connection_id: str
    delegate_user_id: int
    granted_by_user_id: int
    status: str
    created_at: datetime | None


def _ctx(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> TenantContext:
    return resolve_tenant(db, user)


def _to_http(e: DomainError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, **e.details})


def _to_out(d: dict[str, Any]) -> DelegateOut:
    return DelegateOut(**d)


@router.post("/delegates", status_code=201, response_model=DelegateOut)
async def grant_delegate(
    data: GrantDelegateIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        result = await service.grant_delegate_access(
            db, ctx, provider_connection_id=data.provider_connection_id, delegate_user_id=data.delegate_user_id,
        )
    except DomainError as e:
        raise _to_http(e) from e
    return _to_out(result)


@router.post("/delegates/{delegate_id}/revoke", response_model=DelegateOut)
async def revoke_delegate(
    delegate_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        result = await service.revoke_delegate_access(db, ctx, delegate_id=delegate_id)
    except DomainError as e:
        raise _to_http(e) from e
    return _to_out(result)


@router.get("/delegates", response_model=list[DelegateOut])
def get_delegates(
    provider_connection_id: str = Query(...),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        rows = service.list_delegates(db, ctx, provider_connection_id=provider_connection_id)
    except DomainError as e:
        raise _to_http(e) from e
    return [_to_out(service.to_dict(r)) for r in rows]


@router.get("/accessible")
def get_accessible_mailboxes(
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    return {"provider_connection_ids": sorted(service.accessible_connection_ids(db, ctx))}
