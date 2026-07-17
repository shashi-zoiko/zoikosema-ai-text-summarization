-- =============================================================================
--  Zoiko Connect v3 — Work Graph edges (Phase 3 slice 7)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Sema Calendar & Mail spec §3 (Work Graph) / §3.2 (edges). This is a
--  typed QUERY LAYER, not a second copy of node data — every node type's
--  underlying data already lives in its own table (connect_mail_messages,
--  connect_native_calendar_events, connect_tasks, users). Edges reference
--  those rows by (node_type, node_id); see app/connect/work_graph/service.py
--  for the resolver that joins back to them.
--
--  Append-only (edges are created or backfilled, never mutated in place) —
--  same discipline as connect_audit_events/connect_policy_versions, reusing
--  connect_reject_mutation() from connect_v3_001_init.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_work_graph_edges (
    id              UUID PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    edge_type       TEXT NOT NULL CHECK (edge_type IN ('sent_by', 'attendee_of', 'derived_from')),
    from_node_type  TEXT NOT NULL CHECK (from_node_type IN ('person', 'email', 'calendar_event', 'task')),
    from_node_id    TEXT NOT NULL,
    to_node_type    TEXT NOT NULL CHECK (to_node_type IN ('person', 'email', 'calendar_event', 'task')),
    to_node_id      TEXT NOT NULL,
    correlation_id  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, edge_type, from_node_type, from_node_id, to_node_type, to_node_id)
);

CREATE INDEX IF NOT EXISTS ix_connect_work_graph_edges_from
    ON connect_work_graph_edges (tenant_id, from_node_type, from_node_id);
CREATE INDEX IF NOT EXISTS ix_connect_work_graph_edges_to
    ON connect_work_graph_edges (tenant_id, to_node_type, to_node_id);

DROP TRIGGER IF EXISTS trg_connect_work_graph_edges_append_only ON connect_work_graph_edges;
CREATE TRIGGER trg_connect_work_graph_edges_append_only
    BEFORE UPDATE OR DELETE ON connect_work_graph_edges
    FOR EACH ROW EXECUTE FUNCTION connect_reject_mutation();

ALTER TABLE connect_work_graph_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_work_graph_edges_tenant_iso ON connect_work_graph_edges;
CREATE POLICY connect_work_graph_edges_tenant_iso ON connect_work_graph_edges
    USING (tenant_id = current_setting('app.tenant_id', true));
