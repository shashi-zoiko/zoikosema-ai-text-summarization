# Phase 2 · Slice 6 — Scheduling Engine Constraint Solver

**Branch:** `sema/scheduling-engine-constraint-solver`, cut from `feature/sema-calendar-mail`, merged back (commit `29d6185f`)
**Status:** done
**Depends on:** Phase 2 slices 3-5 (native events, recurrence, team/resource calendars); upgrades Phase 1 slice 4
**Spec refs:** §6.1, §11 (Scheduling Engine row), §18 Phase 2 scope row ("Scheduling Engine GA")

## Goal

Phase 1 slice 4 shipped a single-user, read-only free/busy suggester (`suggest_available_slots`). This slice upgrades that into the real constraint solver spec §6.1/§11 describes: multi-attendee coordination, resource cost, and (when the flag from Phase 1 slice 7 is live with real data) hard ZoikoTime constraint enforcement rather than just visibility.

## Reuse — don't rebuild

- `app/connect/calendar_service/availability.py::suggest_available_slots()` — this slice extends its merge algorithm to accept multiple attendees' busy-interval sets and resources, rather than replacing it. The existing clamp-to-day-window bug fix and its verification approach (CONTEXT.md §8) is the precedent for how correctness bugs in this file get caught — write the same kind of isolated-algorithm test battery before wiring in DB access.
- The `ZOIKOTIME_INTEGRATION_ENABLED` read path (Phase 1 slice 7) — this slice is where its output goes from "visibility only" to "constraint the solver rejects violations of," per §6.1's phasing note, gated by tenant policy (Policy Engine, slice 1) on whether enforcement is hard or advisory.
- `app/connect/policy_engine/` — constraint solver rejections must explain *why* (§6.1 "Constraint solver rejects overload schedules and explains rejection") using the same resolved-inputs logging pattern slice 1 established.

## Build new

- Multi-attendee availability merge: given N attendees' busy-interval sets (people + resources), compute mutually-available slots — a generalization of the current single-user merge loop.
- Rest-window and max-consecutive-hours constraints (§6.1 table) as explicit rejection rules, each producing a human-readable explanation, not a bare boolean.
- Resource cost/cap check (ties into slice 5's `resource.cost` field) as an advisory or hard constraint depending on tenant policy.

## Explicitly out of scope

- Any UI beyond an API that returns ranked/explained slot suggestions — Scheduling Engine UX is a client-side follow-up, not this slice.
- Exposing the solver directly to AI agents — spec §11 note "Exposed to agents only through governed tools" means an MCP-mediated tool wrapper, which is Phase 2 slice 8 / later AI orchestration work's concern, not this slice's.

## Done when

- A multi-attendee, multi-resource booking request returns correctly-merged available slots, verified with an expanded version of slice 4's isolated test battery (more attendees, more resource conflicts, rest-window violations).
- With `ZOIKOTIME_INTEGRATION_ENABLED` on and hard-enforcement policy set, a booking attempt that violates a rest window is rejected with an explanation, not silently allowed or silently dropped.

## What actually shipped (done 2026-07-14)

Built close to plan, with two adjustments driven by what actually existed by the time this slice started:

- **No `resource.cost` field to "tie into"** — slice 5 deliberately never built one (nothing consumed it then, still doesn't now). Resource cost/cap checking stays out of scope here too, for the same reason; this slice's resource constraint is purely availability-based (booking conflicts), not spend-based.
- **Hard enforcement is a global config flag (`zoikotime_hard_enforcement_enabled`), not a new Policy Engine category.** Policy Engine (slice 1) only models a per-category autonomy ceiling; adding a whole tenant-versioned policy dimension for a toggle with zero real backing data yet would have been schema weight nothing needs today. A plain flag, matching `zoikotime_integration_enabled`'s own precedent, is the right size — revisit if/when real per-tenant variation in enforcement actually matters.
- **Extracted the merge algorithm before extending it**: `slots_from_busy()` (now public, matching `recurrence.py`'s `expand_rrule` convention for pure/tested logic) is the one place the gap-finding math lives; both the original single-user suggester and the new multi-attendee one call it. Caught the "should this be public or private" question directly by asking what `expand_rrule` did in the equivalent situation, rather than guessing.
- **A genuine circular-import problem, solved by extraction, not a workaround.** `availability.py` already imported `native_events.py`; wiring ZoikoTime hard-constraint checking into `native_events.create_event`/`update_event` would have required importing `availability.py` back — a real cycle. Fixed by moving the ZoikoTime seam (both the existing read-side stub and the new hard-constraint check) into its own `zoikotime_signal.py`, which neither module depends on. This was a real architectural fix, not a local/deferred-import hack.
- **A recurring event's hard-constraint check only covers its first occurrence.** Checking every future occurrence of a series with no real signal source to violate against yet would be speculative complexity; revisit once the ZoikoTime cross-repo integration actually produces data.
- Resource conflicts remain advisory (slice 5's own call, unchanged) — ZoikoTime hard constraints are the one thing in this build that actually rejects a mutation outright, matching spec's explicit distinction between resource-cost human review and workforce-constraint solver rejection.

Verified: an 8-case isolated pure-algorithm battery for `slots_from_busy` (multi-subject merges, overlapping-subject merges, resource-shaped intervals, the original clamp-to-window regression, three-subject intersection). Against the real dev Postgres DB: multi-attendee group availability correctly excludes both attendees' busy time while each one's solo view stays unaffected by the other's; adding a resource booking narrows the group window further; both ZoikoTime flags off by default is confirmed a true no-op; with both flags on and a simulated signal, a violating `create_event` is rejected with an explanation, a non-conflicting one still succeeds, and `update_event` re-checks the constraint too. Slices 3, 4, and 5's full regression suites were re-run afterward with no change in outcome.
