-- =============================================================================
--  Zoiko Connect v3 — mail governance settings (DLP keyword list + delayed-
--  send buffer bounds), Phase 4 slice.
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as every other connect_v3_0XX migration.
--  Safe to re-run.
--
--  Spec §5.3 (Delayed-Send Buffer, admin-configurable 0-30 min range) /
--  §10.2 (DLP keyword list). Both were shipped as hardcoded module
--  constants (dlp/service.py's DEFAULT_SENSITIVE_KEYWORDS, mail_service/
--  send.py's DEFAULT/MIN/MAX_BUFFER_MINUTES) because no per-tenant config
--  storage/UI existed yet — this table is that storage. Bundled into one
--  table rather than two because both are mail-only admin settings changed
--  together from the same Governance.jsx surface; splitting them would add
--  a second near-identical versioned table for no real isolation benefit.
--
--  Append-only, same discipline as connect_policy_versions: a change is
--  always a new row with the next `version` number, never an UPDATE.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_mail_governance_settings (
    id                       UUID PRIMARY KEY,
    tenant_id                TEXT NOT NULL,
    version                  INTEGER NOT NULL,
    sensitive_keywords       JSONB NOT NULL,
    buffer_min_minutes       SMALLINT NOT NULL CHECK (buffer_min_minutes >= 0),
    buffer_max_minutes       SMALLINT NOT NULL CHECK (buffer_max_minutes <= 1440),
    buffer_default_minutes   SMALLINT NOT NULL,
    author_user_id           BIGINT NOT NULL,   -- references legacy users.id
    diff_ref                 TEXT,
    correlation_id           TEXT,
    effective_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, version),
    CHECK (buffer_min_minutes <= buffer_default_minutes AND buffer_default_minutes <= buffer_max_minutes)
);

CREATE INDEX IF NOT EXISTS ix_connect_mail_governance_settings_latest
    ON connect_mail_governance_settings (tenant_id, version DESC);

DROP TRIGGER IF EXISTS trg_connect_mail_governance_settings_append_only ON connect_mail_governance_settings;
CREATE TRIGGER trg_connect_mail_governance_settings_append_only
    BEFORE UPDATE OR DELETE ON connect_mail_governance_settings
    FOR EACH ROW EXECUTE FUNCTION connect_reject_mutation();

ALTER TABLE connect_mail_governance_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_mail_governance_settings_tenant_iso ON connect_mail_governance_settings;
CREATE POLICY connect_mail_governance_settings_tenant_iso ON connect_mail_governance_settings
    USING (tenant_id = current_setting('app.tenant_id', true));
