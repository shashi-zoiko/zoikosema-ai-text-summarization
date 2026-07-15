# Phase 2 · Slice 5 — Team / Resource / Roster-Derived Calendars

**Branch:** `sema/team-resource-roster-calendars`, cut from `feature/sema-calendar-mail`, merged back (commit `52a4dafd`)
**Status:** done
**Depends on:** Phase 2 slice 3 (native CalendarEvent CRUD)
**Spec refs:** §3.1 (Person/Organisation nodes), §6.1 (rosters/teams), §18 Phase 2 scope row

## Goal

Calendars scoped to a team or a bookable resource (room, equipment), plus roster-derived team calendars once ZoikoTime roster data is available as a read signal.

## Reuse — don't rebuild

- `app/models/organization.py` (`Organization`, `OrganizationMember`) — per CONTEXT.md §1's mapping, `Person`/`Organisation` Work Graph nodes map onto these existing tables; team calendars are a view/scope over `OrganizationMember`, not a new identity concept.
- `connect_native_calendar_events` (slice 3) — a team/resource calendar is a `tenant_id` + `owner_scope` (user vs team vs resource) query over the same table, not a parallel event store.
- The `ZOIKOTIME_INTEGRATION_ENABLED` flag and read-side plumbing from Phase 1 slice 7 — roster-derived team membership is the same kind of read-only external signal; reuse the flag and the pattern, extend rather than add a second flag.

## Build new

- `resource` as a first-class bookable entity (room, equipment) — minimal model: `resource_id, tenant_id, name, type, cost, booking_rules`. Booking a resource is an attendee-like edge on `connect_native_calendar_events`, not a separate event type.
- Team calendar = a saved query (team members' events, policy-filtered) rather than a materialized separate calendar table — avoids duplicating event data per team member.
- Roster-derived team membership: once ZoikoTime roster reads exist (depends on `zoikotime-workforce-signal-integration.md` or Phase 1 slice 7's stub), team calendar membership can auto-populate; until then, team membership is manually assigned via `OrganizationMember`, which already works and is not blocked by this slice.

## Explicitly out of scope

- Resource cost caps / spend policy enforcement (§4.2 "Volume/cost caps") — that's a Policy Engine input, add when Policy Engine (slice 1) has a real spend-tracking consumer; this slice just models `cost` as data.
- Full roster auto-sync — depends on the separate ZoikoTime integration plan; this slice's roster support is manual-membership-first, auto-populate-later.

## Done when

- A team calendar view correctly aggregates its members' events, policy-filtered per the querying user's own visibility rights.
- A resource can be added as an attendee/booking on a native event and conflict-checked (double-booking the same room rejected or flagged) via the existing availability computation, extended to consider resource busy-intervals alongside person busy-intervals.

## What actually shipped (done 2026-07-14)

Built close to plan, with one deliberate field-level cut and one real bug fixed along the way:

- **Skipped `cost`/`booking_rules` on the resource model**, despite the plan's own sketch listing them. Nothing in this slice enforces or displays either — that's Policy Engine's job once a real spend-cap consumer exists (§4.2). Modeling inert fields nobody reads yet is the premature-schema trap the plan's own "explicitly out of scope" section already warned about for cost *enforcement*; extending that same reasoning to the *data field* itself, not just its enforcement, kept the table genuinely minimal.
- **"Policy-filtered per viewer's visibility rights" resolved to the one real rule that exists today**: a confidential event owned by someone else redacts to a bare "Busy" block in the team view. This is narrower than spec §9.2's full placeholder-in-outbound-invite behavior (slice 7's job), but it's the same `confidentiality_class` field, applied honestly to the first surface that actually reads across other people's events — not a fabricated permission system with nothing behind it.
- **Resource conflict-checking is advisory, not enforced** — deliberately. A hard reject inside `create_event`/`update_event` would bypass the Policy Engine/Action Review Queue governance model already built in slices 1-3; real accept/reject on a resource conflict belongs to the Scheduling Engine (slice 6), not this one.
- **Found and fixed a real bug in `list_occurrences()`** (shared by team_calendar, availability, and this slice's resource conflicts) while writing the recurring-resource-conflict test: it matched occurrences on start-time-within-window only, so an occurrence that started before the query window but still overlapped it was silently missed. Fixed by widening the query start by the event's own duration and adding an explicit overlap check. Re-ran slices 3 and 4's full regression suites afterward — no existing test's outcome changed, it only caught a case none of them exercised.

Verified against the real dev Postgres DB (migration `connect_v3_008_resources.sql` applied): confidentiality redaction correct both ways (hidden from teammates, visible to the owner); a personal (non-org) tenant's team calendar is correctly scoped to just that one user; resource CRUD and validation; overlapping vs. non-overlapping booking conflict detection; an event correctly excluded from conflicting with its own prior booking; and a recurring event's expanded occurrence correctly caught as a resource conflict.
