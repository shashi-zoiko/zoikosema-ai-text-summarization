"""Action Review Queue MVP — one cross-category queue for staged actions.

Spec §5.1 / DR-06: a single queue for calendar, mail, messaging, spend, and
future agent actions — queue fragmentation is prohibited because it hides
risk from administrators and reviewers. Generic `action_type` +
`action_payload` design so any future producer (Calendar event proposal
in Phase 2 slice 3/7, later Mail drafts in Phase 3) stages into this same
table without a schema migration per action type.

This slice has no real producer yet (calendar/mail features aren't wired
in) — every function here is exercised with synthetic/manually-staged
items until slice 3/7 land. This slice also only defines the rollback
*contract* (a typed descriptor column); the executor for each descriptor
type is built by the feature that needs it, not here.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.action_review.models import ROLLBACK_DESCRIPTORS, ReviewQueueItem
from app.connect.audit import service as audit
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.shared import idempotency
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import Conflict, Invalid, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext

_STAGE_ROUTE = "POST /policy/../action-review/items"  # idempotency-key cache route label


async def stage_action(
    db: DbSession, ctx: TenantContext, *,
    action_type: str,
    action_payload: dict[str, Any],
    policy_verdicts: dict[str, Any] | None = None,
    blast_radius: dict[str, Any] | None = None,
    rollback_descriptor: str = "no_rollback",
    reasoning_trace_ref: str | None = None,
    proposed_by_agent: str | None = None,
    idempotency_key: str | None = None,
    policy_version_id: str | None = None,
) -> dict[str, Any]:
    """Returns the serialized item (already committed) — same dict-return
    convention as messaging_service.send_message, so an idempotent replay
    and a fresh write both hand the API layer the same shape without a
    second DB round-trip or reconstructing a partial ORM instance.

    `policy_version_id` (Work Graph governed_by edge, spec §3.2: "Point-in-
    time policy evidence"): the tenant's current PolicyVersion for this
    action's category, from policy_engine.get_current_version_id — passed
    in by the caller since resolving autonomy already happens there right
    before staging. None if the tenant has never set an explicit ceiling
    (still on the default, no versioned row to point at) — no edge is
    written in that case, not a stub edge to nothing."""
    if rollback_descriptor not in ROLLBACK_DESCRIPTORS:
        raise Invalid(f"Unknown rollback_descriptor: {rollback_descriptor}")

    if idempotency_key:
        cached = await idempotency.check(ctx.tenant_id, ctx.user_id, _STAGE_ROUTE, idempotency_key)
        if cached is not None:
            return cached

    item = ReviewQueueItem(
        id=uuid7_str(),
        tenant_id=ctx.tenant_id,
        action_type=action_type,
        action_payload=action_payload,
        reasoning_trace_ref=reasoning_trace_ref,
        policy_verdicts=policy_verdicts or {},
        blast_radius=blast_radius or {},
        rollback_descriptor=rollback_descriptor,
        status="pending",
        proposed_by_user_id=None if proposed_by_agent else ctx.user_id,
        proposed_by_agent=proposed_by_agent,
        correlation_id=get_correlation_id(),
    )
    db.add(item)
    db.flush()  # populate created_at server_default for the envelope/output

    if policy_version_id:
        # Local import: work_graph/service.py imports calendar_service's
        # native_events/tasks at top level, and those import this module
        # (action_review) at top level — importing work_graph back in here
        # at module scope would cycle. Same pattern native_events.py's own
        # Work Graph linking helpers already established.
        from app.connect.work_graph import service as work_graph
        work_graph.create_edge(
            db, ctx, edge_type="governed_by",
            from_node_type="agent_action", from_node_id=item.id,
            to_node_type="policy_version", to_node_id=policy_version_id,
        )

    audit.log(
        db, type="agent.action.created", tenant_id=ctx.tenant_id,
        actor_user_id=ctx.user_id, resource_type="action_review_item", resource_id=item.id,
        metadata={"action_type": action_type, "rollback_descriptor": rollback_descriptor, "proposed_by_agent": proposed_by_agent},
    )
    env = EventEnvelope(
        type=etypes.AGENT_ACTION_CREATED,
        tenant_id=ctx.tenant_id,
        correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={"item_id": item.id, "action_type": action_type},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")

    out = _to_dict(item)
    if idempotency_key:
        await idempotency.store(ctx.tenant_id, ctx.user_id, _STAGE_ROUTE, idempotency_key, out)
    return out


def list_queue(db: DbSession, ctx: TenantContext, *, status: str | None = None) -> list[ReviewQueueItem]:
    q = db.query(ReviewQueueItem).filter(ReviewQueueItem.tenant_id == ctx.tenant_id)
    if status:
        q = q.filter(ReviewQueueItem.status == status)
    return q.order_by(ReviewQueueItem.created_at.desc()).all()


def get_item(db: DbSession, ctx: TenantContext, item_id: str) -> ReviewQueueItem:
    item = (
        db.query(ReviewQueueItem)
        .filter(ReviewQueueItem.tenant_id == ctx.tenant_id, ReviewQueueItem.id == item_id)
        .first()
    )
    if item is None:
        raise NotFound("Review queue item not found")
    return item


async def _transition(
    db: DbSession, ctx: TenantContext, item_id: str, *,
    new_status: str, event_type: str, audit_type: str, note: str | None,
) -> ReviewQueueItem:
    item = get_item(db, ctx, item_id)
    if item.status != "pending":
        raise Conflict(f"Item is '{item.status}', not 'pending' — only a pending item can transition")

    item.status = new_status
    item.reviewed_by_user_id = ctx.user_id
    item.reviewed_at = datetime.now(timezone.utc)
    item.review_note = note
    db.flush()

    # Work Graph reviewed_by edge (spec §3.2: "Human approval evidence") —
    # written on every transition (approve/reject/redraft/escalate), not
    # just approve: a reject or escalation is equally real evidence a human
    # reviewed this item, matching the column this already writes
    # (reviewed_by_user_id) rather than a narrower reading of the edge name.
    # Local import — see stage_action's own comment for why.
    from app.connect.work_graph import service as work_graph
    work_graph.create_edge(
        db, ctx, edge_type="reviewed_by",
        from_node_type="agent_action", from_node_id=item.id,
        to_node_type="person", to_node_id=str(ctx.user_id),
    )

    audit.log(
        db, type=audit_type, tenant_id=ctx.tenant_id,
        actor_user_id=ctx.user_id, resource_type="action_review_item", resource_id=item.id,
        metadata={"new_status": new_status, "note": note},
    )
    env = EventEnvelope(
        type=event_type,
        tenant_id=ctx.tenant_id,
        correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={"item_id": item.id, "status": new_status},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    return item


async def approve(db: DbSession, ctx: TenantContext, item_id: str, *, note: str | None = None) -> ReviewQueueItem:
    """Marks the item approved. Does NOT execute the underlying mutation —
    that's the producing feature's job (e.g. calendar event creation in
    Phase 2 slice 3/7), which is expected to poll/consume approved items of
    its own action_type. No producer exists yet, so this is untested beyond
    the status transition itself; wiring a real executor callback is a
    follow-up for whichever slice ships the first real producer."""
    return await _transition(
        db, ctx, item_id, new_status="approved",
        event_type=etypes.ACTION_REVIEW_APPROVED, audit_type="action_review.approved", note=note,
    )


async def reject(db: DbSession, ctx: TenantContext, item_id: str, *, note: str | None = None) -> ReviewQueueItem:
    return await _transition(
        db, ctx, item_id, new_status="rejected",
        event_type=etypes.ACTION_REVIEW_REJECTED, audit_type="action_review.rejected", note=note,
    )


async def request_redraft(db: DbSession, ctx: TenantContext, item_id: str, *, note: str | None = None) -> ReviewQueueItem:
    return await _transition(
        db, ctx, item_id, new_status="redraft_requested",
        event_type=etypes.ACTION_REVIEW_REDRAFT_REQUESTED, audit_type="action_review.redraft_requested", note=note,
    )


async def escalate(db: DbSession, ctx: TenantContext, item_id: str, *, note: str | None = None) -> ReviewQueueItem:
    return await _transition(
        db, ctx, item_id, new_status="escalated",
        event_type=etypes.ACTION_REVIEW_ESCALATED, audit_type="action_review.escalated", note=note,
    )


def _to_dict(item: ReviewQueueItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "action_type": item.action_type,
        "action_payload": item.action_payload,
        "reasoning_trace_ref": item.reasoning_trace_ref,
        "policy_verdicts": item.policy_verdicts,
        "blast_radius": item.blast_radius,
        "rollback_descriptor": item.rollback_descriptor,
        "status": item.status,
        "proposed_by_user_id": item.proposed_by_user_id,
        "proposed_by_agent": item.proposed_by_agent,
        "reviewed_by_user_id": item.reviewed_by_user_id,
        "reviewed_at": item.reviewed_at.isoformat() if item.reviewed_at else None,
        "review_note": item.review_note,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }
