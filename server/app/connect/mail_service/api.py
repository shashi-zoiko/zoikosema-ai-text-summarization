"""REST facade for Mail Service. Thin: parse -> call service -> serialize."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.mail_service import assignments
from app.connect.mail_service import conversion
from app.connect.mail_service import mail_ai
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


@router.get("/search", response_model=list[MailMessageOut])
def search_mail_messages(
    q: str = Query(min_length=1),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    return [_to_out(m) for m in service.search_messages(db, ctx, query=q)]


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


class ConvertToMeetingIn(BaseModel):
    title: str
    start_at: datetime
    end_at: datetime
    timezone_name: str = "UTC"
    description: str | None = None
    location: str | None = None
    attendees: list[dict[str, Any]] = []
    resources: list[dict[str, Any]] = []
    confidentiality_class: str = "standard"
    rrule: str | None = None


class ConvertToTaskIn(BaseModel):
    title: str
    priority: str = "med"
    assignee_email: str | None = None


@router.post("/messages/{message_id}/convert-to-meeting", status_code=201)
async def convert_message_to_meeting(
    message_id: str,
    data: ConvertToMeetingIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        return await conversion.convert_to_meeting(db, ctx, message_id=message_id, **data.model_dump())
    except DomainError as e:
        raise _to_http(e) from e


@router.post("/messages/{message_id}/convert-to-task", status_code=201)
def convert_message_to_task(
    message_id: str,
    data: ConvertToTaskIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        return conversion.convert_to_task(db, ctx, message_id=message_id, **data.model_dump())
    except DomainError as e:
        raise _to_http(e) from e


class AssignMessageIn(BaseModel):
    assigned_to_user_id: int


class AssignmentStatusIn(BaseModel):
    status: str


class AssignmentOut(BaseModel):
    id: str
    message_id: str
    assigned_to_user_id: int
    assigned_by_user_id: int
    status: str
    created_at: datetime | None


class AddNoteIn(BaseModel):
    body: str


class NoteOut(BaseModel):
    id: str
    message_id: str
    author_user_id: int
    body: str
    created_at: datetime | None


@router.post("/messages/{message_id}/assign", status_code=201, response_model=AssignmentOut)
async def assign_message(
    message_id: str,
    data: AssignMessageIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        result = await assignments.assign_message(db, ctx, message_id=message_id, assigned_to_user_id=data.assigned_to_user_id)
    except DomainError as e:
        raise _to_http(e) from e
    return AssignmentOut(**result)


@router.post("/messages/{message_id}/assignment/status", response_model=AssignmentOut)
async def set_assignment_status(
    message_id: str,
    data: AssignmentStatusIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        result = await assignments.update_assignment_status(db, ctx, message_id=message_id, status=data.status)
    except DomainError as e:
        raise _to_http(e) from e
    return AssignmentOut(**result)


@router.get("/assignments", response_model=list[AssignmentOut])
def get_assignments(
    assigned_to_user_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    rows = assignments.list_assignments(db, ctx, assigned_to_user_id=assigned_to_user_id, status=status)
    return [AssignmentOut(**assignments.to_dict(r)) for r in rows]


@router.post("/messages/{message_id}/notes", status_code=201, response_model=NoteOut)
async def add_note(
    message_id: str,
    data: AddNoteIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        result = await assignments.add_note(db, ctx, message_id=message_id, body=data.body)
    except DomainError as e:
        raise _to_http(e) from e
    return NoteOut(**result)


@router.get("/messages/{message_id}/notes", response_model=list[NoteOut])
def get_notes(
    message_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        rows = assignments.list_notes(db, ctx, message_id=message_id)
    except DomainError as e:
        raise _to_http(e) from e
    return [NoteOut(**assignments.note_to_dict(r)) for r in rows]


class DraftReplyIn(BaseModel):
    instruction: str


@router.get("/threads/{thread_id}/summary")
async def get_thread_summary(
    thread_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        return await mail_ai.summarize_thread(db, ctx, thread_id=thread_id)
    except DomainError as e:
        raise _to_http(e) from e


@router.post("/threads/{thread_id}/draft-reply", status_code=201)
async def post_draft_reply(
    thread_id: str,
    data: DraftReplyIn,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        return await mail_ai.draft_reply(db, ctx, thread_id=thread_id, instruction=data.instruction)
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


class StageSendIn(BaseModel):
    provider: Literal["gmail", "microsoft_mail"]
    to_emails: list[str]
    subject: str
    body_text: str
    thread_id: str | None = None
    in_reply_to_message_id: str | None = None
    # None -> resolve the tenant's configured default (Governance.jsx mail
    # settings), not a fixed module constant — see send_service.stage_send.
    buffer_minutes: int | None = None


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
