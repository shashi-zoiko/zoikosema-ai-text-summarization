-- =============================================================================
--  Zoiko Connect v3 — bookable resources (Phase 2 slice 5)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Sema Calendar & Mail spec §3.1 / §6.1. A resource (room, equipment) is
--  reference data, not a governed mutation — no version chain, no
--  append-only trigger; ordinary mutable table with a touch trigger, same
--  shape as connect_provider_connections. Bookings live where they always
--  did: as entries in connect_native_calendar_events.resources (JSONB,
--  since connect_v3_006), referencing this table's id. No cost/
--  booking_rules columns yet — nothing in this slice enforces or even
--  displays them, and modeling inert fields with zero consumer is exactly
--  the premature-schema mistake worth avoiding; add them when a real
--  spend-policy or booking-rules consumer exists (see native_events.py's
--  own "don't build inputs with no real signal source" precedent).
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_resources (
    id          UUID PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'room' CHECK (type IN ('room', 'equipment')),
    created_by  BIGINT NOT NULL,        -- references legacy users.id
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_connect_resources_tenant
    ON connect_resources (tenant_id, name);

DROP TRIGGER IF EXISTS trg_connect_resources_touch ON connect_resources;
CREATE TRIGGER trg_connect_resources_touch
    BEFORE UPDATE ON connect_resources
    FOR EACH ROW EXECUTE FUNCTION connect_touch_updated_at();

ALTER TABLE connect_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_resources_tenant_iso ON connect_resources;
CREATE POLICY connect_resources_tenant_iso ON connect_resources
    USING (tenant_id = current_setting('app.tenant_id', true));
