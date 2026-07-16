"""REST facade for Provider Connection Service. Thin: parse → call service → serialize."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.provider_connections import service
from app.connect.provider_connections.adapters import get_adapter
from app.connect.shared.errors import DomainError
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/provider-connections", tags=["connect.provider_connections"])

_PROVIDERS = Literal["google_calendar", "microsoft_calendar", "gmail", "microsoft_mail"]


class ConnectProviderIn(BaseModel):
    provider: _PROVIDERS
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


# ── Admin consent / OAuth connect flow (Phase 1 slice 6) ────────────────────
#
# /authorize is a normal authenticated API call: the SPA fetches the consent
# URL, then does a full browser navigation to it (not a fetch) so the user
# can actually see and approve the Google/Microsoft consent screen.
#
# /callback is what Google/Microsoft redirect the browser back to — a plain
# GET with no Authorization header, since the browser (not our SPA's fetch
# client) is the one making this request. That's why it carries no
# `Depends(get_current_user)`: the signed `state` param (minted by /authorize)
# is what recovers which user/provider this callback belongs to, and doubles
# as CSRF protection since it can't be forged without jwt_secret.

@router.get("/authorize")
def get_authorization_url(
    provider: _PROVIDERS = Query(...),
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    adapter = get_adapter(provider)
    state = service.create_oauth_state(user.id, provider)
    try:
        url = adapter.build_authorization_url(state)
    except DomainError as e:
        raise _to_http(e) from e
    return {"authorization_url": url}


@router.get("/callback")
async def oauth_callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    db: DbSession = Depends(get_db),
):
    frontend_base = get_settings().frontend_url.rstrip("/")
    return_url = f"{frontend_base}/settings/calendar"

    if error:
        # User declined consent, or the provider otherwise short-circuited —
        # not a bug, just report it back to the SPA instead of a 500.
        return RedirectResponse(f"{return_url}?error={error}")
    if not (code and state):
        return RedirectResponse(f"{return_url}?error=missing_code_or_state")

    # `provider` is recovered from `state`, not a query param — Google/
    # Microsoft's redirect back only ever carries `code`/`state`/`error`.
    try:
        user_id, provider = service.verify_oauth_state(state)
        user = db.get(User, user_id)
        if user is None:
            raise DomainError("User for this OAuth state no longer exists")
        ctx = resolve_tenant(db, user)
        await service.connect_provider(db, ctx, provider=provider, authorization_code=code)
    except DomainError as e:
        log.warning("provider connect callback failed: %s", e.message)
        return RedirectResponse(f"{return_url}?error={e.code}")

    return RedirectResponse(f"{return_url}?connected={provider}")
