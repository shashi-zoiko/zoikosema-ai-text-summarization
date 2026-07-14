-- =============================================================================
--  Zoiko Connect v3 — mail messages (read-only provider sync, Phase 3 slice 2)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Sema Calendar & Mail spec §7.2/§8.1 (Sync Engine). Plain synced-data table,
--  provider-authoritative, same class as connect_calendar_events (ordinary
--  mutable table with a touch trigger) — not append-only, not the Work Graph.
--  Headers/metadata/snippet only; body content is Phase 3 slice 4's job.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_mail_messages (
    id                      UUID PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    user_id                 BIGINT NOT NULL,        -- references legacy users.id
    provider_connection_id  UUID NOT NULL REFERENCES connect_provider_connections(id) ON DELETE CASCADE,
    provider                TEXT NOT NULL,
    provider_message_id     TEXT NOT NULL,
    thread_id               TEXT NOT NULL,
    subject                 TEXT,
    snippet                 TEXT,
    from_email              TEXT NOT NULL,
    to_emails               JSONB NOT NULL DEFAULT '[]',
    sender_domain           TEXT NOT NULL DEFAULT '',
    received_at             TIMESTAMPTZ NOT NULL,
    history_id              TEXT,
    label_ids               JSONB NOT NULL DEFAULT '[]',
    correlation_id          TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider_connection_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS ix_connect_mail_messages_tenant_window
    ON connect_mail_messages (tenant_id, user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS ix_connect_mail_messages_thread
    ON connect_mail_messages (tenant_id, thread_id);

DROP TRIGGER IF EXISTS trg_connect_mail_messages_touch ON connect_mail_messages;
CREATE TRIGGER trg_connect_mail_messages_touch
    BEFORE UPDATE ON connect_mail_messages
    FOR EACH ROW EXECUTE FUNCTION connect_touch_updated_at();

ALTER TABLE connect_mail_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_mail_messages_tenant_iso ON connect_mail_messages;
CREATE POLICY connect_mail_messages_tenant_iso ON connect_mail_messages
    USING (tenant_id = current_setting('app.tenant_id', true));
