-- =============================================================================
--  Zoiko Connect v3 — calendar events (read-only provider sync, Phase 1)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Sema Calendar & Mail spec §3.1 (CalendarEvent node) / §8 (sync engine).
--  This is a plain synced-data table, not the Work Graph — no edges, no
--  policy linkage. That's deferred to Phase 2, see
--  architecture/SEMA_CALENDAR_MAIL_CONTEXT.md §4.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_calendar_events (
    id                      UUID PRIMARY KEY,
    tenant_id               TEXT NOT NULL,
    user_id                 BIGINT NOT NULL,        -- references legacy users.id
    provider_connection_id  UUID NOT NULL REFERENCES connect_provider_connections(id) ON DELETE CASCADE,
    provider                TEXT NOT NULL,
    provider_event_id       TEXT NOT NULL,
    title                   TEXT,
    description             TEXT,
    location                TEXT,
    start_at                TIMESTAMPTZ,
    end_at                  TIMESTAMPTZ,
    all_day                 BOOLEAN NOT NULL DEFAULT false,
    status                  TEXT NOT NULL DEFAULT 'confirmed'
                               CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
    attendees               JSONB NOT NULL DEFAULT '[]',
    correlation_id          TEXT,
    created_by              BIGINT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, provider_connection_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS ix_connect_calendar_events_tenant_window
    ON connect_calendar_events (tenant_id, user_id, start_at);

DROP TRIGGER IF EXISTS trg_connect_calendar_events_touch ON connect_calendar_events;
CREATE TRIGGER trg_connect_calendar_events_touch
    BEFORE UPDATE ON connect_calendar_events
    FOR EACH ROW EXECUTE FUNCTION connect_touch_updated_at();

ALTER TABLE connect_calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_calendar_events_tenant_iso ON connect_calendar_events;
CREATE POLICY connect_calendar_events_tenant_iso ON connect_calendar_events
    USING (tenant_id = current_setting('app.tenant_id', true));
