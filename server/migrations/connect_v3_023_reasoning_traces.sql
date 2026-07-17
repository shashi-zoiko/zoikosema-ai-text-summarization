-- =============================================================================
--  Zoiko Connect v3 — structured reasoning traces, Phase 4 slice.
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as every other connect_v3_0XX migration.
--  Safe to re-run.
--
--  Spec §5.1 Queue Item field "Reasoning trace" (concise agent rationale,
--  source graph nodes, prompt/tool chain, model/version, confidence and
--  uncertainty markers) / §5.4 (reviewable, immutable after execution,
--  redactable per reviewer access, exportable for Enterprise audit roles).
--
--  Was a bare `reasoning_trace_ref TEXT` on connect_action_review_items
--  holding an ad-hoc "func_name:model" string with none of §5.1's required
--  structure. This table is the real structured trace; reasoning_trace_ref
--  now points at this table's `id` instead of being the trace itself.
--
--  One row per queue item that has one (human-proposed items have none —
--  see action_review/service.py's stage_action, reasoning_trace is only
--  passed for agent-originated proposals). Append-only: a trace is written
--  once at staging time and never edited after, matching "immutable after
--  execution" the same way connect_policy_versions/connect_audit_events do
--  for their own append-only data.
--
--  Export tooling for Enterprise audit roles is explicitly NOT built here —
--  no Enterprise tier/role exists in this codebase yet (confirmed: no
--  packaging/tiers infrastructure), so building an export endpoint now
--  would be exporting to nothing. Redaction-by-reviewer-access IS built —
--  see action_review/api.py's role check on the trace-read endpoint.
-- =============================================================================

CREATE TABLE IF NOT EXISTS connect_reasoning_traces (
    id                    UUID PRIMARY KEY,
    tenant_id             TEXT NOT NULL,
    queue_item_id         UUID NOT NULL,
    rationale             TEXT,
    source_nodes          JSONB NOT NULL DEFAULT '[]'::jsonb,
    tool_chain            JSONB NOT NULL DEFAULT '[]'::jsonb,
    model                 TEXT,
    confidence            REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    uncertainty_markers   JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_connect_reasoning_traces_queue_item
    ON connect_reasoning_traces (tenant_id, queue_item_id);

DROP TRIGGER IF EXISTS trg_connect_reasoning_traces_append_only ON connect_reasoning_traces;
CREATE TRIGGER trg_connect_reasoning_traces_append_only
    BEFORE UPDATE OR DELETE ON connect_reasoning_traces
    FOR EACH ROW EXECUTE FUNCTION connect_reject_mutation();

ALTER TABLE connect_reasoning_traces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connect_reasoning_traces_tenant_iso ON connect_reasoning_traces;
CREATE POLICY connect_reasoning_traces_tenant_iso ON connect_reasoning_traces
    USING (tenant_id = current_setting('app.tenant_id', true));
