"""REST facade for Work Graph Service. Thin: parse -> call service -> serialize."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DbSession

from app.connect.work_graph import service
from app.connect.shared.errors import DomainError
from app.connect.shared.tenant import TenantContext, resolve_tenant
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/work-graph", tags=["connect.work_graph"])

_NODE_TYPE = Literal["person", "email", "calendar_event", "task"]


class SubgraphEdgeOut(BaseModel):
    edge_type: str
    direction: str
    node: dict


class SubgraphOut(BaseModel):
    node: dict
    edges: list[SubgraphEdgeOut]


def _ctx(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> TenantContext:
    return resolve_tenant(db, user)


def _to_http(e: DomainError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message, **e.details})


@router.get("/subgraph", response_model=SubgraphOut)
def get_subgraph(
    node_type: _NODE_TYPE,
    node_id: str,
    edge_types: str | None = Query(default=None, description="Comma-separated edge types to filter on"),
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    parsed_edge_types = [e.strip() for e in edge_types.split(",") if e.strip()] if edge_types else None
    try:
        return service.query_subgraph(db, ctx, node_type=node_type, node_id=node_id, edge_types=parsed_edge_types)
    except DomainError as e:
        raise _to_http(e) from e


@router.post("/backfill/tasks", status_code=200)
def backfill_tasks(
    db: DbSession = Depends(get_db),
    ctx: TenantContext = Depends(_ctx),
):
    """Runs Phase 2 slice 8's promised backfill (Task.source_event_id ->
    a real derived_from edge) for the calling tenant. Safe to re-run —
    create_edge() is idempotent."""
    try:
        created = service.backfill_task_derived_from_edges(db, ctx)
    except DomainError as e:
        raise _to_http(e) from e
    return {"created": created}
