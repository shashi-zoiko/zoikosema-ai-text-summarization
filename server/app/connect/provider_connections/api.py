"""REST facade for Provider Connection Service. Thin: parse → call service → serialize."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.provider_connections import service
from app.connect.shared.errors import DomainError
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/provider-connections", tags=["connect.provider_connections"])


class ConnectProviderIn(BaseModel):
    provider: Literal["google_calendar", "microsoft_calendar"]
    authorization_code: str


class ProviderConnectionOut(BaseModel):
    id: str
    provider: str
    provider_account_email: str
    scopes: list[str]
    status: str
    access_token_expires_at: datetime | None


def _to_out(c) -> ProviderConnectionOut:
    return ProviderConnectionOut(
        id=c.id, provider=c.provider, provider_account_email=c.provider_account_email,
        scopes=c.scopes, status=c.status, access_token_expires_at=c.access_token_expires_at,
    )


def _ctx(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> TenantContext:
    return resolve_tenant(db, user)


def _to_http(e: DomainError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, **e.details})


@router.post("", response_model=ProviderConnectionOut, status_code=201)
async def connect_provider(
    data: ConnectProviderIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        c = await service.connect_provider(
            db, ctx, provider=data.provider, authorization_code=data.authorization_code,
        )
    except DomainError as e:
        raise _to_http(e) from e
    return _to_out(c)


@router.get("", response_model=list[ProviderConnectionOut])
def list_connections(
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    return [_to_out(c) for c in service.list_connections(db, ctx)]


@router.delete("/{provider}", status_code=200)
async def disconnect_provider(
    provider: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        await service.disconnect_provider(db, ctx, provider=provider)
    except DomainError as e:
        raise _to_http(e) from e
    return {"ok": True}
