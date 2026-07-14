-- =============================================================================
--  Zoiko Connect v3 — native calendar events (Phase 2 slice 3)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Sema Calendar & Mail spec §3.1 (CalendarEvent node) / §5.2 (rollback via
--  version chain) / §12.3 (rollback operations create new events rather
--  than deleting history). Distinct from connect_calendar_events (Phase 1
--  slices 2/3), which is provider-synced, read-only, and provider-
--  authoritative — this table is Sema-authoritative, per spec §8.1's
--  "connected-provider records are provider-authoritative; native Sema
--  objects are Sema-authoritative" split.
--
--  Every create/update/delete/restore INSERTs a new version row rather than
--  mutating in place — append-only, same discipline (and same
--  connect_reject_mutation() trigger) as connect_audit_events and
--  connect_policy_versions. "Current" state of an event is the row with the
--  highest version_number for a given version_chain_id.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_native_calendar_events (
    id                      UUID PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    version_chain_id        UUID NOT NULL,          -- stable identity across every version of this event
    version_number          INTEGER NOT NULL,
    title                   TEXT NOT NULL,
    description             TEXT,
    location                TEXT,
    start_at                TIMESTAMPTZ NOT NULL,
    end_at                  TIMESTAMPTZ NOT NULL,
    timezone                TEXT NOT NULL DEFAULT 'UTC',   -- IANA name, display only; instants are stored UTC
    rrule                   TEXT,                    -- nullable; recurrence expansion is Phase 2 slice 4
    attendees               JSONB NOT NULL DEFAULT '[]',
    resources               JSONB NOT NULL DEFAULT '[]',   -- richer resource modeling is Phase 2 slice 5
    confidentiality_class   TEXT NOT NULL DEFAULT 'standard'
                               CHECK (confidentiality_class IN ('standard', 'confidential')),
    status                  TEXT NOT NULL DEFAULT 'confirmed'
                               CHECK (status IN ('confirmed', 'cancelled')),
    created_by              BIGINT NOT NULL,        -- organizer; references legacy users.id
    correlation_id          TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (version_chain_id, version_number)
);

CREATE INDEX IF NOT EXISTS ix_connect_native_calendar_events_latest
    ON connect_native_calendar_events (tenant_id, version_chain_id, version_number DESC);

CREATE INDEX IF NOT EXISTS ix_connect_native_calendar_events_window
    ON connect_native_calendar_events (tenant_id, created_by, start_at);

DROP TRIGGER IF EXISTS trg_connect_native_calendar_events_append_only ON connect_native_calendar_events;
CREATE TRIGGER trg_connect_native_calendar_events_append_only
    BEFORE UPDATE OR DELETE ON connect_native_calendar_events
    FOR EACH ROW EXECUTE FUNCTION connect_reject_mutation();

ALTER TABLE connect_native_calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_native_calendar_events_tenant_iso ON connect_native_calendar_events;
CREATE POLICY connect_native_calendar_events_tenant_iso ON connect_native_calendar_events
    USING (tenant_id = current_setting('app.tenant_id', true));
