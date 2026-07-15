# Phase 3 · Slice 2 — Gmail Read-Only Sync

**Branch:** `sema/gmail-readonly-sync`, cut from `feature/sema-calendar-mail`, merged back (commit `95fabcda`)
**Status:** done
**Depends on:** Phase 3 slice 1 (Gmail token vault + adapter)
**Spec refs:** §7.2, §8.1 (Sync Engine), §8.2 (SLOs), §12.2 (`mail.message.synced`)

## Goal

Pull Gmail messages into a new `connect_mail_messages` table, mirroring Calendar Phase 1 slice 2's full-pull sync exactly, then layer Gmail's real incremental mechanism (`history.list`) on top in the SAME slice — unlike Calendar, which deferred incremental sync as a named follow-up. Reason for the difference: Gmail's `history.list` requires a `historyId` checkpoint from the FIRST full pull, so "full pull" and "incremental" are two halves of one mechanism here, not separable the way calendar's `syncToken` optionality allowed.

## Reuse — don't rebuild

- `app/connect/calendar_service/service.py::sync_calendar` — same shape (load connection → ensure valid access token → adapter call → upsert rows → audit + outbox `mail.message.synced.v1` once-per-run, not per-message, per calendar_service's own precedent for "no reader yet for per-item fanout") — but a NEW `mail_service/service.py`, not folded into `calendar_service`, since mail is genuinely a different domain module (matches `provider_connections`/`calendar_service` already being siblings, not nested).
- `adapters/gmail.py::list_messages` (slice 1).
- `_ensure_valid_access_token` pattern (calendar_service's own refresh-on-demand helper) — same logic, new call site.

## Build new

- `connect_mail_messages` table (migration): `id, tenant_id, user_id, provider_connection_id, provider, provider_message_id, thread_id, subject, snippet, from_email, to_emails (JSONB), sender_domain, received_at, history_id, label_ids (JSONB), correlation_id, created_at, updated_at`. Plain synced data, provider-authoritative (spec §8.1) — same class of table as `connect_calendar_events`, not append-only.
- `app/connect/mail_service/` (new module: `models.py`, `service.py`, `api.py`) — `sync_mail(db, ctx, *, provider) -> dict`, `list_mail_messages(db, ctx, *, time_min=None) -> list`.
- Store `history_id` per connection (new column on `connect_provider_connections`, or a small side table if multiple mailboxes-per-connection ever matters — start with a column, simplest thing that works) so the NEXT sync call can request `history.list(startHistoryId=...)` instead of a full pull.
- `410`/history-expired handling: Gmail's `history.list` can return an error when the history id is too old (analogous to Calendar's `syncToken` 410-Gone) — on that error, clear the stored `history_id` and fall back to a full pull, same recovery shape as spec §7.1 already specifies for Calendar.

## Explicitly out of scope

- Message BODY content — this slice syncs headers/metadata/snippet only (subject, from/to, snippet). Full body fetch + rendering is slice 4's job (rendering pipeline must exist before raw HTML is ever fetched, let alone shown).
- Outlook (slice 3).
- Any UI (slice 5).

## Done when

- A connected Gmail account's messages appear as `connect_mail_messages` rows after a sync call, verified against a real Postgres instance.
- A second sync call after new mail arrives only pulls the delta (verified by checking `history_id` advances and re-sync doesn't re-process already-synced messages) — or, if no real Gmail test account with control over message arrival is available, verified by directly exercising the two code paths (full pull vs. history.list) against mocked adapter responses, same rigor Calendar Phase 1 slice 2 used.

## What actually shipped (done 2026-07-14)

Built as planned — full pull and `history.list`-based incremental sync as two branches of one `sync_mail()`, not a deferred follow-up:

- New `connect_mail_messages` table (migration 012) and a `mail_history_id` checkpoint column on `connect_provider_connections` (migration 011), applied directly against the real dev Postgres instance.
- `adapters/gmail.py` gained `list_messages_delta()` (history.list, paginated, `messageAdded` entries only) and a `HistoryExpired` exception for the 404 case; `mail_service/service.py`'s `sync_mail()` picks incremental vs. full pull based on whether a `mail_history_id` is already stored, and on `HistoryExpired` clears the checkpoint and falls through to a full pull in the same call.
- **DRY refactor beyond this slice's own scope, done deliberately rather than duplicated**: the token-refresh-on-demand helper (`_ensure_valid_access_token`) lived privately in `calendar_service/service.py`; mail sync needed the identical logic. Rather than copy it a second time, it moved up to its natural owner, `provider_connections/service.py`, as a public `ensure_valid_access_token()` — token freshness is a provider-connection concern, not a calendar-specific one. `calendar_service/service.py` now calls the shared version; a regression script re-verified calendar sync's fresh-token and refresh-token paths are unchanged.
- No Outlook Mail handling added yet (correctly deferred to slice 3) — `_INCREMENTAL_PROVIDERS = {"gmail"}` is the seam that slice adds to, not a speculative abstraction built now.

Verified against the real dev Postgres DB (a real `ProviderConnection` + `User` row, Gmail's own HTTP calls mocked): first sync with no checkpoint does a full pull and stores `mail_history_id`; second sync uses `history.list` and only processes the one new message, advancing the checkpoint; a simulated 404 correctly falls back to a full pull and re-seeds the checkpoint without duplicating the already-synced row. Regression-checked: Gmail OAuth connect flow (Phase 3 slice 1) and calendar sync (Phase 1 slice 2, through its refactored shared token helper) both still pass, plus the two permanent test files (`test_recurrence.py`, `test_availability_merge.py`).

### Follow-up (2026-07-15): dispatch made provider-agnostic ahead of slice 3

A pre-slice-3 design review flagged that `sync_mail()`'s incremental-vs-full dispatch had drifted from the `get_adapter()` discipline established elsewhere in this codebase: it imported `gmail` directly by name, hardcoded `_INCREMENTAL_PROVIDERS = {"gmail"}`, and caught `gmail_adapter.HistoryExpired` by name — meaning Outlook's addition in slice 3 would have meant a second hardcoded `elif provider == "outlook_mail"` branch next to Gmail's, rather than the two providers sharing one dispatch path (the same trap calendar's own two-provider precedent had already identified and avoided when Outlook Calendar was added — see `architecture/SEMA_CALENDAR_MAIL_CONTEXT.md`).

Fixed with the smallest possible change, on explicit instruction to introduce no new abstraction (no base class, protocol, or second registry) and to reuse `get_adapter()` as-is:

- `_INCREMENTAL_PROVIDERS` and the direct `gmail` import are gone from `mail_service/service.py`.
- The already-obtained `adapter` object (from `get_adapter(provider)`) is asked directly, via `getattr(adapter, "list_messages_delta", None)` / `getattr(adapter, "HistoryExpired", None)`, whether it supports incremental sync — the same duck-typing convention `get_adapter()` itself already uses (callers call `adapter.list_events`/`adapter.list_messages` by name/convention, not through an enforced interface).
- `gmail.py` and `adapters/shared.py` were **not** touched — `HistoryExpired` and `list_messages_delta` keep their existing names and shapes; only how the caller finds them changed.
- No public API or database schema changes.

This means the convention slice 3 needs is now: an adapter supporting incremental sync exposes `list_messages_delta(access_token, start_history_id=...)` and a `HistoryExpired`-style exception class; an adapter without incremental support (e.g. an early Outlook Mail adapter) simply omits both, and `sync_mail()` falls back to `list_messages` automatically — no changes to `mail_service/service.py` required when slice 3 lands.

Verified (real `sync_mail()` function, fake DB session + fake adapter modules — no live Postgres/Gmail account available in the review environment): full sync with no checkpoint, incremental sync advancing the checkpoint, and expired-checkpoint fallback re-establishing a fresh checkpoint all behave identically to the pre-refactor version. A full run against a live Postgres instance and a real connected Gmail account is still outstanding (same gap slice 2 itself already carried).
