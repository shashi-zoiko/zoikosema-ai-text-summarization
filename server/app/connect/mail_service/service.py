"""Mail Service — read-only provider sync + stored-message queries.

Same shape as calendar_service.service.sync_calendar: load connection ->
ensure valid access token -> adapter call -> upsert rows -> one audit row +
one outbox event per sync run (not per message, same "no per-item consumer
yet" reasoning calendar_service already established).

Unlike Calendar, Gmail's incremental mechanism (history.list) requires a
historyId checkpoint minted by a prior full pull, so "full pull" and
"incremental" are two branches of one function here, not a deferred
follow-up the way Calendar's optional syncToken allowed (see
plans/sema-p3-s2-gmail-readonly-sync.md).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session as DbSession

from app.connect.audit import service as audit
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.mail_service.models import MailMessage
from app.connect.provider_connections import service as provider_connections_service
from app.connect.provider_connections.adapters import get_adapter
from app.connect.provider_connections.models import ProviderConnection
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext

DEFAULT_SYNC_WINDOW_PAST = timedelta(days=30)


async def sync_mail(db: DbSession, ctx: TenantContext, *, provider: str) -> dict:
    adapter = get_adapter(provider)
    # Incremental-sync convention (duck-typed, same as get_adapter()'s existing
    # style): an adapter opts in by exposing list_messages_delta(access_token,
    # start_history_id=...) -> (messages, next_checkpoint), and a HistoryExpired
    # exception class raised when the stored checkpoint is too old to resume
    # from. Adapters without incremental support (or a not-yet-built Outlook
    # Mail adapter) simply don't define these, and full-pull is used instead.
    list_messages_delta = getattr(adapter, "list_messages_delta", None)
    history_expired = getattr(adapter, "HistoryExpired", None)

    connection = (
        db.query(ProviderConnection)
        .filter(
            ProviderConnection.tenant_id == ctx.tenant_id,
            ProviderConnection.user_id == ctx.user_id,
            ProviderConnection.provider == provider,
            ProviderConnection.status == "active",
        )
        .first()
    )
    if connection is None:
        raise NotFound("No active provider connection for this provider")

    access_token = await provider_connections_service.ensure_valid_access_token(db, connection, adapter)

    mode = "full"
    if list_messages_delta and connection.mail_history_id:
        try:
            raw_messages, next_history_id = await list_messages_delta(
                access_token, start_history_id=connection.mail_history_id,
            )
            mode = "incremental"
        except Exception as exc:
            if history_expired is not None and isinstance(exc, history_expired):
                connection.mail_history_id = None
                raw_messages = None  # fall through to full pull below
            else:
                raise
    else:
        raw_messages = None

    if raw_messages is None:
        now = datetime.now(timezone.utc)
        raw_messages = await adapter.list_messages(access_token, time_min=now - DEFAULT_SYNC_WINDOW_PAST)
        next_history_id = connection.mail_history_id

    created = 0
    updated = 0
    for raw in raw_messages:
        existing = (
            db.query(MailMessage)
            .filter(
                MailMessage.tenant_id == ctx.tenant_id,
                MailMessage.provider_connection_id == connection.id,
                MailMessage.provider_message_id == raw.provider_message_id,
            )
            .first()
        )
        if existing:
            existing.subject = raw.subject
            existing.snippet = raw.snippet
            existing.from_email = raw.from_email
            existing.to_emails = raw.to_emails
            existing.sender_domain = raw.sender_domain
            existing.history_id = raw.history_id
            existing.label_ids = raw.label_ids
            updated += 1
        else:
            db.add(MailMessage(
                id=uuid7_str(),
                tenant_id=ctx.tenant_id,
                user_id=ctx.user_id,
                provider_connection_id=connection.id,
                provider=provider,
                provider_message_id=raw.provider_message_id,
                thread_id=raw.thread_id,
                subject=raw.subject,
                snippet=raw.snippet,
                from_email=raw.from_email,
                to_emails=raw.to_emails,
                sender_domain=raw.sender_domain,
                received_at=raw.received_at,
                history_id=raw.history_id,
                label_ids=raw.label_ids,
                correlation_id=get_correlation_id(),
            ))
            created += 1

        if raw.history_id and (next_history_id is None or raw.history_id > next_history_id):
            next_history_id = raw.history_id

    if list_messages_delta:
        connection.mail_history_id = next_history_id

    audit.log(
        db, type="mail.sync.completed", tenant_id=ctx.tenant_id,
        actor_user_id=ctx.user_id, resource_type="provider_connection",
        resource_id=connection.id,
        metadata={"provider": provider, "mode": mode, "fetched": len(raw_messages), "created": created, "updated": updated},
    )
    env = EventEnvelope(
        type=etypes.MAIL_MESSAGE_SYNCED,
        tenant_id=ctx.tenant_id,
        correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={
            "provider_connection_id": connection.id, "provider": provider, "mode": mode,
            "fetched": len(raw_messages), "created": created, "updated": updated,
        },
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"provider_connection:{connection.id}")
    return {"mode": mode, "fetched": len(raw_messages), "created": created, "updated": updated}


def list_mail_messages(
    db: DbSession, ctx: TenantContext, *, time_min: datetime | None = None,
) -> list[MailMessage]:
    q = db.query(MailMessage).filter(
        MailMessage.tenant_id == ctx.tenant_id, MailMessage.user_id == ctx.user_id,
    )
    if time_min is not None:
        q = q.filter(MailMessage.received_at >= time_min)
    return q.order_by(MailMessage.received_at.desc()).all()
