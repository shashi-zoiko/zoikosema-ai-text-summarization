# Phase 3 · Slice 3 — Outlook Mail Read-Only Sync

**Branch:** `sema/outlook-mail-readonly-sync`, cut from `feature/sema-calendar-mail`
**Status:** planned
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
