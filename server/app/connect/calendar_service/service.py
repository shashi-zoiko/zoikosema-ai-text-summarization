"""Calendar Service — read-only provider sync + stored-event queries.

Nothing else in the codebase is allowed to mutate connect_calendar_events.
Sync is a full pull over a bounded window (no incremental syncToken yet —
that's the next hardening slice, see architecture/SEMA_CALENDAR_MAIL_CONTEXT.md
§4). One audit row and one outbox event per sync run, not per event: nothing
consumes per-event fanout yet and Google Calendar sync windows can return
hundreds of events, so per-event audit/outbox rows would be pure overhead.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session as DbSession

from app.connect.audit import service as audit
from app.connect.calendar_service.models import CalendarEvent
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.provider_connections import service as provider_connections_service
from app.connect.provider_connections.adapters import get_adapter
from app.connect.provider_connections.models import ProviderConnection
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext

DEFAULT_SYNC_WINDOW_PAST = timedelta(days=7)
DEFAULT_SYNC_WINDOW_FUTURE = timedelta(days=90)


async def sync_calendar(db: DbSession, ctx: TenantContext, *, provider: str) -> dict:
    adapter = get_adapter(provider)

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

    now = datetime.now(timezone.utc)
    time_min = now - DEFAULT_SYNC_WINDOW_PAST
    time_max = now + DEFAULT_SYNC_WINDOW_FUTURE
    raw_events = await adapter.list_events(access_token, time_min=time_min, time_max=time_max)

    created = 0
    updated = 0
    for raw in raw_events:
        existing = (
            db.query(CalendarEvent)
            .filter(
                CalendarEvent.tenant_id == ctx.tenant_id,
                CalendarEvent.provider_connection_id == connection.id,
                CalendarEvent.provider_event_id == raw.provider_event_id,
            )
            .first()
        )
        if existing:
            existing.title = raw.title
            existing.description = raw.description
            existing.location = raw.location
            existing.start_at = raw.start_at
            existing.end_at = raw.end_at
            existing.all_day = raw.all_day
            existing.status = raw.status
            existing.attendees = raw.attendees
            updated += 1
        else:
            db.add(CalendarEvent(
                id=uuid7_str(),
                tenant_id=ctx.tenant_id,
                user_id=ctx.user_id,
                provider_connection_id=connection.id,
                provider=provider,
                provider_event_id=raw.provider_event_id,
                title=raw.title,
                description=raw.description,
                location=raw.location,
                start_at=raw.start_at,
                end_at=raw.end_at,
                all_day=raw.all_day,
                status=raw.status,
                attendees=raw.attendees,
                correlation_id=get_correlation_id(),
                created_by=ctx.user_id,
            ))
            created += 1

    audit.log(
        db, type="calendar.sync.completed", tenant_id=ctx.tenant_id,
        actor_user_id=ctx.user_id, resource_type="provider_connection",
        resource_id=connection.id,
        metadata={"provider": provider, "fetched": len(raw_events), "created": created, "updated": updated},
    )
    env = EventEnvelope(
        type=etypes.CALENDAR_SYNC_COMPLETED,
        tenant_id=ctx.tenant_id,
        correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={
            "provider_connection_id": connection.id, "provider": provider,
            "fetched": len(raw_events), "created": created, "updated": updated,
        },
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"provider_connection:{connection.id}")
    return {"fetched": len(raw_events), "created": created, "updated": updated}


def list_calendar_events(
    db: DbSession, ctx: TenantContext, *, time_min: datetime | None = None, time_max: datetime | None = None,
) -> list[CalendarEvent]:
    q = db.query(CalendarEvent).filter(
        CalendarEvent.tenant_id == ctx.tenant_id, CalendarEvent.user_id == ctx.user_id,
    )
    if time_min is not None:
        q = q.filter(CalendarEvent.end_at >= time_min)
    if time_max is not None:
        q = q.filter(CalendarEvent.start_at <= time_max)
    return q.order_by(CalendarEvent.start_at.asc()).all()
