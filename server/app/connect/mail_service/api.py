"""REST facade for Mail Service. Thin: parse -> call service -> serialize."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.mail_service import send as send_service
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


class StageSendIn(BaseModel):
    provider: Literal["gmail", "microsoft_mail"]
    to_emails: list[str]
    subject: str
    body_text: str
    thread_id: str | None = None
    in_reply_to_message_id: str | None = None
    buffer_minutes: int = send_service.DEFAULT_BUFFER_MINUTES


class MailSendOut(BaseModel):
    id: str
    provider: str
    status: str
    scheduled_release_at: datetime
    dlp_verdict: dict[str, Any]
    provider_message_id: str | None
    failure_reason: str | None
    created_at: datetime | None


def _send_to_out(d: dict[str, Any]) -> MailSendOut:
    return MailSendOut(
        id=d["id"], provider=d["provider"], status=d["status"],
        scheduled_release_at=d["scheduled_release_at"], dlp_verdict=d["dlp_verdict"],
        provider_message_id=d["provider_message_id"], failure_reason=d["failure_reason"],
        created_at=d["created_at"],
    )


@router.post("/sends", status_code=201)
async def stage_send(
    data: StageSendIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        result = await send_service.stage_send(
            db, ctx, provider=data.provider, to_emails=data.to_emails, subject=data.subject,
            body_text=data.body_text, thread_id=data.thread_id,
            in_reply_to_message_id=data.in_reply_to_message_id, buffer_minutes=data.buffer_minutes,
        )
    except DomainError as e:
        raise _to_http(e) from e
    return _send_to_out(result)


@router.get("/sends", response_model=list[MailSendOut])
def list_sends(
    status: str | None = Query(default=None),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    rows = send_service.list_sends(db, ctx, status=status)
    return [_send_to_out(send_service.to_dict(r)) for r in rows]


@router.get("/sends/{send_id}", response_model=MailSendOut)
def get_send(
    send_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        row = send_service.get_send(db, ctx, send_id)
    except DomainError as e:
        raise _to_http(e) from e
    return _send_to_out(send_service.to_dict(row))


@router.post("/sends/{send_id}/cancel", response_model=MailSendOut)
async def cancel_send(
    send_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        result = await send_service.cancel_send(db, ctx, send_id)
    except DomainError as e:
        raise _to_http(e) from e
    return _send_to_out(result)
