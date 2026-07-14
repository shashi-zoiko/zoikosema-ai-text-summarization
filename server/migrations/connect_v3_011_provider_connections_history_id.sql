-- =============================================================================
--  Zoiko Connect v3 — add history_id checkpoint to connect_provider_connections
--  (Phase 3 slice 2)
--
--  Runs once against the production PostgreSQL instance as a dedicated job
--  (NOT from app startup), same as connect_v3_001_init.sql. Safe to re-run.
--
--  Gmail's history.list incremental sync needs a per-connection checkpoint
--  carried forward between sync runs. A plain column on the connection row
--  is the simplest thing that works (spec §8.1) — a side table would only
--  be justified if a single connection could ever front multiple mailboxes,
--  which Gmail's OAuth model does not allow. NULL means "no checkpoint yet,
--  do a full pull" (first sync, or after a 410 history-expired reset).
-- =============================================================================

ALTER TABLE connect_provider_connections
    ADD COLUMN IF NOT EXISTS mail_history_id TEXT;
