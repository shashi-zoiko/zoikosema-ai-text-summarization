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
