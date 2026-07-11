"""connect_calendar_events model.

DDL is the source of truth (see migrations/connect_v3_003_calendar_events.sql);
this is a thin SQLAlchemy mapping that only INSERT/UPDATE rows. Plain synced
data, not a Work Graph node — see architecture/SEMA_CALENDAR_MAIL_CONTEXT.md §4.
"""
from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Boolean, Column, DateTime, String, text
from sqlalchemy.dialects.postgresql import UUID

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
