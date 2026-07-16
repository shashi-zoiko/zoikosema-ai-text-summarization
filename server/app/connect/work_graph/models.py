"""connect_work_graph_edges model.

DDL is the source of truth (see migrations/connect_v3_014_work_graph_edges.sql);
this is a thin SQLAlchemy mapping. A typed QUERY LAYER (edges table + a
resolver that joins back to the real node tables) — NOT a second copy of
node data, see service.py's module docstring for why that's the single
most important scope-limiting decision in this slice.
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, String, text
from sqlalchemy.dialects.postgresql import UUID

from app.connect.shared.base import ConnectBase

# MVP edge set (spec §3.2), sequenced to exactly what Phase 3 slices 1-6 have
# produced real data for by the time this slice lands: Email rows (mail sync,
# slices 2-3), NativeCalendarEvent rows (Phase 2 slice 3), Task rows (Phase 2
# slice 8), and User rows (pre-existing). Any other edge type from spec's
# fuller table has no real producer yet — add it when one arrives.
EDGE_TYPES = ("sent_by", "attendee_of", "derived_from")

# Node types with a real consumer today. `Organisation`, `Message` (chat),
# `AISummary`, `File`, `AgentAction`, `PolicyVersion` all exist in spec's
# full node table (§3.1) but have no real Work Graph traversal need yet.
NODE_TYPES = ("person", "email", "calendar_event", "task")


class WorkGraphEdge(ConnectBase):
    __tablename__ = "connect_work_graph_edges"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    edge_type = Column(String, nullable=False)
    from_node_type = Column(String, nullable=False)
    from_node_id = Column(String, nullable=False)
    to_node_type = Column(String, nullable=False)
    to_node_id = Column(String, nullable=False)
    correlation_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
