"""connect_policy_versions model.

DDL is the source of truth (see migrations/connect_v3_004_policy_versions.sql);
this is a thin SQLAlchemy mapping. Append-only — a DB trigger rejects
UPDATE/DELETE, same discipline as the audit ledger (spec §12.3: "policy
versions must be immutable after publication; changes create new versions").
"""
from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, Integer, SmallInteger, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.connect.shared.base import ConnectBase

# "calendar" has had a real consumer since Phase 2 native events. "mail"
# joins here in Phase 3 slice 9 (mail send, L3) — the first real
# mail-category policy consumer; see migrations/
# connect_v3_016_policy_versions_mail_category.sql for the accompanying
# CHECK constraint extension (connect_v3_004's original constraint is left
# unedited since it may already be applied to a real database).
CATEGORIES = ("calendar", "mail")


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


class MailGovernanceSettings(ConnectBase):
    """connect_mail_governance_settings — DLP sensitive-keyword list +
    delayed-send buffer bounds, per tenant. See migrations/
    connect_v3_022_mail_governance_settings.sql. Append-only, same
    versioning discipline as PolicyVersion above: a change is always a new
    row with the next `version` number.

    Mail-only (DLP is scoped to mail per spec §10.2; the delayed-send
    buffer is a mail send concept) — no `category` column, unlike
    PolicyVersion, since there is nothing else to disambiguate yet.
    """
    __tablename__ = "connect_mail_governance_settings"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    version = Column(Integer, nullable=False)
    sensitive_keywords = Column(JSONB, nullable=False)
    buffer_min_minutes = Column(SmallInteger, nullable=False)
    buffer_max_minutes = Column(SmallInteger, nullable=False)
    buffer_default_minutes = Column(SmallInteger, nullable=False)
    author_user_id = Column(BigInteger, nullable=False)
    diff_ref = Column(String, nullable=True)
    correlation_id = Column(String, nullable=True)
    effective_at = Column(DateTime(timezone=True), server_default=text("now()"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
