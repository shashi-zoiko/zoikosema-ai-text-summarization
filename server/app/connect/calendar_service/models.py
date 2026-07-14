"""connect_calendar_events / connect_native_calendar_events models.

DDL is the source of truth (see migrations/connect_v3_003_calendar_events.sql
and connect_v3_006_native_calendar_events.sql); these are thin SQLAlchemy
mappings that only INSERT/UPDATE rows.

CalendarEvent (connect_calendar_events) is plain synced data from Google/
Outlook, not a Work Graph node — see CONTEXT.md §4. NativeCalendarEvent
(connect_native_calendar_events) is Sema-authoritative (spec §8.1) and
append-only: every create/update/delete/restore is a new version row, never
an UPDATE — see native_events.py for the version-chain logic.
"""
from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Boolean, Column, DateTime, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.connect.shared.base import ConnectBase


class CalendarEvent(ConnectBase):
    __tablename__ = "connect_calendar_events"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    user_id = Column(BigInteger, nullable=False)
    provider_connection_id = Column(UUID(as_uuid=False), nullable=False)
    provider = Column(String, nullable=False)
    provider_event_id = Column(String, nullable=False)
    title = Column(String, nullable=True)
    description = Column(String, nullable=True)
    location = Column(String, nullable=True)
    start_at = Column(DateTime(timezone=True), nullable=True)
    end_at = Column(DateTime(timezone=True), nullable=True)
    all_day = Column(Boolean, nullable=False, default=False)
    status = Column(String, nullable=False, default="confirmed")
    attendees = Column(JSON, nullable=False, default=list)
    correlation_id = Column(String, nullable=True)
    created_by = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))


NATIVE_EVENT_STATUSES = ("confirmed", "cancelled")
CONFIDENTIALITY_CLASSES = ("standard", "confidential")


class NativeCalendarEvent(ConnectBase):
    __tablename__ = "connect_native_calendar_events"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    version_chain_id = Column(UUID(as_uuid=False), nullable=False)
    version_number = Column(Integer, nullable=False)
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    location = Column(String, nullable=True)
    start_at = Column(DateTime(timezone=True), nullable=False)
    end_at = Column(DateTime(timezone=True), nullable=False)
    timezone = Column(String, nullable=False, default="UTC")
    rrule = Column(String, nullable=True)
    # NULL = this row is the series master (or a non-recurring event).
    # NOT NULL = an exception overriding the one occurrence that would
    # otherwise start at this instant — see native_events.py's version-chain
    # reuse for exceptions (migration connect_v3_007).
    recurrence_id = Column(DateTime(timezone=True), nullable=True)
    attendees = Column(JSONB, nullable=False, default=list)
    resources = Column(JSONB, nullable=False, default=list)
    confidentiality_class = Column(String, nullable=False, default="standard")
    status = Column(String, nullable=False, default="confirmed")
    created_by = Column(BigInteger, nullable=False)
    correlation_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))


RESOURCE_TYPES = ("room", "equipment")


class Resource(ConnectBase):
    """connect_resources — bookable rooms/equipment (Phase 2 slice 5).

    Reference data, not a governed mutation: ordinary mutable table with a
    touch trigger (see migrations/connect_v3_008_resources.sql), not the
    append-only/version-chain pattern NativeCalendarEvent uses. A booking
    is an entry in NativeCalendarEvent.resources referencing this table's
    id, not a row here.
    """
    __tablename__ = "connect_resources"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False, default="room")
    created_by = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))
