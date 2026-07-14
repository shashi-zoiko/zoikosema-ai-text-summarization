-- =============================================================================
--  Zoiko Connect v3 — Action Review Queue (Phase 2 slice 2)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Sema Calendar & Mail spec §5.1 (Action Review Queue) / §5.2 (rollback
--  semantics) / §11 (Action Review Service). One cross-category queue for
--  every governed action awaiting human review — DR-06 explicitly
--  prohibits per-feature queue fragmentation, so this table is generic
--  (action_type + action_payload), not one table per producing feature.
--
--  Ordinary mutable table (status transitions), not append-only like
--  connect_audit_events / connect_policy_versions — reuses
--  connect_touch_updated_at() from connect_v3_001_init.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_action_review_items (
    id                     UUID PRIMARY KEY,
    tenant_id              TEXT NOT NULL,
    action_type            TEXT NOT NULL,          -- producer-defined, e.g. "calendar.event.propose.v1"
    action_payload         JSONB NOT NULL,          -- machine-readable proposed action
    reasoning_trace_ref    TEXT,                    -- pointer to the reasoning trace, if agent-originated
    policy_verdicts        JSONB NOT NULL DEFAULT '{}'::jsonb,
    blast_radius           JSONB NOT NULL DEFAULT '{}'::jsonb,
    rollback_descriptor    TEXT NOT NULL DEFAULT 'no_rollback'
                               CHECK (rollback_descriptor IN (
                                   'restore_previous_version', 'cancel_buffered_send',
                                   'tombstone_message', 'no_rollback'
                               )),
    status                 TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'rejected', 'redraft_requested', 'escalated')),
    proposed_by_user_id    BIGINT,                  -- references legacy users.id; human-drafted proposals
    proposed_by_agent      TEXT,                    -- agent identity string; NULL for human-drafted proposals
    reviewed_by_user_id    BIGINT,
    reviewed_at            TIMESTAMPTZ,
    review_note            TEXT,
    correlation_id         TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_connect_action_review_tenant_status
    ON connect_action_review_items (tenant_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_connect_action_review_touch ON connect_action_review_items;
CREATE TRIGGER trg_connect_action_review_touch
    BEFORE UPDATE ON connect_action_review_items
    FOR EACH ROW EXECUTE FUNCTION connect_touch_updated_at();

ALTER TABLE connect_action_review_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_action_review_tenant_iso ON connect_action_review_items;
CREATE POLICY connect_action_review_tenant_iso ON connect_action_review_items
    USING (tenant_id = current_setting('app.tenant_id', true));
