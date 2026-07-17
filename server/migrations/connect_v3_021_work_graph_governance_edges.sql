-- =============================================================================
--  Zoiko Connect v3 — extend Work Graph node/edge CHECK constraints for
--  'agent_action' / 'policy_version' nodes and 'governed_by' / 'mutated' /
--  'reviewed_by' edges (spec §3.2 governance edges)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Separate migration rather than editing connect_v3_014/018 in place —
--  those may already be applied to a real database, and every migration in
--  this build is additive, never rewritten after the fact. Same DO-block
--  pattern connect_v3_016/018 already established.
--
--  Deliberately NOT added here: 'blocked_by' (no persisted "blocked
--  attempt" object exists to attach it to yet — DLP failures are
--  exceptions, not rows), 'executed_by_agent' (no distinct Agent Identity
--  node exists — agents are plain strings today, e.g. "ai_draft_reply"),
--  'follows_up' (needs its own scoping pass), and 'organisation'/'meeting'
--  node types (no real edge producer wires to either without touching
--  meeting-join code, which CLAUDE.md flags as sensitive — adding an
--  orphan node type with zero producers would be the same
--  infrastructure-before-a-real-consumer mistake this build has avoided
--  everywhere else). Add each when a real producer exists.
-- =============================================================================

DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT pgc.conname
        FROM pg_constraint pgc
        JOIN pg_class rel ON rel.oid = pgc.conrelid
        WHERE rel.relname = 'connect_work_graph_edges'
          AND pgc.contype = 'c'
          AND pg_get_constraintdef(pgc.oid) LIKE '%edge_type%'
    LOOP
        EXECUTE format('ALTER TABLE connect_work_graph_edges DROP CONSTRAINT %I', con.conname);
    END LOOP;

    FOR con IN
        SELECT pgc.conname
        FROM pg_constraint pgc
        JOIN pg_class rel ON rel.oid = pgc.conrelid
        WHERE rel.relname = 'connect_work_graph_edges'
          AND pgc.contype = 'c'
          AND (pg_get_constraintdef(pgc.oid) LIKE '%from_node_type%' OR pg_get_constraintdef(pgc.oid) LIKE '%to_node_type%')
    LOOP
        EXECUTE format('ALTER TABLE connect_work_graph_edges DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE connect_work_graph_edges
    ADD CONSTRAINT connect_work_graph_edges_edge_type_check
    CHECK (edge_type IN ('sent_by', 'attendee_of', 'derived_from', 'delegated_access', 'governed_by', 'mutated', 'reviewed_by'));

ALTER TABLE connect_work_graph_edges
    ADD CONSTRAINT connect_work_graph_edges_from_node_type_check
    CHECK (from_node_type IN ('person', 'email', 'calendar_event', 'task', 'mailbox', 'agent_action'));

ALTER TABLE connect_work_graph_edges
    ADD CONSTRAINT connect_work_graph_edges_to_node_type_check
    CHECK (to_node_type IN ('person', 'email', 'calendar_event', 'task', 'mailbox', 'agent_action', 'policy_version'));
