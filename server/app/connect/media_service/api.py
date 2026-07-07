"""Media token endpoint. Callers (joined session members) exchange a session
context for a short-lived vendor token. The vendor SDK is all the client
needs from this point on.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.media_service import service
from app.connect.session_service import service as session_service
from app.connect.shared.errors import DomainError
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/media", tags=["connect.media"])


class TokenRequest(BaseModel):
    session_id: str


class TokenResponse(BaseModel):
    access_token: str
    room_name: str
    identity: str
    expires_at: int


def _ctx(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> TenantContext:
    return resolve_tenant(db, user)


@router.post("/tokens", response_model=TokenResponse)
async def issue_token(
    req: TokenRequest,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        session = session_service.get_session(db, ctx, req.session_id)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message) from e

    if session.status not in ("active", "pending_start"):
        raise HTTPException(status_code=409, detail=f"Session is {session.status}")
    if session.media_room_ref is None:
        raise HTTPException(status_code=409, detail="Media room not provisioned")

    # Membership check: only admitted members get media tokens
    member = next((m for m in session.members if m.user_id == user.id), None)
    if member is None or member.status != "admitted":
        raise HTTPException(status_code=403, detail="Not admitted to this session")

    token = await service.generate_token(
        media_room_ref=session.media_room_ref,
        user_id=user.id,
        display_name=user.name,
        role=member.role,
        avatar_url=user.avatar_url if user.show_photo_in_meetings else None,
    )
    return TokenResponse(
        access_token=token.access_token,
        room_name=token.room_name,
        identity=token.identity,
        expires_at=token.expires_at,
    )
