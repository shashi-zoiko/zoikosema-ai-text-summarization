# Two-Dev Work Split — Sema Calendar & Mail

Status snapshot and task division for two full-stack developers working `feature/sema-calendar-mail` in parallel. Source of truth for phase/slice status is [`sema-roadmap.md`](./sema-roadmap.md) — this file only adds *who does what next*, it doesn't repeat slice detail.

**This file is a dev-machine planning doc (see `.gitignore`'s `plans/` rule). It's being pushed to this branch temporarily so both devs can see it — delete it (and the rest of `plans/`) before `feature/sema-calendar-mail` merges to `main`.**

## 1. Native calendar status — already built

Native Sema Calendar is **Phase 2** of the roadmap. All 8 planned slices are done (commit `fb1b9be1`):

1. Policy Engine MVP — done
2. Action Review Queue MVP — done
3. Native CalendarEvent CRUD + version chain — done
4. Recurring events (RRULE/DST/timezone) — done
5. Team / resource / roster calendars — done
6. Scheduling Engine constraint solver — done
7. L2 event staging + confidential external placeholder — done
8. AI agenda builder / brief / follow-up — done

**Nothing left to build for native calendar.** What's still open is the Phase 2 *exit gate* — an operating criterion (L2 Action Review proven live, event rollback proven under real load, confidential placeholder validated with real external recipients over real beta usage), not a code slice. That gate clears through beta usage, same category as Phase 1's still-open 30-day SLO run. It doesn't block Phase 3 code work, and no dev task is needed to "finish" it beyond normal bug-fixing if beta usage surfaces issues.

So: if the ask was "build native calendar before anything else" — it's already done. The next real code work is Phase 3 (Mail Connect), slice 4 onward.

## 2. What's actually left (all phases)

| Phase | Slices remaining | Nature |
|---|---|---|
| Phase 3 — Mail Connect | 4–11 (of 11) | Real code, detailed plan files exist |
| Phase 4 — Shared Inboxes & L4 | sequencing only, no slice plans yet | Not detailed — plan when Phase 3 is closer to done |
| Phase 5 — Hosted Zoiko Mail | entry-gate only | Not a build phase yet — watch the gate criteria, don't plan code |

Phase 3 is where both devs' near-term work lives.

## 3. Dependency shape (why the split below)

- Slice 4 (mail rendering/sanitization pipeline) is the pivot: slice 5 (unified inbox UI) and slice 6 (DLP MVP) both need rendered/sanitized content to work against. Slice 8 (AI summaries/drafts) needs slice 5's UI surface too.
- Slice 7 (Work Graph MVP) has no dependency on slice 4 — it's the resequenced piece (moved from slice 1 originally, see roadmap note) and can run fully in parallel.
- Slice 9 (send/reply/delayed-send, L3) needs the Policy Engine (already done, Phase 2) and doesn't need Work Graph or rendering — can start any time, but shares governance surface with slice 6/10, so sequence it after whichever of those lands first to avoid review-queue schema churn.
- Slice 10 (email-to-meeting/task conversion) needs Work Graph (slice 7) as its data model.
- Slice 11 (Google CASA / restricted-scope evidence pack) is paperwork, not code — roadmap already flags it should've started "alongside slice 1." It's overdue. Low engineering effort, mostly product/compliance liaison — whoever has spare cycles should pick this up now, independent of the branch split below.

## 4. The split

**Dev A — Mail pipeline & surface (critical path)**
1. Slice 4 — Mail rendering/sanitization pipeline (`sema/mail-rendering-pipeline`)
2. Slice 5 — Unified inbox UI + read-only search (`sema/unified-inbox-search`)
3. Slice 8 — AI thread summaries + reply drafts, L1-L2 (`sema/ai-mail-summaries-drafts`)

**Dev B — Governance & structure (parallel track)**
1. Slice 7 — Work Graph service MVP (`sema/work-graph-mvp`) — start immediately, no dependency on Dev A's slice 4
2. Slice 6 — DLP MVP (`sema/dlp-mvp`) — start once Dev A's slice 4 lands (needs rendered content to scan)
3. Slice 10 — Email-to-meeting/task governed conversions (`sema/email-to-meeting-task-conversion`) — needs own slice 7 done
4. Slice 9 — Send/reply/forward, delayed-send buffer, L3 (`sema/mail-send-delayed-buffer-l3`) — fits here once 6/10 stable, or swap to Dev A if Dev B is still on 10

Slice 11 (CASA paperwork) — assign to whichever dev has slack in week 1; it runs alongside everything else and blocks nothing except the Phase 3 exit gate itself.

## 5. Branching rule adaptation for two devs

`sema-roadmap.md`'s working rule is "one slice, one branch, merged back before the next slice starts" — written for a single-dev cadence. With two devs working simultaneously:

- Both Dev A's and Dev B's *current* slice branches may be cut from `feature/sema-calendar-mail`'s tip at the same time, since Track A (mail pipeline/UI) and Track B (Work Graph/DLP/governance) touch different code areas.
- Whoever finishes first merges via PR first; the other rebases onto the new tip before merging.
- Do **not** open a second slice branch within the same track until that track's current slice is merged (the original one-slice-one-branch rule still holds *per track*).
- If a slice's plan file reveals unexpected overlap with the other track's files, stop and resequence rather than merging through a conflict.

## 6. Before merging `feature/sema-calendar-mail` to `main`

Delete `plans/` from this branch (it's gitignored on `main` on purpose — dev-machine-local docs, not shipped). This file included.
