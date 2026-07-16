-- =============================================================================
--  Zoiko Connect v3 — mail assignments (Phase 4 slice 2)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Spec §1.2 explicit non-goal: "Assignment and shared inbox primitives are
--  allowed; ticketing/SLA productisation is not." status is intentionally
--  exactly open/done — no priority, due date, or SLA timer; see this
--  slice's own plan file for the line this must stay on the right side of.
--  Ordinary mutable table (one current assignment per message, reassigned
--  in place), not append-only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_mail_assignments (
    id                  UUID PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    message_id          UUID NOT NULL,   -- references connect_mail_messages.id
    assigned_to_user_id BIGINT NOT NULL, -- references legacy users.id
    assigned_by_user_id BIGINT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    correlation_id      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, message_id)
);

CREATE INDEX IF NOT EXISTS ix_connect_mail_assignments_assignee
    ON connect_mail_assignments (tenant_id, assigned_to_user_id, status);

DROP TRIGGER IF EXISTS trg_connect_mail_assignments_touch ON connect_mail_assignments;
CREATE TRIGGER trg_connect_mail_assignments_touch
    BEFORE UPDATE ON connect_mail_assignments
    FOR EACH ROW EXECUTE FUNCTION connect_touch_updated_at();

ALTER TABLE connect_mail_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_mail_assignments_tenant_iso ON connect_mail_assignments;
CREATE POLICY connect_mail_assignments_tenant_iso ON connect_mail_assignments
    USING (tenant_id = current_setting('app.tenant_id', true));
