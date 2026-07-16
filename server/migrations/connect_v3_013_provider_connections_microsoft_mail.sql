-- =============================================================================
--  Zoiko Connect v3 — widen connect_provider_connections.provider for Outlook
--  Mail (Phase 3 slice 3)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  connect_v3_010_provider_connections_mail_providers.sql's own comment
--  already flagged this: "Add 'microsoft_mail' alongside this when Phase 3
--  slice 3 (Outlook Mail sync) needs it." That slice has landed.
-- =============================================================================

ALTER TABLE connect_provider_connections
    DROP CONSTRAINT IF EXISTS connect_provider_connections_provider_check;

ALTER TABLE connect_provider_connections
    ADD CONSTRAINT connect_provider_connections_provider_check
    CHECK (provider IN ('google_calendar', 'microsoft_calendar', 'gmail', 'microsoft_mail'));
