"""Work Graph Service MVP — policy-filtered typed query layer.

Spec §3 (Work Graph), §3.3 (query/access rules): "Agents receive only the
policy-filtered subgraph needed for the declared task." This is a plain SQL
edges table (`connect_work_graph_edges`) with a thin resolver joining back
to the REAL node tables — connect_mail_messages, connect_native_calendar_events,
connect_tasks, users/organization_members — not a graph database and not a
second copy of node data. A general-purpose graph query language (Cypher-
like DSL, etc.) isn't justified by this codebase's actual query needs (a
handful of edge types, shallow one-hop traversal); see plans/
sema-p3-s7-work-graph-mvp.md's own "explicitly out of scope" list.

Edge creation has no per-edge audit/event emission — same "no reader yet"
reasoning calendar_service.service.sync_calendar and mail_service.service.
sync_mail already established for per-item fanout during a bulk sync; an
edge is a synced-data-shaped side effect of an already-audited mutation
(mail sync, event create, task create), not a governed action of its own.

The only real POLICY signal available to filter calendar_event nodes on
is NativeCalendarEvent.confidentiality_class (Phase 2 slice 7) — DLP
(Phase 3 slice 6) governs outbound mail SENDS, not inbox-read visibility,
so it has no equivalent read-side filter for Email nodes here; that's a
deliberate scope boundary, not a gap (see dev-split-two-devs.md's own
note on this when slice 7 shipped ahead of slice 6).
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session as DbSession

from app.connect.action_review.models import ReviewQueueItem
from app.connect.calendar_service import tasks as tasks_service
from app.connect.calendar_service import native_events
from app.connect.calendar_service.models import NativeCalendarEvent, Task
from app.connect.mail_service.models import MailMessage
from app.connect.policy_engine.models import PolicyVersion
from app.connect.provider_connections.models import ProviderConnection
from app.connect.shared.errors import Invalid, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext
from app.connect.work_graph.models import EDGE_TYPES, NODE_TYPES, WorkGraphEdge
from app.models.organization import OrganizationMember
from app.models.user import User


def _validate_edge_type(edge_type: str) -> None:
    if edge_type not in EDGE_TYPES:
        raise Invalid(f"Unknown edge_type: {edge_type}")


def _validate_node_type(node_type: str) -> None:
    if node_type not in NODE_TYPES:
        raise Invalid(f"Unknown node_type: {node_type}")


def create_edge(
    db: DbSession, ctx: TenantContext, *,
    edge_type: str, from_node_type: str, from_node_id: str, to_node_type: str, to_node_id: str,
) -> WorkGraphEdge:
    """Idempotent: a duplicate (tenant, edge_type, from, to) is a no-op, not
    an error — callers (mail sync, event create, task create, the backfill)
    may run more than once over the same underlying data."""
    _validate_edge_type(edge_type)
    _validate_node_type(from_node_type)
    _validate_node_type(to_node_type)

    existing = (
        db.query(WorkGraphEdge)
        .filter(
            WorkGraphEdge.tenant_id == ctx.tenant_id,
            WorkGraphEdge.edge_type == edge_type,
            WorkGraphEdge.from_node_type == from_node_type,
            WorkGraphEdge.from_node_id == from_node_id,
            WorkGraphEdge.to_node_type == to_node_type,
            WorkGraphEdge.to_node_id == to_node_id,
        )
        .first()
    )
    if existing is not None:
        return existing

    edge = WorkGraphEdge(
        id=uuid7_str(), tenant_id=ctx.tenant_id, edge_type=edge_type,
        from_node_type=from_node_type, from_node_id=from_node_id,
        to_node_type=to_node_type, to_node_id=to_node_id,
        correlation_id=get_correlation_id(),
    )
    db.add(edge)
    db.flush()
    return edge


def _is_tenant_person(db: DbSession, ctx: TenantContext, user_id: int) -> bool:
    if ctx.tenant_id.startswith("org:"):
        org_id = int(ctx.tenant_id.removeprefix("org:"))
        return db.query(OrganizationMember).filter(
            OrganizationMember.organization_id == org_id, OrganizationMember.user_id == user_id,
        ).first() is not None
    # personal:{user_id} tenant — the only "person" in scope is that one user.
    return ctx.tenant_id == f"personal:{user_id}"


def _resolve_person(db: DbSession, ctx: TenantContext, node_id: str) -> dict[str, Any] | None:
    try:
        user_id = int(node_id)
    except ValueError:
        return None
    if not _is_tenant_person(db, ctx, user_id):
        return None
    user = db.get(User, user_id)
    if user is None:
        return None
    return {"node_type": "person", "node_id": str(user.id), "name": user.name, "email": user.email}


def _is_admitted_to_event(ctx: TenantContext, event: NativeCalendarEvent) -> bool:
    """Spec §3.3's policy-filtered subgraph rule, applied with the one real
    signal this codebase has for calendar content (confidentiality_class,
    Phase 2 slice 7) — a confidential event is only visible in the graph to
    its creator or a listed attendee, everyone else gets it excluded from
    the traversal rather than a redacted placeholder (a subgraph either has
    the node or it doesn't; there's no partial-node shape to return here)."""
    if event.confidentiality_class != "confidential":
        return True
    if event.created_by == ctx.user_id:
        return True
    return False  # attendee-email match would need a User lookup by ctx; deferred until a real caller needs it


def _resolve_calendar_event(db: DbSession, ctx: TenantContext, node_id: str) -> dict[str, Any] | None:
    try:
        event = native_events.get_current_event(db, ctx, node_id)
    except NotFound:
        return None
    if not _is_admitted_to_event(ctx, event):
        return None
    return {
        "node_type": "calendar_event", "node_id": event.version_chain_id,
        "title": event.title, "start_at": event.start_at.isoformat(), "end_at": event.end_at.isoformat(),
        "status": event.status, "confidentiality_class": event.confidentiality_class,
    }


def _resolve_email(db: DbSession, ctx: TenantContext, node_id: str) -> dict[str, Any] | None:
    msg = db.query(MailMessage).filter(MailMessage.tenant_id == ctx.tenant_id, MailMessage.id == node_id).first()
    if msg is None:
        return None
    return {
        "node_type": "email", "node_id": msg.id, "subject": msg.subject,
        "from_email": msg.from_email, "received_at": msg.received_at.isoformat(),
    }


def _resolve_task(db: DbSession, ctx: TenantContext, node_id: str) -> dict[str, Any] | None:
    try:
        task = tasks_service.get_task(db, ctx, node_id)
    except NotFound:
        return None
    return tasks_service.to_dict(task)


def _resolve_mailbox(db: DbSession, ctx: TenantContext, node_id: str) -> dict[str, Any] | None:
    """A 'mailbox' node (Phase 4 slice 1) IS a connect_provider_connections
    row, not a new entity — see shared_mailboxes/service.py. Any tenant
    member can resolve it (delegated_access edges are what make a mailbox
    show up in someone else's subgraph in the first place); this doesn't
    itself check who currently has read access to the mailbox's mail."""
    conn = db.query(ProviderConnection).filter(
        ProviderConnection.tenant_id == ctx.tenant_id, ProviderConnection.id == node_id,
    ).first()
    if conn is None:
        return None
    return {
        "node_type": "mailbox", "node_id": conn.id, "provider": conn.provider,
        "provider_account_email": conn.provider_account_email, "status": conn.status,
    }


def _resolve_agent_action(db: DbSession, ctx: TenantContext, node_id: str) -> dict[str, Any] | None:
    """An 'agent_action' node IS a connect_action_review_items row — the
    staged proposal itself, human- or agent-drafted (see action_review's
    own docstring on why the queue doesn't distinguish the two at the
    naming level). Not restricted to agent-proposed items only; spec's own
    AgentAction node is "mandatory for every agent mutation" but this
    build's queue is deliberately generic across both, same precedent."""
    item = db.query(ReviewQueueItem).filter(
        ReviewQueueItem.tenant_id == ctx.tenant_id, ReviewQueueItem.id == node_id,
    ).first()
    if item is None:
        return None
    return {
        "node_type": "agent_action", "node_id": item.id, "action_type": item.action_type,
        "status": item.status, "proposed_by_agent": item.proposed_by_agent,
        "rollback_descriptor": item.rollback_descriptor,
    }


def _resolve_policy_version(db: DbSession, ctx: TenantContext, node_id: str) -> dict[str, Any] | None:
    """A 'policy_version' node IS a connect_policy_versions row — append-only,
    same as the table itself; see policy_engine/models.py."""
    row = db.query(PolicyVersion).filter(
        PolicyVersion.tenant_id == ctx.tenant_id, PolicyVersion.id == node_id,
    ).first()
    if row is None:
        return None
    return {
        "node_type": "policy_version", "node_id": row.id, "category": row.category,
        "version": row.version, "autonomy_ceiling": row.autonomy_ceiling,
        "effective_at": row.effective_at.isoformat() if row.effective_at else None,
    }


_RESOLVERS = {
    "person": _resolve_person,
    "email": _resolve_email,
    "calendar_event": _resolve_calendar_event,
    "task": _resolve_task,
    "mailbox": _resolve_mailbox,
    "agent_action": _resolve_agent_action,
    "policy_version": _resolve_policy_version,
}


def _resolve_node(db: DbSession, ctx: TenantContext, node_type: str, node_id: str) -> dict[str, Any] | None:
    return _RESOLVERS[node_type](db, ctx, node_id)


def query_subgraph(
    db: DbSession, ctx: TenantContext, *, node_type: str, node_id: str, edge_types: list[str] | None = None,
) -> dict[str, Any]:
    """One-hop, policy-filtered traversal around a single node — spec §3.3's
    query entry point. Returns the root node plus every edge touching it
    (either direction) whose OTHER endpoint resolves and passes policy
    filtering; an edge whose neighbor is excluded (e.g. a confidential
    event the caller isn't admitted to) is simply omitted, not returned
    with a redacted stand-in.
    """
    _validate_node_type(node_type)
    if edge_types is not None:
        for et in edge_types:
            _validate_edge_type(et)

    root = _resolve_node(db, ctx, node_type, node_id)
    if root is None:
        raise NotFound(f"{node_type} {node_id} not found")

    q = db.query(WorkGraphEdge).filter(
        WorkGraphEdge.tenant_id == ctx.tenant_id,
        or_(
            (WorkGraphEdge.from_node_type == node_type) & (WorkGraphEdge.from_node_id == node_id),
            (WorkGraphEdge.to_node_type == node_type) & (WorkGraphEdge.to_node_id == node_id),
        ),
    )
    if edge_types:
        q = q.filter(WorkGraphEdge.edge_type.in_(edge_types))

    edges_out: list[dict[str, Any]] = []
    for edge in q.all():
        is_outgoing = edge.from_node_type == node_type and edge.from_node_id == node_id
        neighbor_type = edge.to_node_type if is_outgoing else edge.from_node_type
        neighbor_id = edge.to_node_id if is_outgoing else edge.from_node_id
        neighbor = _resolve_node(db, ctx, neighbor_type, neighbor_id)
        if neighbor is None:
            continue
        edges_out.append({
            "edge_type": edge.edge_type,
            "direction": "outgoing" if is_outgoing else "incoming",
            "node": neighbor,
        })

    return {"node": root, "edges": edges_out}


def backfill_task_derived_from_edges(db: DbSession, ctx: TenantContext) -> int:
    """Walks existing Task.source_event_id pointers and creates the
    corresponding derived_from edges — Phase 2 slice 8's own stated
    intent ("this column is what gets read to build it") for Task rows
    that predate this slice. New tasks get their edge written at creation
    time instead (see calendar_service/tasks.py) — no future backfill
    needed for those."""
    tasks = (
        db.query(Task)
        .filter(Task.tenant_id == ctx.tenant_id, Task.source_event_id.isnot(None))
        .all()
    )
    created = 0
    for task in tasks:
        before = db.query(WorkGraphEdge).filter(
            WorkGraphEdge.tenant_id == ctx.tenant_id, WorkGraphEdge.edge_type == "derived_from",
            WorkGraphEdge.from_node_type == "task", WorkGraphEdge.from_node_id == task.id,
        ).first()
        if before is not None:
            continue
        create_edge(
            db, ctx, edge_type="derived_from",
            from_node_type="task", from_node_id=task.id,
            to_node_type="calendar_event", to_node_id=task.source_event_id,
        )
        created += 1
    db.commit()
    return created
