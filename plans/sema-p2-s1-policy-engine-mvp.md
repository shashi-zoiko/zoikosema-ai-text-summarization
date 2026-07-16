# Phase 2 · Slice 1 — Policy Engine MVP

**Branch:** `sema/policy-engine-mvp`, cut from `feature/sema-calendar-mail`, merged back (commit `d019f88c`)
**Status:** done
**Depends on:** Phase 1 complete (slices 1-7)
**Spec refs:** §4, §4.1, §4.2, §11 (Policy Engine row), §1.3 doctrine test

## Goal

First slice of Phase 2, and the first slice of the whole feature that needs a governance substrate — per CONTEXT.md §4's own deferral note, Phase 1 was correctly L0/L1-only with nothing to govern. Phase 2's native CalendarEvent CRUD (slice 3) is the first real mutation, so the Policy Engine has to exist before it, not after.

## Reuse — don't rebuild

- `app/connect/shared/tenant.py` (`TenantContext`) — policy scope resolution is tenant-scoped, same primitive as everything else in `app/connect/`.
- `app/connect/audit/service.py` — every policy evaluation is itself an audited event (`policy.evaluated`, spec §12.2), same `audit.log()` call, not a new logging path.
- `app/connect/events/types.py` / `outbox.py` — `policy.evaluated` and `settings.policy.versioned` join the existing versioned-event-name convention (`.v{N}` suffix).

## Build new

- `app/connect/policy_engine/` (mirrors `presence_service`/`session_service` shape): `models.py` (`PolicyVersion` — immutable after publish, diffable, per spec §12.3; `AutonomyCeiling` per category per tenant), `service.py` (`resolve_effective_autonomy()` implementing §4.1's deterministic minimum-of-inputs resolution), `api.py` (admin endpoints to set/view ceilings, versioned).
- Scope for this MVP: **Calendar category only** (Mail's policy inputs are Phase 3's concern — don't build DLP-related policy inputs yet, they have no consumer until Mail Connect exists).
- Inputs implemented for the MVP resolution (§4.1): tenant category ceiling, workspace policy, user preference. Sensitivity class, recipient/domain risk, DLP verdict, MCP ceiling, incident brake are stubbed as always-pass until the features that produce them exist (mail, DLP, MCP registry) — don't build inputs with no real signal source yet.
- `settings.policy.versioned` event fired on every policy change, consumed by audit only for now (Settings History as a queryable "as-of" API is a separate follow-up, not blocking this MVP).

## Explicitly out of scope

- Mail policy inputs, DLP integration, MCP server ceiling, incident brake — no consumer exists yet (doctrine test §1.3: don't build governance for actions that don't exist).
- Settings History UI/diff/export (spec §14, Settings History row) — the versioned `PolicyVersion` model this slice builds is what a later Settings History slice reads; don't build the query/diff/export surface until Action Review Queue and Admin Console work needs it.
- Policy Exception Handling (§14.1) — exceptions are a refinement on top of ceilings; add only when a real exception request surfaces (Phase 2 slice 7's confidential-event handling may be the first real consumer — check there first).

## Done when

- `resolve_effective_autonomy(tenant, category="calendar", user)` returns a deterministic level given a tenant ceiling + workspace policy + user preference, and logs which inputs it resolved (per §4.1's "must... log the resolved inputs" requirement).
- Every policy read/write emits an audited `policy.evaluated` / `settings.policy.versioned` event.
- No existing Phase 1 behavior changes — this slice only adds a queryable resolver; nothing calls it yet (slice 2/3 wire it in).

## What actually shipped (done 2026-07-14)

Built as planned. Notable implementation decisions:

- `resolve_effective_autonomy()` commits its own audit row rather than leaving that to the caller — it's designed to be callable standalone (a bare status check with no surrounding mutation), and `get_db()` never auto-commits, so without a self-contained commit the `policy.evaluated` audit event would be silently dropped on such a call.
- Default ceiling with no `PolicyVersion` row yet is **L1**, not L0 or L4 — matches every Phase 1 feature built so far (read + L1 suggestions only); a higher default would have granted L2+ direct-mutation rights before slice 2's Action Review Queue exists to govern them.
- `policy.evaluated` is audit-logged every time but deliberately has **no outbox/event-bus emission** — no Observability consumer exists yet to read per-evaluation fanout, same reasoning `calendar_service` already used for skipping unread per-event fanout. `settings.policy.versioned` (real, low-frequency state changes) does get the full audit + outbox + event-bus treatment.
- Admin-role check for `POST /policy/ceiling` includes `"personal"` in the allowed roles — a solo tenant (no org membership) has exactly one member, who is definitionally its own admin; excluding it would have made personal tenants unable to ever configure their own policy.

Verified against the real dev Postgres DB (migration `connect_v3_004_policy_versions.sql` applied): default ceiling with no rows, set/version-increment/history ordering, resolution reflecting the current ceiling, append-only UPDATE correctly rejected by the DB trigger, and out-of-range/unsupported-category inputs rejected.
