# Phase 3 · Slice 1 — Mail Token Vault Extension + Gmail Adapter

**Branch:** `sema/mail-gmail-connection`, cut from `feature/sema-calendar-mail`, merged back (commit `5046708e`)
**Status:** done
**Depends on:** Phase 2 complete (Policy Engine, Action Review Queue, provider_connections module)
**Spec refs:** §7.2 (Mail Providers), §7.3 (Google CASA gate), §7.4 (Token Vault)

## Goal

Gmail OAuth connection + token storage, mirroring Calendar Phase 1 slice 1 exactly. This is the foundation every later Mail slice needs — nothing can sync mail without a stored, encrypted Gmail token.

## Reuse — don't rebuild

- `app/connect/provider_connections/` (models.py, service.py, api.py, `adapters/shared.py`'s `ExchangedTokens`/`RefreshedAccessToken`/`RawEvent` dataclasses, `adapters/get_adapter()` registry) — a mail provider is just another row in the SAME `connect_provider_connections` table (it already has no calendar-specific columns) and another entry in the SAME adapter registry. Do not create a parallel `connect_mail_connections` table.
- `app/connect/shared/crypto.py` (Fernet envelope encryption, `TOKEN_VAULT_KEY`) — same vault, same key, no new secret.
- The admin-consent OAuth UI (Phase 1 slice 6: `/authorize`, `/callback`, signed-state CSRF, `CalendarIntegrations.jsx`) — this flow is already provider-agnostic (it takes a `provider` string); adding `"gmail"` to the `Literal` types and `_ADAPTERS` registry is the whole integration, not a new UI.

## Build new

- `app/connect/provider_connections/adapters/gmail.py`: `exchange_code`, `refresh_access_token`, `build_authorization_url` (same three-plus-one shape as `adapters/google.py`), and a NEW `list_messages(access_token, *, history_id=None, time_min=None) -> list[RawMessage]` replacing calendar's `list_events` for this provider. Gmail scope: `https://www.googleapis.com/auth/gmail.readonly` only — read-only per spec §1.1/DR-03 sequencing (send is a much later slice).
- `RawMessage` dataclass in `adapters/shared.py` (parallel to `RawEvent`): `provider_message_id, thread_id, subject, snippet, from_, to, sender_domain, received_at, history_id, label_ids`.
- New config fields: `gmail_client_id/secret/redirect_uri` (distinct OAuth app from `google_calendar_*` — Gmail restricted scopes are a SEPARATE Google Cloud OAuth consent screen/verification track per spec §7.3, must not reuse the Calendar app's client id).
- Add `"gmail"` to `_PROVIDERS`/`_ADAPTERS` registries in `provider_connections/api.py` and `adapters/__init__.py`.

## Explicitly out of scope

- Outlook Mail (slice 3).
- Any actual sync (slice 2) — this slice only gets a token into the vault.
- Send scopes (`gmail.send`) — read-only until a much later slice (send/reply/forward, slice 9) explicitly widens the OAuth consent scope, since every added scope re-triggers Google's verification review per §7.3.

## Done when

- A real human can connect a Gmail account via the existing admin-consent UI and see it listed as an active `connect_provider_connections` row with `provider="gmail"`.
- `exchange_code`/`refresh_access_token` verified against a real Gmail OAuth app (the follow-up already open since Calendar Phase 1 slice 1/6 — registering a Google Cloud OAuth app — applies here too, as its own, separate app).

## What actually shipped (done 2026-07-14)

Built as planned, with one real bug caught only because the end-to-end flow was actually exercised against the real DB rather than assumed to work:

- **Found a genuine gap in the OAuth flow's claimed provider-agnosticism**: `connect_provider_connections.provider` has a DB-level CHECK constraint (from migration 002) hardcoding the two Phase 1 calendar provider strings. The first real INSERT of a `"gmail"` row was rejected by Postgres, not by any application code — proving the value of testing against the real database rather than mocking it away. Fixed with a new additive migration (010) widening the constraint, not by editing migration 002 in place.
- Also authored the **full detailed Phase 3 plan** (11 slices) this session, replacing the earlier sequencing-only sketch, and **resequenced Work Graph from slice 1 to slice 7** — the original sketch wanted it first, but building a graph substrate before any real Email node exists to populate it would have repeated the exact doctrine-test violation this whole build has avoided everywhere else. See `sema-roadmap.md` for the full table.
- `list_messages` fetches Gmail metadata via `messages.list` + per-message `messages.get(format=metadata)` — no bulk-metadata endpoint exists in the base Gmail API, so this is an inherent N+1 pattern, not an oversight; body content is deliberately excluded (headers/snippet only) since the rendering pipeline (slice 4) has to exist before any HTML body is ever fetched.

Verified: `build_authorization_url` produces a correctly-scoped (readonly only, no send) consent URL and raises cleanly when unconfigured; `list_messages` correctly parses a mocked Gmail API response into `RawMessage` objects (subject/from/to/sender_domain/labels/received_at all correct). Against the real dev Postgres DB: the full `/authorize` → `/callback` admin-consent flow works for `provider="gmail"` with zero changes to that flow's own code, and the original Google Calendar flow (same underlying code path) was re-verified unaffected by the constraint widening and adapter-registry change.
