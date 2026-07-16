-- =============================================================================
--  Zoiko Connect v3 — mailbox delegates (Phase 4 slice 1)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Sema Calendar & Mail spec §1.1 (shared mailboxes / delegated access),
--  §10.1 ("Delegated access is represented as graph edges and audit
--  events, not hidden provider-only state"). A shared mailbox IS a
--  connect_provider_connections row — this table is just its delegate
--  list, not a second mailbox entity. Ordinary mutable table (a grant is
--  actually revocable — that's the point), not the append-only pattern
--  audit/policy-versions use.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_mailbox_delegates (
    id                      UUID PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    provider_connection_id  UUID NOT NULL,   -- references connect_provider_connections.id
    delegate_user_id        BIGINT NOT NULL, -- references legacy users.id
    granted_by_user_id      BIGINT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    correlation_id          TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider_connection_id, delegate_user_id)
);

CREATE INDEX IF NOT EXISTS ix_connect_mailbox_delegates_connection
    ON connect_mailbox_delegates (tenant_id, provider_connection_id, status);
CREATE INDEX IF NOT EXISTS ix_connect_mailbox_delegates_delegate
    ON connect_mailbox_delegates (tenant_id, delegate_user_id, status);

DROP TRIGGER IF EXISTS trg_connect_mailbox_delegates_touch ON connect_mailbox_delegates;
CREATE TRIGGER trg_connect_mailbox_delegates_touch
    BEFORE UPDATE ON connect_mailbox_delegates
    FOR EACH ROW EXECUTE FUNCTION connect_touch_updated_at();

ALTER TABLE connect_mailbox_delegates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_mailbox_delegates_tenant_iso ON connect_mailbox_delegates;
CREATE POLICY connect_mailbox_delegates_tenant_iso ON connect_mailbox_delegates
    USING (tenant_id = current_setting('app.tenant_id', true));
