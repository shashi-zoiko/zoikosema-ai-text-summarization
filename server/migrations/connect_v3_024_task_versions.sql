-- =============================================================================
--  Zoiko Connect v3 — task version history + restore, Phase 4 slice.
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as every other connect_v3_0XX migration.
--  Safe to re-run.
--
--  Spec §5.2 Task row: "restore previous task version or delete task if
--  newly created." Explicitly deferred by Phase 2 slice 8 (see calendar_
--  service/models.py's Task docstring) because connect_tasks is an ordinary
--  mutable table, not append-only like NativeCalendarEvent.
--
--  Deliberately does NOT convert connect_tasks itself into a version-chain
--  table (NativeCalendarEvent's pattern, one row per version, id unstable
--  across edits) — Work Graph's "task" node resolver and every derived_from/
--  mutated edge already key off a stable Task.id, and multiplying rows per
--  edit would break that identity for every existing edge and caller.
--  Instead: connect_tasks keeps its stable id and stays a plain mutable
--  row; this table holds an append-only snapshot history keyed by that
--  same stable task_id, and "restore" re-applies an older snapshot's field
--  values onto the live row (itself recorded as a new latest version, same
--  "restore creates a new version" semantics native_events.py's own
--  restore_previous_version already established).
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_task_versions (
    id                UUID PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    task_id           UUID NOT NULL,
    version_number    INTEGER NOT NULL,
    title             TEXT NOT NULL,
    status            TEXT NOT NULL,
    priority          TEXT NOT NULL,
    assignee_email    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (task_id, version_number)
);

CREATE INDEX IF NOT EXISTS ix_connect_task_versions_latest
    ON connect_task_versions (tenant_id, task_id, version_number DESC);

DROP TRIGGER IF EXISTS trg_connect_task_versions_append_only ON connect_task_versions;
CREATE TRIGGER trg_connect_task_versions_append_only
    BEFORE UPDATE OR DELETE ON connect_task_versions
    FOR EACH ROW EXECUTE FUNCTION connect_reject_mutation();

ALTER TABLE connect_task_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_task_versions_tenant_iso ON connect_task_versions;
CREATE POLICY connect_task_versions_tenant_iso ON connect_task_versions
    USING (tenant_id = current_setting('app.tenant_id', true));
