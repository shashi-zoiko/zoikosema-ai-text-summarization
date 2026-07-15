# Phase 2 · Slice 3 — Native CalendarEvent CRUD + Version Chain

**Branch:** `sema/native-calendar-event-crud`, cut from `feature/sema-calendar-mail`, merged back (commit `7dbc1ca3`)
**Status:** done
**Depends on:** Phase 2 slices 1-2 (Policy Engine, Action Review Queue)
**Spec refs:** §3.1 (CalendarEvent node), §5.2 (rollback via version chain), §12.3, §18 Phase 2 exit gate

## Goal

The first Sema-authoritative (not provider-synced) calendar object, with the version-chain rollback substrate spec §5.2 requires. This is the first real mutation in the whole feature — the reason Policy Engine and Action Review Queue had to exist first.

## Reuse — don't rebuild

- `connect_calendar_events` (slices 2/3, Phase 1) is provider-**synced**, read-only data — do not add native-authorship fields to that table. Native events are a distinct table per spec §8.1's "connected-provider records are provider-authoritative; native Sema objects are Sema-authoritative" split.
- `server/app/core/calendar.py` (iTIP/iMIP generator, extended in Phase 1 slice 5) — native event create/update reuses this for external attendee invites, don't fork a second ICS path.
- `app/connect/action_review/` (slice 2) — direct create/update at L0-L1 (no staging); L2+ per spec's autonomy table stages through the queue instead of mutating directly. This slice builds both paths behind the resolved autonomy level from Policy Engine (slice 1).

## Build new

- `connect_native_calendar_events` table + SQLAlchemy model, following the `connect_v3_*` RLS/trigger convention: `event_id, tenant_id, title, time_range, timezone, rrule (nullable — slice 4 fills this in), attendees, resources, confidentiality_class, version_chain_id, version_number`.
- Version chain: every update/delete inserts a new version row rather than mutating in place (spec §12.3 "rollback operations create new events rather than deleting history"); `restore_previous_version` (the Action Review Queue's rollback descriptor from slice 2) reads this chain.
- `calendar.event.mutated.v1` event (already named in CONTEXT.md §1's reuse table, not yet added) fires on every create/update/delete.
- CRUD API gated by `resolve_effective_autonomy(tenant, "calendar", user)`: L0/L1 → direct create with human as author; L2 → `action_review.stage_action()` instead of direct mutation.

## Explicitly out of scope

- RRULE/recurrence — `rrule` field exists on the model but recurrence expansion logic is slice 4.
- Confidential external placeholder titles — slice 7.
- Team/resource/roster calendars — slice 5. This slice is single-user personal native events only.
- L3/L4 autonomous execution — no tenant has a Calendar ceiling above L2 configured yet (Policy Engine slice 1 ships with conservative defaults); L3/L4 code paths can be stubbed to raise "not yet supported" rather than built speculatively.

## Done when

- Create → update → delete round-trips correctly build a version chain; `restore_previous_version` correctly reconstructs prior state and re-emits the required iTIP/iMIP update per spec §5.2.
- L2-ceiling tenant: creating an event stages it in the Action Review Queue instead of mutating directly; approving the queue item performs the actual creation.
- Verified against real Postgres, following the same "not just unit-tested" bar set in CONTEXT.md §9.

## What actually shipped (done 2026-07-14)

Built as planned, with one deliberate scope narrowing:

- **Autonomy gating (stage-vs-direct) is wired for `create` only.** Update and delete always mutate directly in this slice. Staging them without a matching execute-on-approve counterpart would have been a half-finished feature rather than a smaller one — the plan's own "Done when" bar only tests create's L2 path, so this was the honest cut. Deferred to whichever later slice needs L2 update/delete specifically.
- The generic Action Review Queue (slice 2) doesn't know what a calendar event is, so "approving the queue item performs the actual creation" is satisfied by a new **combined endpoint** (`POST /native-events/proposals/{id}/approve`) that calls `action_review.approve()` then calendar_service's own `create_event_from_approved_proposal()` executor in one request — keeping the queue generic while calendar_service (correctly, per its own "the producing feature builds the executor" responsibility) owns the wiring.
- **Restoring an event is itself a new version**, per spec §12.3 — it copies the previous version's fields forward into version N+1 rather than un-cancelling in place, and re-emits a `METHOD:REQUEST` iTIP (a fresh invite), not a "never mind" — from an attendee's perspective the event is back, which reads the same as a new invite.
- iTIP UID is the event's `version_chain_id`, stable across every version (create/update/delete/restore all reference the same calendar entry), with `SEQUENCE` tracking `version_number` — same precedent Phase 1 slice 5 established for meeting invites.
- **Caught and fixed a real bug before it ever ran**: the outbox-enqueued event and the live-published event for the same mutation were being built as two separate `EventEnvelope` instances with different auto-generated ids. `_emit_mutated()` now builds the envelope once and returns it for the caller to reuse for `publish()`.

Verified against the real dev Postgres DB (migration `connect_v3_006_native_calendar_events.sql` applied, outbound email monkeypatched to a capture): a full create → update → delete → restore round-trip correctly builds a 4-version chain with the right iTIP METHOD/STATUS/SEQUENCE at each step and one stable UID throughout; updating a cancelled event is rejected; the append-only trigger rejects a direct `UPDATE`; invalid time ranges are rejected; and the full L2 flow (raise ceiling → create stages instead of mutating → approving materializes the event) works end-to-end, with an explicit check that no row exists before approval.

One documented, deliberately-accepted rough edge: calling the raw service executor (`create_event_from_approved_proposal`) a second time on the same already-approved item would create a duplicate event, since this MVP has no "executed" terminal status distinct from "approved." The combined API endpoint is the intended single entry point; nothing in this slice calls the raw executor twice.
