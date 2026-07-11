# Sema Calendar & Mail — Engineering Context

Working notes for building against [`SEMA_CALENDAR_MAIL_SPEC.md`](./SEMA_CALENDAR_MAIL_SPEC.md) on top of the actual Zoiko Meet codebase. Read this before writing code; the spec file is the reference of record for what was approved, this file is "how it lands here."

Branch: `feature/sema-calendar-mail`. Parent spec class: this is a Class 3 spec under `architecture/SPEC.md` (Class 2 Master Platform Architecture) — same relationship as the other rows in [`downstream-specs.md`](./downstream-specs.md).

## 1. What already exists that this feature must reuse, not duplicate

The spec's Architecture Rule (§2) is explicit: Calendar and Mail must not create a second identity plane, policy engine, audit system, or AI permission model. This codebase already has a governance spine under `server/app/connect/` built for the messaging/media/session planes — it is the thing to extend, not a template to re-derive from scratch:

| Spec concept | Existing code | Reuse plan |
|---|---|---|
| Audit Ledger (§10.3) | `app/connect/audit/service.py`, `app/connect/audit/models.py` — append-only `AuditEvent`, DB-trigger-enforced immutability, `log()` helper that must run in the mutation's own transaction | Every `AgentAction` and every calendar/mail mutation calls this same `audit.log(...)`. No new audit table. |
| Tenant isolation (§2, §6.2) | `app/connect/shared/tenant.py` — `TenantContext`, `resolve_tenant()`, `org:{id}` / `personal:{user_id}` tenant IDs, Postgres RLS convention (`connect_v3_*.sql` migrations) | CalendarEvent/Email tables are `connect_*` tables from day one: RLS + `TenantContext.require()` on every access, same as messaging. |
| Event bus / canonical events (§12.2) | `app/connect/events/bus.py`, `events/outbox.py` (outbox pattern), `events/types.py` (versioned string constants like `MESSAGE_SENT = "message.sent.v1"`) | Add `calendar.event.synced.v1`, `calendar.event.mutated.v1`, `mail.message.synced.v1`, etc. to `events/types.py` following the existing `.v{N}` suffix convention. Same outbox, same bus. |
| Idempotency (§8.1) | `app/connect/shared/idempotency.py` | Every provider mutation (send, create/update/delete event) keys through this, not a bespoke dedupe table. |
| Correlation / telemetry (§8.3) | `app/connect/shared/telemetry.py` — `get_correlation_id()` already threaded into audit rows | Reuse for sync job tracing and provider API call traces. |
| Gateway / realtime push | `app/connect/gateway/` (ws, fanout, router) | Calendar/inbox live-update pushes (new event synced, review queue item appended) ride the existing WS fanout, not a new socket. |
| iCalendar generation | `server/app/core/calendar.py` — already generates `.ics` / iTIP `METHOD:REQUEST` for meeting invites | This is the seed of the iTIP/iMIP outbound requirement (§7.1). Extend it; don't replace it. It already got a real bug fix (ORGANIZER must be deliverable) — read the existing docstring before touching. |
| Org/tenant identity | `app/models/organization.py`, `OrganizationMember` | `Person`/`Organisation` Work Graph nodes (§3.1) map onto `User` + `Organization` + `OrganizationMember` rather than new identity tables. |

What's genuinely **net-new** and has no existing seed in this repo:

- Work Graph as a queryable typed graph (§3) — today relationships are implicit in relational FKs; there is no graph service or policy-filtered query layer.
- Policy Engine / autonomy resolution (§4.1) — no autonomy levels, no policy versioning exist anywhere in the codebase yet.
- Action Review Queue (§5) — no review-queue concept exists (closest analogue is the meeting waiting-room admission flow, which is a narrower, single-purpose review gate).
- Token Vault (§7.4) — no OAuth token storage for third-party providers exists; current `auth.py` Google references are Google **login** OAuth (identity), not Calendar/Gmail API scopes.
- Provider adapters (Google Calendar, Microsoft Graph, Gmail) — none exist.
- DLP — none exists.

## 2. Sequencing decision for this branch

Per DR-02 and DR-03 (integrate before hosting; calendar before mail) and the Phase 1 roadmap (§18), this branch starts with **Phase 1 — Calendar Integration MVP** only:

- Google Calendar + Microsoft 365/Outlook Calendar sync (read + availability).
- Sema Meet scheduling on top of existing meeting creation (`app/api/meetings.py`).
- RSVP, reminders, presence — reminders already partially exist (`app/core/meeting_reminders.py`); extend, don't fork.
- Admin consent flow, per-tenant token vault (minimum: encrypted-at-rest refresh tokens, not yet full HSM/KMS — flag this as a gap to close before Phase 3's Gmail scope, since Gmail is the harder CASA gate).
- iMIP outbound via the existing `.ics` generator.
- Read-only ZoikoTime availability signal if/when a ZoikoTime integration point exists in this repo (needs confirming — flagging as open question below, not assuming).

Explicitly **not** in this branch's first cut: Work Graph service, Policy Engine, Action Review Queue, autonomy levels, Mail Connect, DLP. Those are Phase 2/3 per the roadmap and each is a substantial service in its own right — building them ahead of Calendar MVP would violate the doctrine test in §1.3 ("does this make an agent action possible/governable" — there's no agent action to govern yet in Phase 1, which is intentionally L0/L1-only).

## 3. Open questions before Phase 1 implementation starts

These need an answer (from the user, or by inspecting parts of the codebase not yet reviewed) before writing the Calendar Service:

1. **ZoikoTime integration surface** — no real client/contract exists yet. `architecture/adr/ai/ADR-AI-025-zoikotime-integration-contract.md` is still `Status: Proposed / Decision: TBD`, and the only trace in running code is mock demo data in `server/app/api/settings.py` (an `"MCP"` registry stub listing `"ZoikoTime MCP"` with tools like `read-workforce-signal` — UI placeholder, not a real backend integration). Phase 1 should stub the ZoikoTime availability read behind a feature flag (defaulting off) rather than block on ADR-AI-025 landing, per §6.1's own phasing note ("read-only visibility Phase 1; hard enforcement Phase 2+").
2. **Google/Microsoft OAuth app registration** — do Google Cloud / Azure AD app registrations for Calendar scopes (distinct from the existing login-OAuth app) already exist, or does Phase 1 include provisioning them? This gates whether real sync can be tested end-to-end or only built against mocked provider responses initially.
3. **Token storage bar for Phase 1** — spec requires HSM/KMS-backed vault (§7.4) as the end state. Is per-tenant envelope encryption via the existing DB (e.g. `pgcrypto` / app-level AES-GCM with a KMS-held key) acceptable for Phase 1, with a hardening ticket for full HSM-backed vault before Phase 3 (Gmail restricted scopes), or must the vault be built to final spec before any refresh token is persisted?

Until these are answered, the concrete Phase 1 build plan (migrations, adapter interfaces, API routes, client feature module) is a design exercise, not a commitment — proposing it next as a plan rather than starting to write code.

## 4. Branching model and slice sequencing (decided 2026-07-11)

Working agile, one small slice at a time, not a big-bang build:

```
main
 └─ feature/sema-calendar-mail        (epic branch — everything Sema lands here first)
     ├─ sema/provider-connections-token-vault   (done — see §5)
     ├─ sema/google-calendar-readonly-sync      (done — see §6)
     ├─ sema/outlook-calendar-readonly-sync     (next)
     ├─ sema/sema-meet-scheduling-l1
     └─ sema/rsvp-reminders-imip
```

Each sub-branch is cut from `feature/sema-calendar-mail`'s current tip, stays open days not weeks, and merges back via PR before the next one is cut. `feature/sema-calendar-mail` only merges to `main` at a real Phase exit gate (§18 of the spec), not continuously.

**Work Graph and Policy Engine are explicitly deferred**, confirmed again this session — Phase 1 is L0/L1 only (suggest/observe), so there is no agent mutation yet to govern. Building the graph/policy substrate now would be premature; it lands in Phase 2 when Action Review Queue and L2+ actions actually need it. Before writing code for any new slice: check this file and `app/connect/` for something to extend before adding something new (the repo already has audit, events/outbox, tenancy, and idempotency — governed features should reuse those, not fork parallel ones).

## 5. Slice 1 — Provider Connection Token Vault (done)

Minimal OAuth token vault, scoped to unblock every later calendar/mail slice (nothing can sync without a stored, encrypted provider token). Branch: `sema/provider-connections-token-vault`.

**Reused as-is:** `ConnectBase`, `uuid7_str`, `TenantContext`/`resolve_tenant`, `EventEnvelope`, `audit.log`, `events/outbox.enqueue`, `events/bus.publish`, the `session_service` module shape (`models.py`/`service.py`/`api.py`), the `connect_v3_*.sql` RLS/trigger idioms. `cryptography` and `httpx` were already transitive deps (via `python-jose[cryptography]` and `anthropic`) — made explicit in `requirements.txt` rather than added new.

**Built new (had no analog in the repo):**
- `server/migrations/connect_v3_002_provider_connections.sql` — `connect_provider_connections` table (RLS + touch trigger, same pattern as `connect_v3_001_init.sql`). **Not yet run against any database** — same "runs once as a dedicated job" convention as the init migration; needs an operator to apply it.
- `app/connect/shared/crypto.py` — Fernet envelope encryption for refresh/access tokens, keyed by a new `TOKEN_VAULT_KEY` setting. This is the Phase 1 stopgap referenced in open question #3 above (§7.4 in the spec wants HSM/KMS — that's a later hardening pass, not blocking Phase 1).
- `app/connect/provider_connections/` — `models.py`, `service.py` (`connect_provider`, `list_connections`, `disconnect_provider`), `api.py` (`POST /api/connect/provider-connections`, `GET .../provider-connections`, `DELETE .../provider-connections/{provider}`), `adapters/google.py` (authorization-code → token exchange + userinfo lookup, isolated so calendar sync's adapter can follow the same shape).
- New config fields: `token_vault_key`, `google_calendar_client_id/secret/redirect_uri`.
- New event types: `provider_connection.connected.v1`, `provider_connection.disconnected.v1`.

**Explicitly not built in this slice:** token refresh-on-expiry logic, Microsoft adapter (rejected with a 400 for now — table/API accept the value, adapter doesn't exist yet), any calendar sync itself. Those are the next slices.

**Follow-ups before this is usable end-to-end (not done this session):**
1. Run `connect_v3_002_provider_connections.sql` against a real Postgres instance.
2. Generate a `TOKEN_VAULT_KEY` (`Fernet.generate_key()`) and set it in env — without it, `crypto.encrypt`/`decrypt` raise `TokenVaultMisconfigured` rather than silently storing plaintext.
3. Register a Google Cloud OAuth app with Calendar API scopes and set `google_calendar_client_id/secret/redirect_uri` — this is separate from whatever OAuth app (if any) backs today's login flow, and is the same registration this file's open question #2 already flagged.
4. Local dev note, unrelated to this code: `server/venv/` on this machine is a stale copy from another contributor's machine (hardcoded paths, missing `python.exe`) — recreate it fresh (`python -m venv venv`) before running the server locally.

## 6. Slice 2 — Google Calendar read-only sync (done)

Full-pull sync (no incremental syncToken yet) over a fixed window (7 days back, 90 days forward), using slice 1's token vault. Branch: `sema/google-calendar-readonly-sync`.

**Reused as-is:** everything from slice 1's reuse list, plus `ProviderConnection` itself (loaded, not duplicated) and `provider_connections/adapters/google.py` (extended in place with `refresh_access_token()` and `list_events()`, rather than starting a second Google adapter file).

**Built new:**
- `server/migrations/connect_v3_003_calendar_events.sql` — `connect_calendar_events` (plain synced-data table, RLS + touch trigger; FK to `connect_provider_connections`). **Not yet run.**
- `app/connect/calendar_service/` — `models.py`, `service.py` (`sync_calendar`, `list_calendar_events`), `api.py` (`POST /api/connect/calendar/sync`, `GET .../calendar/events`).
- Access-token refresh-on-demand (`_ensure_valid_access_token` in `calendar_service/service.py`) — the thing slice 1 explicitly deferred. Kept local to this module rather than promoted to a shared helper since it has exactly one caller today; extract if/when a second consumer needs it.
- New event type: `calendar.sync.completed.v1` — one per sync run, not per event. Per-event `calendar.event.synced.v1` (which §1's table above anticipated) was deliberately **not** added: nothing subscribes to per-event fanout yet (no Work Graph, no live UI), and Google sync windows can return hundreds of events, so it would be pure write volume with no reader. Add it when a real consumer needs it.

**Explicitly not built in this slice:** incremental sync via `syncToken` (§7.1's 410-Gone-triggers-full-resync requirement), push notification channels/webhooks, Outlook adapter, timezone-aware display beyond raw UTC storage, any UI.

**Follow-ups before this is usable end-to-end:**
1. Run `connect_v3_003_calendar_events.sql` (after `connect_v3_002_...`, migrations are ordered).
2. Same 3 provider/vault follow-ups from §5 still apply — this slice is unusable without a real Google OAuth app and `TOKEN_VAULT_KEY`.
3. `all_day` events currently store midnight-UTC as `start_at`/`end_at` (see `_parse_when` docstring in `adapters/google.py`) — fine for storage, but any client rendering must branch on `all_day` rather than trusting the instant.

## 7. Slice 3 — Outlook/Microsoft Calendar read-only sync (done)

Second provider, same sync semantics as slice 2 (full pull, fixed window). Branch: `sema/outlook-calendar-readonly-sync`.

**Refactor done first, before adding the new adapter:** slice 2's `ExchangedTokens`/`RefreshedAccessToken`/`RawEvent` dataclasses lived in `adapters/google.py`. With a second provider about to define the identical shapes, that would've been copy-pasted duplication — pulled them out to `adapters/shared.py` and pointed `google.py` at the shared versions before writing `outlook.py`. Also added `adapters/get_adapter(provider)` (a `{provider_string: module}` registry) so `provider_connections/service.py` and `calendar_service/service.py` each dropped their Google-only `if provider != "google_calendar": raise` and now dispatch generically — both files are provider-agnostic for the first time.

**Built new:**
- `app/connect/provider_connections/adapters/outlook.py` — Microsoft identity platform (`/oauth2/v2.0/token`) + Graph (`/v1.0/me`, `/v1.0/me/calendarview`) adapter, same three functions as `google.py` (`exchange_code`, `refresh_access_token`, `list_events`), same `RawEvent` shape.
- `app/connect/provider_connections/adapters/shared.py` — the extracted dataclasses (see refactor note above).
- New config fields: `microsoft_calendar_client_id/secret/redirect_uri/tenant` (tenant defaults to `"common"` — personal + any org account; narrow to a GUID to restrict to one Azure AD tenant).

**Provider quirks worth knowing if this breaks later:**
- Graph pagination returns a full next-page URL (`@odata.nextLink`) that already carries the query string — resending `params` on the follow-up request would double-encode them, so `outlook.py`'s loop drops `params` after the first page. Google's pagination (`nextPageToken`) is a bare token that gets re-added to `params` each time — the two loops are *not* interchangeable, don't try to unify them.
- Graph's event resource has no `status` field like Google's `confirmed/tentative/cancelled`; only `isCancelled` (bool). Mapped to `"cancelled"` / `"confirmed"` — Graph has no wire concept of "tentative" at the event level, so that status value never appears for Outlook events (Google's does).
- `Prefer: outlook.timezone="UTC"` header forces Graph to return timestamps already in UTC — without it, Graph returns the mailbox's configured timezone and the naive `dateTime` string would silently be misinterpreted as UTC by `_parse_graph_datetime`.

**Explicitly not built in this slice:** anything CalDAV/Apple (still adapter-interface-only per the spec's own Build/Integrate/Defer table), Azure AD app registration itself (same category of external-provisioning follow-up as Google's).

**Follow-ups:** register an Azure AD app with `Calendars.Read`/`User.Read`/`offline_access` and set the four `microsoft_calendar_*` config values — otherwise `outlook.exchange_code` raises `Invalid` immediately, same failure shape as the unconfigured-Google case in slice 1.

## 8. Slice 4 — Sema Meet scheduling suggestions, L1 (done)

Spec §4 L1 ("Suggest"): compute free/busy slots for the current user, never write anything. Branch: `sema/sema-meet-scheduling-l1`.

**Reused as-is:** `connect_calendar_events` (slice 2/3's synced data) and the legacy `app/models/meeting.py::Meeting` table — this is the first Sema code that reads across both planes in one query, which is fine; they're the same Postgres database via the same SQLAlchemy session, just two different declarative bases.

**Built new:**
- `app/connect/calendar_service/availability.py` — `suggest_available_slots()`, pure read/compute, no audit log and no outbox event (nothing is mutated or governed, so neither applies — see the module docstring for why this is a deliberate omission, not a gap).
- `GET /api/connect/calendar/availability` — `on_date`, `duration_minutes`, `day_start_hour`, `day_end_hour` query params, returns free slots.

**Known approximation, stated deliberately:** legacy `Meeting` rows have `scheduled_at` but no duration/end field (a live call's real length isn't known ahead of time), so each non-cancelled scheduled meeting is treated as occupying a flat `DEFAULT_MEETING_DURATION_MINUTES = 60` for conflict purposes. If this produces bad suggestions in practice, the correct fix is adding a real duration estimate to `Meeting`, not tuning this file.

**Bug caught and fixed during this slice, before commit:** the initial free-slot merge loop didn't clamp busy intervals to the `[day_start, day_end]` window — a busy interval starting after `day_end` (e.g. an event at 19:00 when the window ends at 18:00) produced a phantom free slot extending past `day_end` (`09:00–19:00` instead of `09:00–18:00`). Verified with a standalone reproduction of the merge algorithm before and after the fix (7 cases incl. the regression); the venv on this machine is still broken (see §5 follow-up #4) so this couldn't be run through the actual FastAPI/DB stack, only the pure algorithm in isolation.

**Explicitly not built in this slice:** multi-attendee coordination (only the current user's own availability), any UI, actually creating the meeting from a suggested slot (that's L2 — a staged proposal in the Action Review Queue, which doesn't exist yet and is correctly out of scope for L1).
