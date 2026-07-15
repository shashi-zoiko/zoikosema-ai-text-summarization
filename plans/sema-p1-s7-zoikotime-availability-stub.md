# Phase 1 · Slice 7 — ZoikoTime Read-Only Availability Stub

**Branch:** `sema/zoikotime-availability-stub`, cut from `feature/sema-calendar-mail`, merged back (commit `73737600`)
**Status:** done
**Depends on:** slice 4 (L1 scheduling suggestions) — done. Loosely related to `plans/zoikotime-workforce-signal-integration.md` (separate cross-repo plan) but does not block on it.
**Spec refs:** §6.1, §18 Phase 1 scope row, CONTEXT.md open question #1

## Goal

Spec §6.1 requires scheduling to read ZoikoTime workforce truth (shifts, approved leave, rest windows) as availability input — but per §6.1's own phasing note, Phase 1 is "read-only visibility" only, no hard enforcement. This slice adds that read-only signal to `suggest_available_slots()` (slice 4), gated off by default, without waiting for the full webhook/event-bus integration (`zoikotime-workforce-signal-integration.md`) to land.

## Reuse — don't rebuild

- `app/connect/calendar_service/availability.py::suggest_available_slots()` (slice 4) — extend its busy-interval computation with an additional source, don't fork a second availability function.
- Feature flag pattern already used elsewhere in this codebase for optional integrations (check `app/core/config.py` for the existing convention before inventing a new one).

## Build new

- A `ZOIKOTIME_INTEGRATION_ENABLED` config flag (default `false`) — same flag named in `plans/zoikotime-workforce-signal-integration.md`, so both sides of that integration gate on the identical name.
- A `WorkforceSignal`-shaped read interface in `availability.py` that, when the flag is on, adds ZoikoTime-sourced busy intervals (shift-off-hours, approved leave/OOO, rest windows) to the merge alongside `connect_calendar_events` and legacy `Meeting` rows.
- When the flag is off (default, and the only real state until the webhook plan ships data), this is a no-op passthrough — zero behavior change, verified by a test that asserts identical output with the flag off before and after this slice merges.

## Explicitly out of scope

- The actual webhook receiver, `ZoikoTimeLink` model, or any live data — that's `zoikotime-workforce-signal-integration.md`'s scope, a separate plan/branch/repo pair. This slice only builds the read-side plumbing in `availability.py` so that when real `WorkforceSignal` rows exist, wiring them in is a small follow-up, not a redesign.
- Hard constraint enforcement (rejecting a booking that violates a shift/rest window) — that's Phase 2's Scheduling Engine (slice 6), per §6.1's explicit "read-only visibility Phase 1; hard enforcement Phase 2+."

## Done when

- Flag off (default): `suggest_available_slots()` output is byte-identical to pre-slice behavior.
- Flag on with a hand-inserted test `WorkforceSignal` row: the corresponding interval is correctly excluded from suggested slots, verified with the same "isolated algorithm + real Postgres" verification approach used for slice 4's merge-loop bug fix.

## What actually shipped (revised scope, done 2026-07-13)

Deviated from the plan in one deliberate way: **no `WorkforceSignal` table was built.** The original sketch above assumed one would exist to hand-insert a test row into, but nothing writes to such a table yet — the webhook receiver that would populate it lives entirely in `plans/zoikotime-workforce-signal-integration.md`, a separate cross-repo plan that hasn't started. Building a real table with no writer would just be permanent dead schema (and a migration nobody could apply meaningfully). Instead:

- `_zoikotime_busy_intervals()` in `availability.py` is the read-side seam, gated by the new `zoikotime_integration_enabled` config flag (default off, same name the other plan already commits to). It always returns `[]` today, regardless of the flag, because there's no data source — the flag exists so that turning it on *later*, once a real table lands, requires no further plumbing changes.
- Verified the merge-loop wiring (not a real DB row) by monkeypatching the seam function in a test to simulate what a future real signal would return, confirming `suggest_available_slots()` correctly excludes the simulated interval. This tests the actual scope of this slice — the wiring — without needing to fabricate a table with no real writer.
- Confirmed flag-off is a true no-op: `suggest_available_slots()` output is unaffected with the flag at its default.

This completes Phase 1's scope list (slices 1-7, all merged into `feature/sema-calendar-mail`). The Phase 1 *exit gate* (spec §18 — 30 consecutive beta days, RRULE/timezone corpus, admin consent validated, CASA programme started) is a separate, still-open operating milestone, not cleared by finishing the build work — see `sema-roadmap.md`.
