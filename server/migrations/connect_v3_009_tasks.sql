-- =============================================================================
--  Zoiko Connect v3 — tasks (Phase 2 slice 8)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Spec §3.1 (Task node: task_id, owner_id, due_date, status, source_node_ref,
--  priority — "Task may be human or agent-created"). source_event_id is a
--  plain pointer (this repo's version_chain_id), not a Work Graph edge —
--  Work Graph doesn't exist until Phase 3 slice 1; backfill a real
--  derived_from edge then, this column is what gets read to build it.
--
--  Ordinary mutable table (status transitions: open -> done/dismissed), not
--  the append-only/version-chain pattern native calendar events use — a
--  rejected/unwanted suggested task is simply deleted (or dismissed) here;
--  full task version-history/rollback (spec §5.2's row for Task) is
--  deliberately not built in this slice, see native_events.py-adjacent
--  ai_workflows.py docstring for why.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_tasks (
    id                  UUID PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    title               TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
    priority            TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('low', 'med', 'high')),
    assignee_email      TEXT,
    source_event_id     UUID,          -- connect_native_calendar_events.version_chain_id, if derived from one
    generated_by_agent  BOOLEAN NOT NULL DEFAULT false,  -- spec §13.3 agent-touched marker
    created_by          BIGINT NOT NULL,       -- references legacy users.id
    correlation_id      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_connect_tasks_tenant_status
    ON connect_tasks (tenant_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_connect_tasks_touch ON connect_tasks;
CREATE TRIGGER trg_connect_tasks_touch
    BEFORE UPDATE ON connect_tasks
    FOR EACH ROW EXECUTE FUNCTION connect_touch_updated_at();

ALTER TABLE connect_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_tasks_tenant_iso ON connect_tasks;
CREATE POLICY connect_tasks_tenant_iso ON connect_tasks
    USING (tenant_id = current_setting('app.tenant_id', true));
