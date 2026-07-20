# Phase 1 · Slice 6 — Admin Consent / OAuth Connect UI

**Branch:** `sema/admin-consent-oauth-ui`, cut from `feature/sema-calendar-mail`, merged back (commit `330d52ba`)
**Status:** done
**Depends on:** slice 1 (token vault) — done
**Spec refs:** §7.3, §10.1, §18 Phase 1 exit gate ("M365 and Workspace admin consent validated")

## Goal

Today, `POST /api/connect/provider-connections` expects an already-obtained `authorization_code` — nothing generates the actual Google/Microsoft consent-screen redirect. This slice builds that missing front door: a UI flow a real admin/user can click through to connect a provider.

## Reuse — don't rebuild

- `app/connect/provider_connections/` (`models.py`, `service.py`, `api.py`, `adapters/google.py`, `adapters/outlook.py`, `adapters/shared.py`) — this slice adds a redirect-URL builder and callback handler in front of the existing `connect_provider` service call; it does not touch the token exchange logic itself.
- `adapters/get_adapter(provider)` registry (added in slice 3) — the redirect-URL builder should be a new function per adapter (`build_authorization_url()`), following the same one-function-per-provider shape as `exchange_code`/`refresh_access_token`/`list_events`.

## Build new

- `build_authorization_url(provider, state)` in each adapter — constructs the Google/Microsoft OAuth consent URL with the right scopes (Calendar-only for this slice; Gmail/Graph-Mail scopes are Phase 3's concern, don't request them yet).
- `GET /api/connect/provider-connections/authorize?provider=...` — returns the redirect URL, sets a short-lived signed `state` value (CSRF protection) tied to the tenant/user.
- `GET /api/connect/provider-connections/callback` — receives the provider redirect (`code`, `state`), verifies `state`, calls the existing `connect_provider` service.
- Client-side: a small settings screen (wherever org/user integration settings live in `client/src/`) with "Connect Google Calendar" / "Connect Outlook Calendar" buttons and a connected/disconnected status per provider, reusing `GET .../provider-connections` (already exists) for status.

## Explicitly out of scope

- Gmail/Outlook Mail scopes — Calendar only, per DR-03 (calendar before mail).
- Tenant-level admin consent flows for enterprise M365/Workspace (spec §10.1's "tenant-level admin consent") — this slice is per-user consent; tenant-wide consent is an enterprise-tier hardening pass, flag as a follow-up, don't block this slice on it.
- Token refresh UI/manual reconnect flows beyond what `disconnect_provider` already supports.

## Done when

- A real human can click through the full OAuth dance in a browser against a real Google Cloud OAuth app and a real Azure AD app (the two credential-registration follow-ups already open from slices 1/3 — this slice is what finally exercises them end-to-end, not mocked).
- CSRF `state` mismatch is rejected with no token stored.
- Audit row exists for the connect action (already true via `connect_provider`, verify it fires from this new entry path too).

## What actually shipped (done 2026-07-13)

Built essentially as planned, with the `state` mechanism doing double duty (not just CSRF, also the only way `/callback` recovers *which user* is completing the flow, since a provider's redirect carries no bearer token):

- `build_authorization_url(state)` added to both adapters, reusing the exact `exchange_code`/`refresh_access_token`/`list_events` shape. Outlook's previously-duplicated scope string was consolidated into one `_SCOPE` constant used by all three functions — a small in-scope cleanup since all three were being touched anyway.
- `create_oauth_state`/`verify_oauth_state` in `service.py`: a 10-minute signed JWT (reusing `jwt_secret`, no new secret introduced) tagged with a `purpose` claim so it can never be replayed as a real access/refresh token.
- `GET /authorize` (authenticated) and `GET /callback` (deliberately unauthenticated — see module docstring in `api.py`) added to `provider_connections/api.py`. Callback handles the user-declined-consent case (`?error=access_denied` from the provider) and invalid/expired state, redirecting to the SPA with `?error=...` instead of ever 500ing on an expected failure mode.
- New `CalendarIntegrations.jsx` page, linked from `AccountSettings.jsx`'s real workspace section — **not** added to the big `Settings.jsx` "Integrations" section, which turned out to be static enterprise-demo data with no real backend wiring; bolting real OAuth into a mock surface would have been inconsistent with that page's actual (unfinished-demo) nature.

**Blocked and unblocked mid-slice:** verification hit the exact pre-existing `SessionMember.session_id` missing-FK bug documented in CONTEXT.md §9 (any query against the `connect_v3` mapper registry crashes). The fix already existed as an unmerged commit (`fix/session-member-missing-fk`, `10a1d868`) — cherry-picked just that commit into this slice rather than re-diagnosing, after first trying (and rejecting) a full branch merge that pulled in unrelated meeting-feature changes. That commit still needs its own PR into `main`, independent of Sema.

Verified via FastAPI `TestClient` against the real dev Postgres DB (Google's token exchange mocked, no real OAuth app registered yet): unauthenticated `/authorize` rejected, bad `state` redirects with an error not a 500, valid state+code completes the connection, and replaying the same callback is idempotent (upsert, not a duplicate row). Frontend: `eslint` clean and `npm run build` succeeds with the new page route-split into its own chunk.

**Still open** (as originally scoped — not this slice's job): real Google Cloud OAuth app + Azure AD app registration, so the flow can be exercised against a real consent screen instead of a mocked token exchange.
