"""connect_mailbox_delegates model.

DDL is the source of truth (see migrations/connect_v3_017_mailbox_delegates.sql);
this is a thin SQLAlchemy mapping. Ordinary mutable table (a grant is
actually revocable) — see service.py's module docstring for why this is
the authorization source of truth and the Work Graph delegated_access edge
is a visibility record, not the other way around.
"""
from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, String, text
from sqlalchemy.dialects.postgresql import UUID

from app.connect.shared.base import ConnectBase

DELEGATE_STATUSES = ("active", "revoked")


class MailboxDelegate(ConnectBase):
    __tablename__ = "connect_mailbox_delegates"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    provider_connection_id = Column(UUID(as_uuid=False), nullable=False)
    delegate_user_id = Column(BigInteger, nullable=False)
    granted_by_user_id = Column(BigInteger, nullable=False)
    status = Column(String, nullable=False, default="active")
    correlation_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))
