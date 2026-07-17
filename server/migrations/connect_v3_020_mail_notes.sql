-- =============================================================================
--  Zoiko Connect v3 — mail internal notes (Phase 4 slice 2)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Spec §1.2 explicit non-goal (see connect_v3_019_mail_assignments.sql's
--  own header — same boundary applies here). Append-only: a note, once
--  written, is never edited or deleted — a correction is a new note, same
--  discipline as the audit ledger, reusing connect_reject_mutation().
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_mail_notes (
    id              UUID PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    message_id      UUID NOT NULL,  -- references connect_mail_messages.id
    author_user_id  BIGINT NOT NULL,
    body            TEXT NOT NULL,
    correlation_id  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_connect_mail_notes_message
    ON connect_mail_notes (tenant_id, message_id, created_at);

DROP TRIGGER IF EXISTS trg_connect_mail_notes_append_only ON connect_mail_notes;
CREATE TRIGGER trg_connect_mail_notes_append_only
    BEFORE UPDATE OR DELETE ON connect_mail_notes
    FOR EACH ROW EXECUTE FUNCTION connect_reject_mutation();

ALTER TABLE connect_mail_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_mail_notes_tenant_iso ON connect_mail_notes;
CREATE POLICY connect_mail_notes_tenant_iso ON connect_mail_notes
    USING (tenant_id = current_setting('app.tenant_id', true));
