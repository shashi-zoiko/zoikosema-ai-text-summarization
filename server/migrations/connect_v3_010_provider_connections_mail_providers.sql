-- =============================================================================
--  Zoiko Connect v3 — widen connect_provider_connections.provider for Mail
--  (Phase 3 slice 1)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  connect_v3_002_provider_connections.sql's own CHECK constraint only
--  allowed the two Phase 1 calendar providers — a real gap only surfaced
--  when Phase 3 slice 1 tried to insert a 'gmail' row and Postgres (not the
--  application layer) correctly rejected it. Widened here rather than
--  editing migration 002 in place, same "each schema change gets its own
--  migration file" discipline every prior connect_v3_00N file has followed.
--  Add 'microsoft_mail' alongside this when Phase 3 slice 3 (Outlook Mail
--  sync) needs it — don't presumptively add it now with no real row to
--  ever use that value yet.
-- =============================================================================

ALTER TABLE connect_provider_connections
    DROP CONSTRAINT IF EXISTS connect_provider_connections_provider_check;

ALTER TABLE connect_provider_connections
    ADD CONSTRAINT connect_provider_connections_provider_check
    CHECK (provider IN ('google_calendar', 'microsoft_calendar', 'gmail'));
