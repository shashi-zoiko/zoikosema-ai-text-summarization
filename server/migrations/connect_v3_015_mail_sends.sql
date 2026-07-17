-- =============================================================================
--  Zoiko Connect v3 — mail sends / delayed-send buffer (Phase 3 slice 9)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Sema Calendar & Mail spec §4 (L3 row) / §5.2 (rollback: cancel buffered
--  send) / §5.3 (Delayed-Send Buffer). Ordinary mutable table (status
--  transitions: buffered -> cancelled/released/failed), not the append-only/
--  version-chain pattern native calendar events use — a buffered send is
--  either released or cancelled exactly once, there's no history to chain.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_mail_sends (
    id                      UUID PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    user_id                 BIGINT NOT NULL,        -- references legacy users.id
    provider_connection_id  UUID NOT NULL,          -- references connect_provider_connections.id
    provider                TEXT NOT NULL,
    draft_payload           JSONB NOT NULL,          -- {to_emails, subject, body_text, thread_id, in_reply_to_message_id}
    dlp_verdict             JSONB NOT NULL DEFAULT '{}'::jsonb,
    scheduled_release_at    TIMESTAMPTZ NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'buffered'
                                CHECK (status IN ('buffered', 'cancelled', 'released', 'failed')),
    provider_message_id     TEXT,
    failure_reason          TEXT,
    correlation_id          TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_connect_mail_sends_pending_release
    ON connect_mail_sends (status, scheduled_release_at) WHERE status = 'buffered';
CREATE INDEX IF NOT EXISTS ix_connect_mail_sends_tenant_user
    ON connect_mail_sends (tenant_id, user_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_connect_mail_sends_touch ON connect_mail_sends;
CREATE TRIGGER trg_connect_mail_sends_touch
    BEFORE UPDATE ON connect_mail_sends
    FOR EACH ROW EXECUTE FUNCTION connect_touch_updated_at();

ALTER TABLE connect_mail_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_mail_sends_tenant_iso ON connect_mail_sends;
CREATE POLICY connect_mail_sends_tenant_iso ON connect_mail_sends
    USING (tenant_id = current_setting('app.tenant_id', true));
