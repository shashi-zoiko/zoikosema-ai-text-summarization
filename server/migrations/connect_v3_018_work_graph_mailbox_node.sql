-- =============================================================================
--  Zoiko Connect v3 — extend Work Graph node/edge CHECK constraints for
--  'mailbox' node type + 'delegated_access' edge type (Phase 4 slice 1)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Separate migration rather than an edit to connect_v3_014 in place —
--  that file may already be applied to a real database, and every
--  migration in this build is additive, never rewritten after the fact.
--  Same DO-block-finds-the-constraint-by-name pattern
--  connect_v3_016_policy_versions_mail_category.sql already established.
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
    CHECK (edge_type IN ('sent_by', 'attendee_of', 'derived_from', 'delegated_access'));

ALTER TABLE connect_work_graph_edges
    ADD CONSTRAINT connect_work_graph_edges_from_node_type_check
    CHECK (from_node_type IN ('person', 'email', 'calendar_event', 'task', 'mailbox'));

ALTER TABLE connect_work_graph_edges
    ADD CONSTRAINT connect_work_graph_edges_to_node_type_check
    CHECK (to_node_type IN ('person', 'email', 'calendar_event', 'task', 'mailbox'));
