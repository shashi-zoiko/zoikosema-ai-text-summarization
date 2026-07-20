"""Shared/group mailboxes + delegated access — Phase 4 slice 1.

Spec §1.1 ("Shared mailboxes and delegated access where they reinforce
collaboration and governance"), §10.1 ("Delegated access is represented as
graph edges and audit events, not hidden provider-only state").

A shared mailbox IS a connect_provider_connections row — this module adds
no second "mailbox" entity, just a revocable delegate list for an existing
connection. The Work Graph delegated_access edge (Person->Mailbox) written
on grant is a durable VISIBILITY record ("a grant once existed") — edges
here are append-only and can't be revoked in place, so it is deliberately
NOT the authorization source of truth. `connect_mailbox_delegates.status`
is; every real access check (accessible_connection_ids, used by
mail_service's read paths) reads that column, never edge existence alone.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.audit import service as audit
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.provider_connections.models import ProviderConnection
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import Conflict, Forbidden, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext
from app.connect.shared_mailboxes.models import MailboxDelegate

# Same coarse admin check policy_engine/api.py already established for the
# connect_* plane (no dedicated RBAC module exists yet) — "personal" (a
# solo tenant) is its own admin by definition, same reasoning as there.
_ADMIN_ROLES = {"owner", "admin", "personal"}


def _get_connection(db: DbSession, ctx: TenantContext, provider_connection_id: str) -> ProviderConnection:
    conn = db.query(ProviderConnection).filter(
        ProviderConnection.tenant_id == ctx.tenant_id, ProviderConnection.id == provider_connection_id,
    ).first()
    if conn is None:
        raise NotFound("Provider connection not found")
    return conn


def _require_can_manage(ctx: TenantContext, connection: ProviderConnection) -> None:
    if connection.user_id != ctx.user_id and ctx.role not in _ADMIN_ROLES:
        raise Forbidden("Only the mailbox's owner or a workspace admin can manage its delegates")


async def grant_delegate_access(
    db: DbSession, ctx: TenantContext, *, provider_connection_id: str, delegate_user_id: int,
) -> dict[str, Any]:
    connection = _get_connection(db, ctx, provider_connection_id)
    _require_can_manage(ctx, connection)

    existing = db.query(MailboxDelegate).filter(
        MailboxDelegate.tenant_id == ctx.tenant_id,
        MailboxDelegate.provider_connection_id == provider_connection_id,
        MailboxDelegate.delegate_user_id == delegate_user_id,
    ).first()
    if existing is not None:
        if existing.status == "active":
            return to_dict(existing)
        existing.status = "active"
        existing.granted_by_user_id = ctx.user_id
        delegate = existing
    else:
        delegate = MailboxDelegate(
            id=uuid7_str(), tenant_id=ctx.tenant_id, provider_connection_id=provider_connection_id,
            delegate_user_id=delegate_user_id, granted_by_user_id=ctx.user_id, status="active",
            correlation_id=get_correlation_id(),
        )
        db.add(delegate)
    db.flush()

    # Local import: work_graph/service.py resolves "mailbox" nodes via
    # provider_connections.models, and importing work_graph back into
    # provider_connections-adjacent modules at top level risks a cycle the
    # same way native_events.py's own attendee-linking helper does.
    from app.connect.work_graph import service as work_graph
    work_graph.create_edge(
        db, ctx, edge_type="delegated_access",
        from_node_type="person", from_node_id=str(delegate_user_id),
        to_node_type="mailbox", to_node_id=provider_connection_id,
    )

    audit.log(
        db, type="mailbox_delegate.granted", tenant_id=ctx.tenant_id, actor_user_id=ctx.user_id,
        resource_type="mailbox_delegate", resource_id=delegate.id,
        metadata={"provider_connection_id": provider_connection_id, "delegate_user_id": delegate_user_id},
    )
    env = EventEnvelope(
        type=etypes.MAILBOX_DELEGATE_GRANTED, tenant_id=ctx.tenant_id, correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={"delegate_id": delegate.id, "provider_connection_id": provider_connection_id, "delegate_user_id": delegate_user_id},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    return to_dict(delegate)


async def revoke_delegate_access(db: DbSession, ctx: TenantContext, *, delegate_id: str) -> dict[str, Any]:
    delegate = db.query(MailboxDelegate).filter(
        MailboxDelegate.tenant_id == ctx.tenant_id, MailboxDelegate.id == delegate_id,
    ).first()
    if delegate is None:
        raise NotFound("Delegate grant not found")
    connection = _get_connection(db, ctx, delegate.provider_connection_id)
    _require_can_manage(ctx, connection)
    if delegate.status != "active":
        raise Conflict(f"Delegate grant is '{delegate.status}', not 'active' — nothing to revoke")

    delegate.status = "revoked"
    db.flush()

    audit.log(
        db, type="mailbox_delegate.revoked", tenant_id=ctx.tenant_id, actor_user_id=ctx.user_id,
        resource_type="mailbox_delegate", resource_id=delegate.id, metadata={},
    )
    env = EventEnvelope(
        type=etypes.MAILBOX_DELEGATE_REVOKED, tenant_id=ctx.tenant_id, correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id, payload={"delegate_id": delegate.id},
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"tenant:{ctx.tenant_id}")
    return to_dict(delegate)


def list_delegates(db: DbSession, ctx: TenantContext, *, provider_connection_id: str) -> list[MailboxDelegate]:
    connection = _get_connection(db, ctx, provider_connection_id)
    _require_can_manage(ctx, connection)
    return (
        db.query(MailboxDelegate)
        .filter(MailboxDelegate.tenant_id == ctx.tenant_id, MailboxDelegate.provider_connection_id == provider_connection_id)
        .order_by(MailboxDelegate.created_at.desc())
        .all()
    )


def accessible_connection_ids(db: DbSession, ctx: TenantContext) -> set[str]:
    """Every provider_connection_id this user can read mail from: their own
    connections, plus any connection actively delegated to them. This is
    the real access-control check mail_service's read paths (list/search/
    get_message_body) call — see this module's own docstring for why it
    reads MailboxDelegate.status rather than Work Graph edge existence."""
    owned = (
        db.query(ProviderConnection.id)
        .filter(ProviderConnection.tenant_id == ctx.tenant_id, ProviderConnection.user_id == ctx.user_id)
        .all()
    )
    delegated = (
        db.query(MailboxDelegate.provider_connection_id)
        .filter(
            MailboxDelegate.tenant_id == ctx.tenant_id, MailboxDelegate.delegate_user_id == ctx.user_id,
            MailboxDelegate.status == "active",
        )
        .all()
    )
    return {row[0] for row in owned} | {row[0] for row in delegated}


def to_dict(delegate: MailboxDelegate) -> dict[str, Any]:
    return {
        "id": delegate.id, "provider_connection_id": delegate.provider_connection_id,
        "delegate_user_id": delegate.delegate_user_id, "granted_by_user_id": delegate.granted_by_user_id,
        "status": delegate.status,
        "created_at": delegate.created_at.isoformat() if delegate.created_at else None,
    }
