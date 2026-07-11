"""connect_sessions + connect_session_members models.

DDL is the source of truth (see migrations/connect_v3_001_init.sql); these
are thin SQLAlchemy mappings that only INSERT/UPDATE rows.
"""
from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.connect.shared.base import ConnectBase


class Session(ConnectBase):
    __tablename__ = "connect_sessions"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    kind = Column(String, nullable=False)
    title = Column(String, nullable=True)
    host_id = Column(BigInteger, nullable=False)
    scheduled_start_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=False, default="scheduled")
    media_room_ref = Column(String, nullable=True)
    correlation_id = Column(String, nullable=True)
    created_by = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))

    members = relationship("SessionMember", backref="session", lazy="selectin")


class SessionMember(ConnectBase):
    __tablename__ = "connect_session_members"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    # DDL already has this FK (connect_v3_001_init.sql); it was missing here,
    # which breaks SQLAlchemy's relationship config for Session.members the
    # moment ANY connect_v3 model is queried (mapper configuration is
    # registry-wide, not per-class) - found while integration-testing Sema.
    session_id = Column(UUID(as_uuid=False), ForeignKey("connect_sessions.id"), nullable=False)
    tenant_id = Column(String, nullable=False)
    user_id = Column(BigInteger, nullable=False)
    role = Column(String, nullable=False, default="participant")
    status = Column(String, nullable=False, default="invited")
    joined_at = Column(DateTime(timezone=True), nullable=True)
    left_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))
    correlation_id = Column(String, nullable=True)
