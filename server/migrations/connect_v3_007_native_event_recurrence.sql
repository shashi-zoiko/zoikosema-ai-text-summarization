-- =============================================================================
--  Zoiko Connect v3 — native calendar event recurrence (Phase 2 slice 4)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Adds recurrence_id to connect_native_calendar_events (created in
--  connect_v3_006_native_calendar_events.sql) rather than a new table:
--  a per-instance exception ("this one occurrence has different attendees /
--  is cancelled") is just another version chain distinguished by
--  recurrence_id, reusing 100% of the create/update/delete/audit/iTIP
--  machinery slice 3 already built — see native_events.py. recurrence_id
--  NULL = the recurring series' own master row (or a plain non-recurring
--  event); NOT NULL = an override for the one occurrence that would
--  otherwise start at that instant.
--
--  The original UNIQUE(version_chain_id, version_number) from migration 006
--  is replaced with two partial unique indexes, because master rows and
--  exception rows for different instances legitimately share the same
--  version_number under the same version_chain_id (e.g. every exception's
--  first version is version_number=1).
-- =============================================================================

ALTER TABLE connect_native_calendar_events
    ADD COLUMN IF NOT EXISTS recurrence_id TIMESTAMPTZ;

ALTER TABLE connect_native_calendar_events
    DROP CONSTRAINT IF EXISTS connect_native_calendar_event_version_chain_id_version_numb_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_native_calendar_events_master
    ON connect_native_calendar_events (version_chain_id, version_number)
    WHERE recurrence_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_native_calendar_events_exception
    ON connect_native_calendar_events (version_chain_id, recurrence_id, version_number)
    WHERE recurrence_id IS NOT NULL;
