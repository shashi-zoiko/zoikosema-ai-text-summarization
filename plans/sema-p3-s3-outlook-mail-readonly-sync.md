# Phase 3 · Slice 3 — Outlook Mail Read-Only Sync

**Branch:** `sema/outlook-mail-readonly-sync`, cut from `feature/sema-calendar-mail`
**Status:** done — real Azure AD app + real Outlook mailbox validation completed 2026-07-15
**Depends on:** Phase 3 slice 2 (`connect_mail_messages` table, `mail_service` module)
**Spec refs:** §7.2, §7.4

## Goal

Second mail provider, same sync semantics as slice 2 — proves `mail_service` is provider-agnostic the same way Calendar Phase 1 slice 3 proved `calendar_service` was.

## Reuse — don't rebuild

- `mail_service/service.py::sync_mail` (slice 2) — extend the SAME function's provider dispatch via `get_adapter()`, don't fork a second sync function. **Already provider-agnostic as of the 2026-07-15 dispatch refactor** (see slice 2's follow-up note): full-vs-incremental is decided by `getattr(adapter, "list_messages_delta", None)` / `getattr(adapter, "HistoryExpired", None)` on whichever adapter `get_adapter()` returns, not by a hardcoded provider name. If Outlook Mail's adapter defines both, incremental sync works automatically with no `mail_service/service.py` changes; if it doesn't yet, full pull is used automatically — either is fine to start with.
- `adapters/get_adapter(provider)` registry, `adapters/shared.py::RawMessage` — Outlook's adapter returns the same `RawMessage` shape, same discipline as calendar's Google/Outlook adapters converging on `RawEvent`.
- Microsoft Graph delta-query mechanics already exist for calendar (`adapters/outlook.py`'s pagination-via-`@odata.nextLink` handling, the `Prefer: outlook.timezone` lesson) — Mail delta (`/me/mailFolders/inbox/messages/delta`) follows the identical pagination shape; reuse the SAME pagination loop code if it can be factored into `adapters/shared.py`, rather than copy-pasting it a third time.

## Build new

- `app/connect/mail_service/adapters` — wait, adapters live in `provider_connections/adapters/`, not per-service — so: `provider_connections/adapters/outlook_mail.py` (a SECOND Outlook-family adapter, since Graph Calendar and Graph Mail use different endpoints/scopes even though both are "Microsoft"), with `exchange_code`/`refresh_access_token`/`build_authorization_url`/`list_messages`, same pattern as `gmail.py`.
- New config fields: `outlook_mail_client_id/secret/redirect_uri/tenant` (separate Azure AD app registration from `microsoft_calendar_*`, same reasoning as Gmail's separate OAuth app in slice 1 — Mail.Read is a materially different permission grant than Calendars.Read).

## Explicitly out of scope

- Same as slice 2: body content, UI.

## Done when

- Same bar as slice 2, for Outlook: messages sync into `connect_mail_messages`, delta/incremental works or gracefully falls back, verified against real Postgres (adapter responses mocked if no real test mailbox is available yet, matching Calendar Phase 1 slice 3's own verification approach).

## What actually shipped (done 2026-07-15)

Built as planned, with one naming deviation and one API-shape deviation from Gmail's slice 2, both explained below:

- New `provider_connections/adapters/outlook_mail.py` — `exchange_code`/`refresh_access_token`/`build_authorization_url`/`list_messages`/`list_messages_delta`/`HistoryExpired`, same shape as `gmail.py`. Auth follows `adapters/outlook.py` (Calendar)'s already-proven Microsoft identity platform pattern (separate Azure AD app, `Mail.Read` scope only, matching Gmail's minimal-scope-first approach).
- **Naming deviation from this doc's original draft:** the provider identifier is `microsoft_mail`, not `outlook_mail` (config fields are `microsoft_mail_client_id/secret/redirect_uri/tenant`; the CHECK constraint and adapter registry key are both `microsoft_mail`). This matches the existing `google_calendar`/`microsoft_calendar` naming convention (provider family + domain, not vendor nickname) and — more importantly — matches what `connect_v3_010_provider_connections_mail_providers.sql`'s own comment already committed to: *"Add 'microsoft_mail' alongside this when Phase 3 slice 3 needs it."* The adapter **module file** is still named `outlook_mail.py` (a file-naming choice only, same as `microsoft_calendar`'s adapter file being named `outlook.py` not `microsoft_calendar.py`).
- **API-shape deviation from Gmail, and why:** unlike Gmail (separate `messages.list` for full pull + `history.list` for incremental), Microsoft Graph's delta query is documented as the recommended mechanism for BOTH the initial sync and incremental follow-ups — the token-less first call enumerates current mailbox state page-by-page and ends in an `@odata.deltaLink`, which becomes the incremental checkpoint. So `list_messages()` (full pull) and `list_messages_delta()` (incremental) both page through the same delta endpoint internally in this one file; this is provider-internal reuse (contained entirely inside `outlook_mail.py`), not a new cross-adapter abstraction. Every message returned by a given pull is stamped with that pull's final `deltaLink` as its `history_id` — this is what lets `mail_service/service.py`'s existing generic "advance the checkpoint from `raw.history_id`" loop (built for Gmail's per-message `historyId`) work unmodified for Outlook too, including establishing a checkpoint from the very first full pull (a gap the pre-slice-3 design review flagged as a real decision to make, not deferred).
- New config: `microsoft_mail_client_id/secret/redirect_uri/tenant` (`app/core/config.py`) — separate Azure AD app registration from `microsoft_calendar_*`.
- Registry: `microsoft_mail` added to `adapters/__init__.py::_ADAPTERS`. **Zero changes to `mail_service/service.py`** — the provider-agnostic dispatch refactor done ahead of this slice worked exactly as intended: an adapter exposing `list_messages_delta`/`HistoryExpired` gets incremental sync automatically.
- Widened `_PROVIDERS`/`SyncMailIn.provider` Literals (`provider_connections/api.py`, `mail_service/api.py`) and the DB CHECK constraint (new migration `connect_v3_013_provider_connections_microsoft_mail.sql`, exactly the migration `connect_v3_010`'s own comment said would be needed).
- No UI, no message body content (both correctly out of scope, same as slice 2).

Verified (no live Azure AD app or real mailbox available in this environment): (1) `outlook_mail.py`'s own HTTP/parsing logic directly against a mocked Graph transport — single-page and multi-page full pull, field mapping (from/to/subject/snippet/thread via `conversationId`), incremental delta resume calling the exact stored `deltaLink` URL, and `HistoryExpired` raised correctly on a 410; (2) the real `sync_mail()` function with `provider="microsoft_mail"` through the real adapter registry — full sync with no checkpoint, incremental sync advancing the checkpoint, and expired-deltaLink fallback re-establishing a fresh checkpoint, all via the unmodified generic dispatch. Regression-checked: Gmail's own three sync scenarios still pass unchanged, and calendar's `google_calendar`/`microsoft_calendar` adapters still resolve correctly through the same registry.

**Real validation (2026-07-15):** a real Azure AD app ("ZoikoSema Outlook Mail", tenant=common, `Mail.Read`/`offline_access`/`User.Read`) was registered and exercised end-to-end through a real browser: `/authorize` → real Microsoft consent screen → real code exchange at `/callback` → `POST /api/connect/mail/sync {"provider":"microsoft_mail"}` returned `{"mode":"full","fetched":0,...}` with no errors (mailbox was empty, so 0 messages is expected, not a failure). Confirms real OAuth consent, real token exchange, and a real Graph API call all work.

**Bug found and fixed during this validation:** `/callback` required `provider` as a query parameter, but Google/Microsoft's OAuth redirect never sends one (not part of the OAuth spec) — every real provider connect (not just Outlook Mail) was failing with a 422 before this fix. Fixed by recovering `provider` from the signed `state` token instead, which already carried it (`service.py`'s `verify_oauth_state` now returns `(user_id, provider)`; `api.py`'s `/callback` no longer declares `provider` as a query param). This was a pre-existing bug from slice 6 (Phase 1), never caught because that slice's own verification only ever called `/callback` directly via `TestClient`, never through a real provider redirect — same gap this note used to describe for slice 3 itself.

**Also added:** `client/src/pages/CalendarIntegrations.jsx`'s provider list now includes `gmail` and `microsoft_mail` (was Calendar-only) so mail providers are actually reachable from the UI — reuses the existing generic connect/disconnect flow as-is, no new component.
