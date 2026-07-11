-- =============================================================================
--  Zoiko Connect v3 — provider connections (OAuth token vault, minimal)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Sema Calendar & Mail spec §7.4 (Token Vault). This is the Phase 1 slice:
--  encrypted-at-rest refresh/access tokens with per-tenant isolation, NOT the
--  final HSM/KMS-backed vault the spec describes as the end state — see
--  architecture/SEMA_CALENDAR_MAIL_CONTEXT.md open question #3.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_provider_connections (
    id                      UUID PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    user_id                 BIGINT NOT NULL,        -- references legacy users.id
    provider                TEXT NOT NULL CHECK (provider IN ('google_calendar', 'microsoft_calendar')),
    provider_account_email  TEXT NOT NULL,
    scopes                  TEXT[] NOT NULL DEFAULT '{}',
    encrypted_refresh_token TEXT NOT NULL,
    encrypted_access_token  TEXT,
    access_token_expires_at TIMESTAMPTZ,
    status                  TEXT NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'revoked', 'error')),
    correlation_id          TEXT,
    created_by              BIGINT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id, provider)
);

CREATE INDEX IF NOT EXISTS ix_connect_provider_connections_tenant
    ON connect_provider_connections (tenant_id, user_id, provider);

DROP TRIGGER IF EXISTS trg_connect_provider_connections_touch ON connect_provider_connections;
CREATE TRIGGER trg_connect_provider_connections_touch
    BEFORE UPDATE ON connect_provider_connections
    FOR EACH ROW EXECUTE FUNCTION connect_touch_updated_at();

ALTER TABLE connect_provider_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_provider_connections_tenant_iso ON connect_provider_connections;
CREATE POLICY connect_provider_connections_tenant_iso ON connect_provider_connections
    USING (tenant_id = current_setting('app.tenant_id', true));
