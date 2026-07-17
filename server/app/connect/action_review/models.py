"""connect_action_review_items model.

DDL is the source of truth (see migrations/connect_v3_005_action_review.sql);
this is a thin SQLAlchemy mapping. One cross-category queue — DR-06
prohibits per-feature queue fragmentation, so this table is generic
(action_type + action_payload), not one table per producing feature.
"""
from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, Float, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.connect.shared.base import ConnectBase

STATUSES = ("pending", "approved", "rejected", "redraft_requested", "escalated")
ROLLBACK_DESCRIPTORS = (
    "restore_previous_version", "cancel_buffered_send", "tombstone_message", "no_rollback",
)


class ReviewQueueItem(ConnectBase):
    __tablename__ = "connect_action_review_items"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    action_type = Column(String, nullable=False)
    action_payload = Column(JSONB, nullable=False)
    reasoning_trace_ref = Column(String, nullable=True)
    policy_verdicts = Column(JSONB, nullable=False, default=dict)
    blast_radius = Column(JSONB, nullable=False, default=dict)
    rollback_descriptor = Column(String, nullable=False, default="no_rollback")
    status = Column(String, nullable=False, default="pending")
    proposed_by_user_id = Column(BigInteger, nullable=True)
    proposed_by_agent = Column(String, nullable=True)
    reviewed_by_user_id = Column(BigInteger, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    review_note = Column(String, nullable=True)
    correlation_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))


class ReasoningTrace(ConnectBase):
    """connect_reasoning_traces — structured agent rationale for an
    agent-originated queue item (spec §5.1/§5.4). See migrations/
    connect_v3_023_reasoning_traces.sql. Append-only: written once at
    staging time, never edited after — `ReviewQueueItem.reasoning_trace_ref`
    points at this table's `id`.
    """
    __tablename__ = "connect_reasoning_traces"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    queue_item_id = Column(UUID(as_uuid=False), nullable=False)
    rationale = Column(String, nullable=True)
    source_nodes = Column(JSONB, nullable=False, default=list)
    tool_chain = Column(JSONB, nullable=False, default=list)
    model = Column(String, nullable=True)
    confidence = Column(Float, nullable=True)
    uncertainty_markers = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
