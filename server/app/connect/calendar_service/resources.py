"""Bookable resources (rooms, equipment) + conflict checking.

Spec §3.1/§6.1. Reference data — no version chain, no governance wiring
here (see migration 008's own comment for why cost/booking_rules aren't
modeled yet: nothing in this slice reads them). Bookings are entries in
connect_native_calendar_events.resources (JSONB, already existed since
slice 3) referencing a Resource by id — this module doesn't own booking
storage, only resource identity and the conflict query.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.calendar_service import native_events
from app.connect.calendar_service.models import RESOURCE_TYPES, NativeCalendarEvent, Resource
from app.connect.shared.errors import Invalid, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.tenant import TenantContext


def create_resource(db: DbSession, ctx: TenantContext, *, name: str, type: str = "room") -> Resource:
    if not name or not name.strip():
        raise Invalid("name is required")
    if type not in RESOURCE_TYPES:
        raise Invalid(f"Unknown resource type: {type}")
    resource = Resource(
        id=uuid7_str(), tenant_id=ctx.tenant_id, name=name.strip(), type=type, created_by=ctx.user_id,
    )
    db.add(resource)
    db.commit()
    return resource


def list_resources(db: DbSession, ctx: TenantContext) -> list[Resource]:
    return db.query(Resource).filter(Resource.tenant_id == ctx.tenant_id).order_by(Resource.name).all()


def get_resource(db: DbSession, ctx: TenantContext, resource_id: str) -> Resource:
    resource = db.query(Resource).filter(Resource.tenant_id == ctx.tenant_id, Resource.id == resource_id).first()
    if resource is None:
        raise NotFound("Resource not found")
    return resource


def check_resource_conflicts(
    db: DbSession, ctx: TenantContext, *, resource_id: str, start_at: datetime, end_at: datetime,
    exclude_version_chain_id: str | None = None,
) -> list[dict[str, Any]]:
    """Other bookings of this resource (any user in the tenant — a resource
    is shared, not scoped to one person) overlapping [start_at, end_at].
    Advisory, not enforced: spec's own policy model (spend caps, human
    review for resource costs) is where a real accept/reject decision
    belongs once it exists; this slice only surfaces the overlap so a
    caller can flag it, per "double-booking... rejected OR flagged.\""""
    get_resource(db, ctx, resource_id)  # 404s if the resource doesn't exist in this tenant

    conflicts: list[dict[str, Any]] = []
    candidates = (
        db.query(NativeCalendarEvent)
        .filter(
            NativeCalendarEvent.tenant_id == ctx.tenant_id,
            NativeCalendarEvent.recurrence_id.is_(None),
            NativeCalendarEvent.status != "cancelled",
        )
        .order_by(NativeCalendarEvent.version_chain_id, NativeCalendarEvent.version_number.desc())
        .all()
    )
    latest_per_chain: dict[str, NativeCalendarEvent] = {}
    for row in candidates:
        if row.version_chain_id not in latest_per_chain:
            latest_per_chain[row.version_chain_id] = row

    for event in latest_per_chain.values():
        if event.version_chain_id == exclude_version_chain_id:
            continue
        if event.status == "cancelled":
            continue
        if not any(r.get("resource_id") == resource_id for r in (event.resources or [])):
            continue

        if event.rrule:
            # get_current_event()/list_occurrences() are tenant-scoped, not
            # owner-scoped (see native_events._latest_version) — the same
            # ctx works regardless of which tenant member created the event,
            # so no per-owner context juggling is needed here.
            occurrences = native_events.list_occurrences(
                db, ctx, version_chain_id=event.version_chain_id,
                range_start=start_at, range_end=end_at,
            )
            for occ in occurrences:
                occ_start = datetime.fromisoformat(occ["start_at"])
                occ_end = datetime.fromisoformat(occ["end_at"])
                if occ_start < end_at and occ_end > start_at:
                    conflicts.append({"event_title": occ["title"], "start_at": occ["start_at"], "end_at": occ["end_at"]})
        elif event.start_at < end_at and event.end_at > start_at:
            conflicts.append({
                "event_title": event.title,
                "start_at": event.start_at.isoformat(), "end_at": event.end_at.isoformat(),
            })

    return conflicts
