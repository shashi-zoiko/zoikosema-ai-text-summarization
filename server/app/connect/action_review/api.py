"""REST facade for Action Review Queue Service. Thin: parse → call service → serialize."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.action_review import service
from app.connect.action_review.models import ROLLBACK_DESCRIPTORS, STATUSES, ReviewQueueItem
from app.connect.shared.errors import DomainError
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/action-review", tags=["connect.action_review"])

# Written out explicitly (not derived from the models.py tuples) so Literal's
# static type-checking works the same way provider_connections/api.py's
# _PROVIDERS does — keep in sync with ROLLBACK_DESCRIPTORS / STATUSES by hand.
_ROLLBACK_DESCRIPTOR = Literal["restore_previous_version", "cancel_buffered_send", "tombstone_message", "no_rollback"]
_STATUS = Literal["pending", "approved", "rejected", "redraft_requested", "escalated"]

assert set(_ROLLBACK_DESCRIPTOR.__args__) == set(ROLLBACK_DESCRIPTORS)
assert set(_STATUS.__args__) == set(STATUSES)


def _ctx(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> TenantContext:
    return resolve_tenant(db, user)


def _to_http(e: DomainError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, **e.details})


class StageActionIn(BaseModel):
    action_type: str
    action_payload: dict[str, Any]
    policy_verdicts: dict[str, Any] | None = None
    blast_radius: dict[str, Any] | None = None
    rollback_descriptor: _ROLLBACK_DESCRIPTOR = "no_rollback"
    reasoning_trace_ref: str | None = None
    proposed_by_agent: str | None = None


class ReviewNoteIn(BaseModel):
    note: str | None = None


class ReviewQueueItemOut(BaseModel):
    id: str
    action_type: str
    action_payload: dict[str, Any]
    reasoning_trace_ref: str | None
    policy_verdicts: dict[str, Any]
    blast_radius: dict[str, Any]
    rollback_descriptor: str
    status: str
    proposed_by_user_id: int | None
    proposed_by_agent: str | None
    reviewed_by_user_id: int | None
    reviewed_at: datetime | None
    review_note: str | None
    created_at: datetime | None


def _orm_to_out(item: ReviewQueueItem) -> ReviewQueueItemOut:
    return ReviewQueueItemOut(
        id=item.id, action_type=item.action_type, action_payload=item.action_payload,
        reasoning_trace_ref=item.reasoning_trace_ref, policy_verdicts=item.policy_verdicts,
        blast_radius=item.blast_radius, rollback_descriptor=item.rollback_descriptor, status=item.status,
        proposed_by_user_id=item.proposed_by_user_id, proposed_by_agent=item.proposed_by_agent,
        reviewed_by_user_id=item.reviewed_by_user_id, reviewed_at=item.reviewed_at,
        review_note=item.review_note, created_at=item.created_at,
    )


@router.post("/items", response_model=ReviewQueueItemOut, status_code=201)
async def stage_action(
    data: StageActionIn,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        out = await service.stage_action(
            db, ctx,
            action_type=data.action_type, action_payload=data.action_payload,
            policy_verdicts=data.policy_verdicts, blast_radius=data.blast_radius,
            rollback_descriptor=data.rollback_descriptor, reasoning_trace_ref=data.reasoning_trace_ref,
            proposed_by_agent=data.proposed_by_agent, idempotency_key=idempotency_key,
        )
    except DomainError as e:
        raise _to_http(e) from e
    return ReviewQueueItemOut(**out)


@router.get("/items", response_model=list[ReviewQueueItemOut])
def list_queue(
    status: _STATUS | None = Query(default=None),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    return [_orm_to_out(i) for i in service.list_queue(db, ctx, status=status)]


@router.get("/items/{item_id}", response_model=ReviewQueueItemOut)
def get_item(
    item_id: str,
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    try:
        item = service.get_item(db, ctx, item_id)
    except DomainError as e:
        raise _to_http(e) from e
    return _orm_to_out(item)


@router.post("/items/{item_id}/approve", response_model=ReviewQueueItemOut)
async def approve(
    item_id: str, data: ReviewNoteIn = ReviewNoteIn(),
    db: DbSession = Depends(get_db), ctx: TenantContext = Depends(_ctx),
):
    try:
        item = await service.approve(db, ctx, item_id, note=data.note)
    except DomainError as e:
        raise _to_http(e) from e
    return _orm_to_out(item)


@router.post("/items/{item_id}/reject", response_model=ReviewQueueItemOut)
async def reject(
    item_id: str, data: ReviewNoteIn = ReviewNoteIn(),
    db: DbSession = Depends(get_db), ctx: TenantContext = Depends(_ctx),
):
    try:
        item = await service.reject(db, ctx, item_id, note=data.note)
    except DomainError as e:
        raise _to_http(e) from e
    return _orm_to_out(item)


@router.post("/items/{item_id}/request-redraft", response_model=ReviewQueueItemOut)
async def request_redraft(
    item_id: str, data: ReviewNoteIn = ReviewNoteIn(),
    db: DbSession = Depends(get_db), ctx: TenantContext = Depends(_ctx),
):
    try:
        item = await service.request_redraft(db, ctx, item_id, note=data.note)
    except DomainError as e:
        raise _to_http(e) from e
    return _orm_to_out(item)


@router.post("/items/{item_id}/escalate", response_model=ReviewQueueItemOut)
async def escalate(
    item_id: str, data: ReviewNoteIn = ReviewNoteIn(),
    db: DbSession = Depends(get_db), ctx: TenantContext = Depends(_ctx),
):
    try:
        item = await service.escalate(db, ctx, item_id, note=data.note)
    except DomainError as e:
        raise _to_http(e) from e
    return _orm_to_out(item)
