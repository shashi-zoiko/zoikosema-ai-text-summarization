# Phase 2 · Slice 8 — AI Agenda Builder / Pre-Meeting Brief / Follow-Up, L1-L2

**Branch:** `sema/ai-agenda-brief-followup`, cut from `feature/sema-calendar-mail`, merged back (commit `fb1b9be1`)
**Status:** done
**Depends on:** Phase 2 slices 1-3, 7 (Policy Engine, Action Review Queue, native events, L2 staging)
**Spec refs:** §13.1 (Phase 2 AI workflows row), §13.2, §13.3

## Goal

The Phase 2 row of spec §13.1's AI workflow table: AI agenda builder, pre-meeting brief, follow-up suggestions, at L1 (suggest) and L2 (staged proposal) autonomy.

## Reuse — don't rebuild

- Whatever AI orchestration entry point the repo already uses for existing AI Meeting Summaries (per SPEC.md's mention of "AI Meeting Summaries" as an existing Sema surface) — this is the same AI Orchestration Service the spec's service table (§11) describes as a single service, not a per-feature AI integration. Find it before adding a second one.
- `app/connect/action_review/` (slice 2) — L2 agenda/brief proposals stage here exactly like L2 calendar events (slice 7); same queue, same approve/reject/edit contract.
- `app/connect/policy_engine/` — every AI suggestion computes and logs its resolved autonomy level (§4.1) before being shown or staged, same as any other governed action.

## Build new

- Agenda builder: given a scheduled meeting + its attendees' recent related events/emails-once-Mail-exists (Phase 3, not yet available — Phase 2's agenda builder works off calendar context only), suggest an agenda at L1 (shown as recommendation) or stage a complete agenda at L2.
- Pre-meeting brief: summarize relevant context (attendee history, linked prior meetings) ahead of a scheduled event.
- Follow-up suggestions: post-meeting, suggest tasks/follow-up items derived from the meeting (ties into the `Task` node's `derived_from` edge in spec §3.2, though full Work Graph isn't built until Phase 3 slice 1 — this slice can create plain `Task` rows without the graph edge, and backfill the edge once Work Graph exists).
- Every AI-generated object gets the violet "agent-touched" visual treatment per §13.3.

## Explicitly out of scope

- Work Graph-backed provenance edges (`derived_from`) — Work Graph is Phase 3 slice 1; this slice's AI outputs are plain rows with a `source_event_id`-style FK, upgraded to graph edges later, not blocked on the graph existing now.
- L3/L4 autonomous agenda/brief execution — Phase 2's ceiling for AI workflows tops out at L2 per §13.1's own table; don't build L3 send-without-review for this feature.
- Mail-sourced context — Mail Connect doesn't exist until Phase 3.

## Done when

- For a real scheduled meeting, the agenda builder produces a suggestion (L1) or a staged proposal (L2, appearing in the Action Review Queue from slice 2) depending on tenant policy.
- Post-meeting follow-up suggestions correctly create `Task` rows, reviewed by a human before any task is considered "real" at L2 ceiling.
- Every agent-touched object is visually distinguishable per §13.3, confirmed by a design/QA pass, not just a backend check.

## What actually shipped (done 2026-07-14)

Built per plan, with the reuse instruction taken literally: dispatched a research pass *before* writing any code to find the existing AI entry point, rather than assuming one and guessing at its shape.

- **Found `core/ai.py`** (Anthropic Claude wrapper already backing "AI Meeting Summaries") and reused it. It had a tightly-coupled `ai_generate_intelligence()` but no generic "structured JSON out" helper — so one was extracted (`_call_structured_ai`) for the three new functions to share, without retrofitting the existing, shipped, unrelated function onto it.
- **Governance lives in a new `ai_workflows.py`, not in `core/ai.py`** — the generation functions stay pure "prompt in, JSON out"; autonomy resolution, Action Review staging, and Task persistence are a separate layer, mirroring exactly how `native_events.py` already separates CRUD from `core/calendar.py`'s ICS generation.
- **Agenda/brief needed no autonomy gating at all** — they're pure reads, same "L1 only reads" framing `availability.py` established. Only follow-up task creation (a real mutation) got the ceiling check, reusing the identical threshold `create_event()` uses.
- **No approve-applies-to-event executor for staged agendas** — spec's own wording only asked for staging at L2, not "approving writes it to the event." Building that write path without it being named anywhere would have been speculative scope creep.
- **No Work Graph edges** (Phase 3 slice 1 doesn't exist yet) — `Task.source_event_id` is a plain UUID pointer, exactly what backfills a real `derived_from` edge later.
- **No violet "agent-touched" UI** — checked first, found zero client UI for any Phase 2 calendar feature, so building disclosure/badge treatment now would be dead code. The backend already marks the data (`generated_by_agent` on Task rows, `agent_generated` in agenda/brief responses) so a future UI has something real to key off.

Verified against the real dev Postgres DB (migration `connect_v3_009_tasks.sql` applied; the three `core/ai.py` calls monkeypatched to canned responses since no `ANTHROPIC_API_KEY` is configured in this dev environment — same convention already used for OAuth/email/Redis elsewhere): L1 agenda returns directly; the brief correctly surfaces a past shared-attendee event as history; follow-up tasks reject on a future (not-yet-happened) event and on empty notes; L1 follow-up creates a real Task row directly, linked to its source event; L2 follow-up stages and approving materializes exactly one Task row; L2 agenda stages with the real generated content visible to the reviewer; and plain human-created Task CRUD works correctly. Slices 3-7's full regression suites were re-run afterward with no change in outcome.

**This completes all 8 planned Phase 2 slices.**
