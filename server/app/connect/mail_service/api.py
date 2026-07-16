"""REST facade for Mail Service. Thin: parse -> call service -> serialize."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.mail_service import service
from app.connect.shared.errors import DomainError
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/mail", tags=["connect.mail"])


class SyncMailIn(BaseModel):
    provider: Literal["gmail", "microsoft_mail"]


class MailMessageOut(BaseModel):
    id: str
    provider: str
    thread_id: str
    subject: str | None
    snippet: str | None
    from_email: str
    to_emails: list[str]
    sender_domain: str
    received_at: datetime
    label_ids: list[str]


class MailAttachmentOut(BaseModel):
    provider_attachment_id: str
    filename: str
    size_bytes: int
    content_type: str


class MailMessageBodyOut(BaseModel):
    html: str | None
    text: str | None
    attachments: list[MailAttachmentOut]


def _to_out(m) -> MailMessageOut:
    return MailMessageOut(
        id=m.id, provider=m.provider, thread_id=m.thread_id, subject=m.subject, snippet=m.snippet,
        from_email=m.from_email, to_emails=m.to_emails, sender_domain=m.sender_domain,
        received_at=m.received_at, label_ids=m.label_ids,
    )


def _ctx(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> TenantContext:
    return resolve_tenant(db, user)


def _to_http(e: DomainError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, **e.details})


@router.post("/sync", status_code=200)
async def sync_mail(
    data: SyncMailIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        return await service.sync_mail(db, ctx, provider=data.provider)
    except DomainError as e:
        raise _to_http(e) from e


@router.get("/messages", response_model=list[MailMessageOut])
def list_mail_messages(
    time_min: datetime | None = Query(default=None),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    return [_to_out(m) for m in service.list_mail_messages(db, ctx, time_min=time_min)]


@router.get("/messages/{message_id}/body", response_model=MailMessageBodyOut)
async def get_mail_message_body(
    message_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        return await service.get_message_body(db, ctx, message_id)
    except DomainError as e:
        raise _to_http(e) from e


@router.get("/image-proxy")
async def image_proxy(
    url: str = Query(...),
    # Auth-gated (not a public open proxy) — same _ctx dependency as every
    # other mail endpoint, even though the response doesn't depend on tenant
    # data, to avoid this becoming an anonymous SSRF/abuse relay.
    ctx: TenantContext = Depends(_ctx),
):
    try:
        content, content_type = await service.fetch_proxied_image(url)
    except DomainError as e:
        raise _to_http(e) from e
    return Response(content=content, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})
