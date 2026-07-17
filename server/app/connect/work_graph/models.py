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

# MVP edge set (spec §3.2), grown as each edge type gets a real producer:
# sent_by/attendee_of/derived_from from Phase 3 slice 7 (Email, Calendar
# Event, Task rows already existed by then); delegated_access from Phase 4
# slice 1 (spec §10.1: "Delegated access is represented as graph edges and
# audit events, not hidden provider-only state") — a durable VISIBILITY
# record that a grant once existed, not the authorization source of truth
# (that's connect_mailbox_delegates.status; edges here are append-only and
# can't be revoked in place). governed_by/mutated/reviewed_by (this pass):
# real Action Review Queue governance evidence — see action_review/service.py
# and calendar_service/native_events.py & ai_workflows.py for the producers.
#
# Deliberately NOT added: blocked_by (no persisted "blocked attempt" object
# exists yet — DLP failures are exceptions, not rows), executed_by_agent
# (no distinct Agent Identity node exists — agents are plain strings today),
# follows_up (needs its own scoping pass).
EDGE_TYPES = ("sent_by", "attendee_of", "derived_from", "delegated_access", "governed_by", "mutated", "reviewed_by")

# Node types with a real consumer today. `mailbox` (Phase 4 slice 1) is a
# connect_provider_connections row; `agent_action` is a
# connect_action_review_items row; `policy_version` is a
# connect_policy_versions row — none are new entities, see service.py's
# resolvers. `Organisation`, `Message` (chat), `AISummary`, `File`, and
# `Meeting` all exist in spec's full node table (§3.1) but have no real
# Work Graph edge producer yet (Organisation/Meeting specifically: wiring
# either in would mean touching meeting-join code, which CLAUDE.md flags as
# sensitive — deliberately not done here, not an oversight).
NODE_TYPES = ("person", "email", "calendar_event", "task", "mailbox", "agent_action", "policy_version")


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
