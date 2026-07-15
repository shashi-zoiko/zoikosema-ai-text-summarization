"""connect_policy_versions model.

DDL is the source of truth (see migrations/connect_v3_004_policy_versions.sql);
this is a thin SQLAlchemy mapping. Append-only — a DB trigger rejects
UPDATE/DELETE, same discipline as the audit ledger (spec §12.3: "policy
versions must be immutable after publication; changes create new versions").
"""
from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, Integer, SmallInteger, String, text
from sqlalchemy.dialects.postgresql import UUID

from app.connect.shared.base import ConnectBase

# Only "calendar" has a real consumer today (Phase 2 native events). "mail"
# joins in Phase 3 — see migration CHECK constraint, which must be extended
# alongside this tuple when that lands.
CATEGORIES = ("calendar",)


class PolicyVersion(ConnectBase):
    __tablename__ = "connect_policy_versions"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    category = Column(String, nullable=False)
    version = Column(Integer, nullable=False)
    autonomy_ceiling = Column(SmallInteger, nullable=False)
    author_user_id = Column(BigInteger, nullable=False)
    diff_ref = Column(String, nullable=True)
    correlation_id = Column(String, nullable=True)
    effective_at = Column(DateTime(timezone=True), server_default=text("now()"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
