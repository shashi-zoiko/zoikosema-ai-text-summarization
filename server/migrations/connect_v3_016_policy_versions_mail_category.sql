-- =============================================================================
--  Zoiko Connect v3 — extend policy category CHECK to include 'mail'
--  (Phase 3 slice 9 — mail send, L3)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  connect_v3_004_policy_versions.sql's own comment anticipated this
--  ("'mail' joins in Phase 3"). This is a separate migration rather than an
--  edit to connect_v3_004 in place — that file may already be applied to a
--  real database (see architecture/SEMA_CALENDAR_MAIL_CONTEXT.md's session
--  log), and every migration in this build is additive, never rewritten
--  after the fact.
--
--  The DO block finds whichever CHECK constraint governs the `category`
--  column (rather than hardcoding Postgres's auto-generated name) so this
--  is correct whether or not the constraint was explicitly named.
-- =============================================================================

DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT pgc.conname
        FROM pg_constraint pgc
        JOIN pg_class rel ON rel.oid = pgc.conrelid
        WHERE rel.relname = 'connect_policy_versions'
          AND pgc.contype = 'c'
          AND pg_get_constraintdef(pgc.oid) LIKE '%category%'
    LOOP
        EXECUTE format('ALTER TABLE connect_policy_versions DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE connect_policy_versions
    ADD CONSTRAINT connect_policy_versions_category_check CHECK (category IN ('calendar', 'mail'));
