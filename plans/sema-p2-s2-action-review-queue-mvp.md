# Phase 2 · Slice 2 — Action Review Queue MVP

**Branch:** `sema/action-review-queue-mvp`, cut from `feature/sema-calendar-mail`, merged back (commit `048cf85f`)
**Status:** done
**Depends on:** Phase 2 slice 1 (Policy Engine MVP)
**Spec refs:** §5.1, §5.2, §11 (Action Review Service row), DR-06

## Goal

One cross-category queue for staged agent/system actions awaiting human approval — spec DR-06 explicitly prohibits per-feature queue fragmentation, so this is built once, generically, before Calendar (slice 3/7) or any future Mail feature needs it.

## Reuse — don't rebuild

- The meeting waiting-room admission flow is explicitly called out in CONTEXT.md §1 as "a narrower, single-purpose review gate" — a related pattern to look at for admission/approval UX conventions, but not a queue to extend; this is a genuinely new, general-purpose service.
- `app/connect/policy_engine/` (slice 1) — every queue item's policy verdicts field (§5.1 table) comes from `resolve_effective_autonomy()` / policy evaluation, not a separate check.
- `app/connect/audit/service.py`, `events/outbox.py`, `shared/idempotency.py` — approve/reject/edit actions are audited, evented, and idempotent exactly like every other mutation in this codebase.
- `app/connect/gateway/` (WS fanout) — new queue items and status transitions push over the existing realtime channel, not a new socket.

## Build new

- `app/connect/action_review/` — `models.py` (`ReviewQueueItem`: proposed action payload, reasoning trace ref, policy verdicts, blast radius, rollback descriptor, status, SLA timestamps — exact fields from spec §5.1's table), `service.py` (`stage_action()`, `approve()`, `reject()`, `request_redraft()`, `escalate()`), `api.py`.
- Generic `action_type` + `action_payload` (JSON) design so any future producer (Calendar event proposal, later Mail draft) stages into the same table without a schema migration per action type.
- Rollback descriptor is a typed enum matching spec §5.2's table (`restore_previous_version`, `cancel_buffered_send`, `tombstone_message`, `no_rollback`) — the *executor* of each rollback type is built by the feature that needs it (e.g., calendar version restore ships with slice 3), this slice only defines the contract and dispatches to it.
- Client-side: a Review Queue UI surface (per spec §15.1, persistent in the workspace sidebar, not buried in Calendar) — approve/reject/edit controls, SLA age display.

## Explicitly out of scope

- Any actual action producer — this slice has no calendar or mail feature staging into it yet (slice 3/7 are the first real producers). Test this slice with a synthetic/manual staged item.
- Delayed-send buffer mechanics (§5.3) — that's Mail-specific (Phase 3); the queue's generic `rollback_descriptor` contract accommodates it later without rework.
- SLA alerting/escalation automation beyond the manual `escalate()` call — automated SLA breach detection is a follow-up once real queue volume exists to tune thresholds against.

## Done when

- A manually-staged synthetic action can be approved, rejected, or sent back for redraft, each transition audited and evented.
- Queue UI shows proposed action, reasoning trace, policy verdicts, and blast radius per spec §5.1's field list, using synthetic data.
- Design confirmed generic enough that Phase 2 slice 3/7 (calendar) and future Phase 3 mail slices plug in without a queue schema change — reviewed explicitly before merge.

## What actually shipped (done 2026-07-14)

Built as planned. Notable decisions and one bug found along the way:

- Every transition (`approve`/`reject`/`request_redraft`/`escalate`) requires the item to currently be `pending` — attempting a second transition on an already-resolved item raises `Conflict`, not a silent no-op or double-processing. This wasn't explicitly named in the plan but is the obvious correctness requirement for a review queue.
- `stage_action()` follows `messaging_service.send_message`'s exact dict-return convention (not the ORM-object convention other list/get functions use) specifically so idempotent-replay and fresh-write paths hand the API layer an identical shape without reconstructing a partial ORM instance.
- **Found and fixed a real pre-existing bug** (own commit, `089592fa`, same "separate from the slice" precedent as the earlier SessionMember FK fix): `shared/idempotency.py`'s `check()`/`store()` didn't guard against Redis being unreachable — `get_redis()` only constructs a lazy client, it never verifies connectivity, so a down Redis surfaced as an uncaught `ConnectionError` instead of degrading gracefully like `events/bus.py`'s `publish()` already does. This blocked verifying this slice's own idempotent-replay path on a Redis-less dev machine; `messaging_service` had the identical latent gap.
- Client: real `ReviewQueue.jsx` page linked from the persistent sidebar (`ClipboardCheck` icon, distinct from the unrelated pre-existing "Actions" page — which turned out to be AI-derived meeting to-do items, not a governance queue; confirmed this before building anything, to avoid confusing the two).

Verified against the real dev Postgres DB (migration `connect_v3_005_action_review.sql` applied): bad `rollback_descriptor` rejected pre-write, staging with a synthetic payload, idempotent replay (via a fake in-memory Redis, since this dev machine has none — real dedup logic actually exercised, not skipped) produces exactly one row, all four transition types work and audit correctly, a second transition on a resolved item is correctly rejected as `Conflict`, unknown item ids raise `NotFound`. Frontend: eslint clean, `npm run build` succeeds.
