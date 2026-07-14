"""connect_provider_connections model.

DDL is the source of truth (see migrations/connect_v3_002_provider_connections.sql);
this is a thin SQLAlchemy mapping that only INSERT/UPDATE rows.
"""
from __future__ import annotations

from sqlalchemy import ARRAY, BigInteger, Column, DateTime, String, text
from sqlalchemy.dialects.postgresql import UUID

from app.connect.shared.base import ConnectBase


class ProviderConnection(ConnectBase):
    __tablename__ = "connect_provider_connections"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    user_id = Column(BigInteger, nullable=False)
    provider = Column(String, nullable=False)
    provider_account_email = Column(String, nullable=False)
    scopes = Column(ARRAY(String), nullable=False, default=list)
    encrypted_refresh_token = Column(String, nullable=False)
    encrypted_access_token = Column(String, nullable=True)
    access_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, nullable=False, default="active")
    # Gmail history.list checkpoint (Phase 3 slice 2) — NULL means "no
    # checkpoint yet, do a full pull" (first sync, or after a 410
    # history-expired reset). Unused by calendar providers.
    mail_history_id = Column(String, nullable=True)
    correlation_id = Column(String, nullable=True)
    created_by = Column(BigInteger, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))
