# Sema Calendar & Mail — Roadmap & Slice Index

Master index for every planned slice of `architecture/SEMA_CALENDAR_MAIL_SPEC.md`, broken into small, single-PR-sized, branch-per-slice increments. This is the file to check before starting *any* new slice — it says what's done, what's next, and what each future slice depends on. Individual slice files hold the detailed build plan; this file holds sequencing and status only (DRY — don't repeat slice detail here, don't repeat spec text there).

Read [`../architecture/SEMA_CALENDAR_MAIL_CONTEXT.md`](../architecture/SEMA_CALENDAR_MAIL_CONTEXT.md) first for the reuse map (what existing `app/connect/` infra every slice must extend, not fork). That file's §4/§9 own the historical log of slices 1-4; this file takes over as the forward-looking index from slice 5 onward.

## Working rules (unchanged from CONTEXT.md §4)

- One slice, one branch, cut from `feature/sema-calendar-mail`'s tip, merged back via PR before the next slice starts. Branch naming: `sema/<slice-slug>`.
- `feature/sema-calendar-mail` only merges to `main` at a real phase exit gate (spec §18), not continuously.
- Before writing code for any slice: check `app/connect/` for something to extend (audit, events/outbox, tenancy, idempotency, provider_connections, calendar_service) before adding something new.
- Governance substrate (Policy Engine, Action Review Queue, Work Graph) is built exactly once, when the first slice that actually needs to govern a mutation arrives — not before (doctrine test, spec §1.3). That point is Phase 2, slice 1.
- Detailed plans exist for the *next* phase only. Phases further out get a slice list and dependency notes but not a full build plan yet — agile means the far-future plan is expected to change before it's built; over-specifying it now is waste.

## Status legend

`done` · `next` · `planned` · `not detailed yet` (phase 3+, listed for sequencing only)

## Phase 1 — Calendar Integration MVP (spec §18 row 1)

| # | Slice | Branch | Status | Plan file |
|---|---|---|---|---|
| 1 | Provider connection token vault | `sema/provider-connections-token-vault` | done | see CONTEXT.md §5 |
| 2 | Google Calendar read-only sync | `sema/google-calendar-readonly-sync` | done | see CONTEXT.md §6 |
| 3 | Outlook Calendar read-only sync | `sema/outlook-calendar-readonly-sync` | done | see CONTEXT.md §7 |
| 4 | Sema Meet scheduling suggestions, L1 | `sema/sema-meet-scheduling-l1` | done | see CONTEXT.md §8 |
| 5 | RSVP, reminders, iMIP outbound | `sema/rsvp-reminders-imip` | done | [sema-p1-s5-rsvp-reminders-imip.md](./sema-p1-s5-rsvp-reminders-imip.md) |
| 6 | Admin consent / OAuth connect UI | `sema/admin-consent-oauth-ui` | done | [sema-p1-s6-admin-consent-oauth-ui.md](./sema-p1-s6-admin-consent-oauth-ui.md) |
| 7 | ZoikoTime read-only availability stub | `sema/zoikotime-availability-stub` | done | [sema-p1-s7-zoikotime-availability-stub.md](./sema-p1-s7-zoikotime-availability-stub.md) |

**Phase 1 exit gate** (spec §18): sync SLOs met 30 consecutive beta days, RRULE/timezone corpus green, M365 + Workspace admin consent validated, CASA programme started. Slices 1-7 complete the scope list (all merged into `feature/sema-calendar-mail` as of `73737600`); the SLO/beta-day gate is an operating criterion that needs a real beta deployment to clock, not a code slice — **Phase 1's build work is done; the exit gate itself is not yet cleared.** Google/Azure OAuth app registration (open since slice 1) is still required before any of this can run against real accounts.

Note: slice 7 depends on `plans/zoikotime-workforce-signal-integration.md` (the separate cross-repo plan) only for the *write* direction (ZoikoTime → Sema webhook). Slice 7 itself only needs a read-only stub behind a feature flag, default off — it does not block on that other plan landing.

## Phase 2 — Native Sema Calendar (spec §18 row 2)

Governance substrate lands here because this is the first phase with an actual mutation (native event create/update) to govern. Order matters: Policy Engine before Action Review Queue before anything L2.

| # | Slice | Branch | Status | Plan file |
|---|---|---|---|---|
| 1 | Policy Engine MVP (autonomy levels, ceilings, resolution) | `sema/policy-engine-mvp` | done | [sema-p2-s1-policy-engine-mvp.md](./sema-p2-s1-policy-engine-mvp.md) |
| 2 | Action Review Queue MVP (cross-category) | `sema/action-review-queue-mvp` | done | [sema-p2-s2-action-review-queue-mvp.md](./sema-p2-s2-action-review-queue-mvp.md) |
| 3 | Native CalendarEvent CRUD + version chain | `sema/native-calendar-event-crud` | done | [sema-p2-s3-native-calendar-event-crud-versioning.md](./sema-p2-s3-native-calendar-event-crud-versioning.md) |
| 4 | Recurring events (RRULE/DST/timezone engine) | `sema/recurring-events-rrule` | done | [sema-p2-s4-recurring-events-rrule.md](./sema-p2-s4-recurring-events-rrule.md) |
| 5 | Team / resource / roster-derived calendars | `sema/team-resource-roster-calendars` | done | [sema-p2-s5-team-resource-roster-calendars.md](./sema-p2-s5-team-resource-roster-calendars.md) |
| 6 | Scheduling Engine constraint solver (upgrades slice 1.4's L1 suggestions) | `sema/scheduling-engine-constraint-solver` | done | [sema-p2-s6-scheduling-engine-constraint-solver.md](./sema-p2-s6-scheduling-engine-constraint-solver.md) |
| 7 | L2 event staging + confidential external placeholder | `sema/l2-event-staging-confidential-placeholder` | done | [sema-p2-s7-l2-event-staging-confidential-placeholder.md](./sema-p2-s7-l2-event-staging-confidential-placeholder.md) |
| 8 | AI agenda builder / pre-meeting brief / follow-up, L1-L2 | `sema/ai-agenda-brief-followup` | done | [sema-p2-s8-ai-agenda-brief-followup.md](./sema-p2-s8-ai-agenda-brief-followup.md) |
| 9 *(added later, not part of the original 8)* | Native calendar view UI (day/week/month grid, client-side) | `sema/native-calendar-ui` | next | see note below |

**Slice 9 note (2026-07-16):** the original 8 slices built the full native-calendar backend (event CRUD/versioning, recurrence, governance, scheduling, AI agenda) but none of them included an actual frontend calendar view — `client/src/pages/CalendarIntegrations.jsx` is only the OAuth connect screen, not a calendar. The sidebar already reserves a "Calendar" nav slot (`client/src/components/Layout.jsx`, currently `go: '/scheduled'`, a placeholder pointing at Meetings) — this slice builds the real page behind it and repoints that nav link. Added to the roadmap after the fact, once the gap was noticed; branched straight off `main` (not off `feature/sema-calendar-mail`) since it has no dependency on the in-flight mail work and can merge to main independently, same precedent as PR #46 merging Phase 2's backend before its own beta exit-gate criteria closed.

**Phase 2 exit gate** (spec §18): L2 Action Review live; event rollback restores versions and issues external updates; confidential external placeholder behaviour verified. Slices 2, 3, and 7 were the load-bearing ones for this gate — **all three are done and verified end-to-end** (commit `49a838cb`).

**All 8 planned Phase 2 slices are now done** (commit `fb1b9be1`). What's left before Phase 2 is fully closed out is the phase's own *operating* exit criteria (spec §18) — not more code: this is a real-beta-usage milestone (event rollback proven under real load, confidential placeholder behavior validated with real external recipients), same category of gate as Phase 1's still-open 30-day beta SLO run. That gate proceeding in parallel with Phase 3 code work is the same pattern Phase 1's own still-open beta gate didn't block Phase 2 from starting.

## Phase 3 — Mail Connect (spec §18 row 3)

Detailed now that Phase 2's actual shape (Policy Engine, Action Review Queue, native events) is known, not speculated. One resequencing vs. the original sketch, explained where it happens below: **Work Graph moved from slice 1 to slice 7** — building it before any real Email data existed would have repeated the exact mistake this whole build has avoided at every other phase boundary (infrastructure before a real consumer needs it).

| # | Slice | Branch | Status | Plan file |
|---|---|---|---|---|
| 1 | Mail token vault + Gmail adapter | `sema/mail-gmail-connection` | done | [sema-p3-s1-mail-token-vault-gmail-adapter.md](./sema-p3-s1-mail-token-vault-gmail-adapter.md) |
| 2 | Gmail read-only sync | `sema/gmail-readonly-sync` | done | [sema-p3-s2-gmail-readonly-sync.md](./sema-p3-s2-gmail-readonly-sync.md) |
| 3 | Outlook Mail read-only sync | `sema/outlook-mail-readonly-sync` | done — real Azure AD/Outlook validated 2026-07-15 | [sema-p3-s3-outlook-mail-readonly-sync.md](./sema-p3-s3-outlook-mail-readonly-sync.md) |
| 4 | Mail rendering/sanitization pipeline | `sema/mail-rendering-pipeline` | in progress | [sema-p3-s4-mail-rendering-pipeline.md](./sema-p3-s4-mail-rendering-pipeline.md) |
| 5 | Unified inbox UI + read-only search | `sema/unified-inbox-search` | planned | [sema-p3-s5-unified-inbox-search.md](./sema-p3-s5-unified-inbox-search.md) |
| 6 | DLP MVP | `sema/dlp-mvp` | planned | [sema-p3-s6-dlp-mvp.md](./sema-p3-s6-dlp-mvp.md) |
| 7 | Work Graph service MVP | `sema/work-graph-mvp` | planned | [sema-p3-s7-work-graph-mvp.md](./sema-p3-s7-work-graph-mvp.md) |
| 8 | AI thread summaries + reply drafts, L1-L2 | `sema/ai-mail-summaries-drafts` | planned | [sema-p3-s8-ai-mail-summaries-drafts.md](./sema-p3-s8-ai-mail-summaries-drafts.md) |
| 9 | Send/reply/forward, delayed-send buffer, L3 | `sema/mail-send-delayed-buffer-l3` | planned | [sema-p3-s9-mail-send-delayed-buffer-l3.md](./sema-p3-s9-mail-send-delayed-buffer-l3.md) |
| 10 | Email-to-meeting/task governed conversions | `sema/email-to-meeting-task-conversion` | planned | [sema-p3-s10-email-to-meeting-task-conversion.md](./sema-p3-s10-email-to-meeting-task-conversion.md) |
| 11 | Google CASA / restricted-scope evidence pack | (paperwork, no branch) | planned — **start alongside slice 1**, not after | [sema-p3-s11-google-casa-verification-prep.md](./sema-p3-s11-google-casa-verification-prep.md) |

**Phase 3 exit gate**: Google restricted-scope requirements satisfied, rendering security audit clean, delayed-send rollback verified, inbox freshness SLO met.

**Pre-slice-3 follow-up (2026-07-15):** `mail_service/service.py`'s full-vs-incremental sync dispatch was refactored from a hardcoded `_INCREMENTAL_PROVIDERS = {"gmail"}` check into a generic, duck-typed check on whichever adapter `get_adapter()` returns — same pattern calendar already used for its two providers. No new abstraction added, no public API/schema change, Gmail's behavior verified unchanged. Detail in slice 2's plan file follow-up note. This means slice 3 (Outlook Mail) can add incremental sync support, if its adapter has it, without touching the shared sync function.

**Provider-connect callback bug fix (2026-07-15):** found while doing slice 3's real validation — `/callback` required `provider` as a query param, but Google/Microsoft's real OAuth redirect never sends one, so every real provider connect was 422ing (a pre-existing bug from Phase 1 slice 6, only caught now because this was the first real-browser test). Fixed by recovering `provider` from the signed `state` token instead. Detail in slice 3's plan file.

## Phase 4 — Shared Inboxes & L4 (spec §18 row 4) — sequencing only

1. Shared/group mailboxes + delegated access model.
2. Assignment + internal notes on shared inbox items.
3. L4 bounded autonomy (calendar + mail) with incident brake.
4. Executive briefing across Work Graph.

**Phase 4 exit gate**: L4 incident-free 60 days on design-partner tenants; audit-ledger export accepted by enterprise compliance reviewer.

## Phase 5 — Hosted Zoiko Mail — entry-gate only, no build plan

Per spec §18 and DR-10, this phase is evaluated against its entry gate, not pre-committed. No slices are planned. See [sema-p5-gate-criteria.md](./sema-p5-gate-criteria.md) for the gate checklist to watch for — do not start Phase 5 build planning until that gate is met.

## Cross-cutting, not its own phase

`plans/zoikotime-workforce-signal-integration.md` (ZoikoTime → Sema workforce signal webhook) is a separate, parallel plan spanning both repos. It feeds Phase 2 slice 6 (Scheduling Engine) and Phase 1 slice 7 (availability stub) but is sequenced and branched independently — see that file directly.
