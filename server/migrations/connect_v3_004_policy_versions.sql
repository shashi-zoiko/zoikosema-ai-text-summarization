-- =============================================================================
--  Zoiko Connect v3 — policy versions (Policy Engine MVP, Phase 2 slice 1)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Sema Calendar & Mail spec §3.1 (PolicyVersion node) / §4.1 (autonomy
--  resolution) / §12.3 (policy versions immutable after publication).
--
--  One row per published autonomy-ceiling change for a (tenant, category)
--  pair. Never UPDATEd or DELETEd — a change is always a new row with the
--  next `version` number, same append-only discipline as connect_audit_events
--  (reuses connect_reject_mutation() from connect_v3_001_init.sql).
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_policy_versions (
    id                UUID PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    category          TEXT NOT NULL CHECK (category IN ('calendar')),  -- 'mail' joins in Phase 3
    version           INTEGER NOT NULL,
    autonomy_ceiling  SMALLINT NOT NULL CHECK (autonomy_ceiling BETWEEN 0 AND 4),
    author_user_id    BIGINT NOT NULL,        -- references legacy users.id
    diff_ref          TEXT,                   -- human-readable description of what changed vs. prior version
    correlation_id    TEXT,
    effective_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, category, version)
);

CREATE INDEX IF NOT EXISTS ix_connect_policy_versions_latest
    ON connect_policy_versions (tenant_id, category, version DESC);

DROP TRIGGER IF EXISTS trg_connect_policy_versions_append_only ON connect_policy_versions;
CREATE TRIGGER trg_connect_policy_versions_append_only
    BEFORE UPDATE OR DELETE ON connect_policy_versions
    FOR EACH ROW EXECUTE FUNCTION connect_reject_mutation();

ALTER TABLE connect_policy_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_policy_versions_tenant_iso ON connect_policy_versions;
CREATE POLICY connect_policy_versions_tenant_iso ON connect_policy_versions
    USING (tenant_id = current_setting('app.tenant_id', true));
