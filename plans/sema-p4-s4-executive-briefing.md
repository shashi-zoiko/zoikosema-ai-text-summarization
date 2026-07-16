# Phase 4 · Slice 4 — Executive Briefing Across Work Graph

**Branch:** `sema/executive-briefing`, cut from `feature/sema-calendar-mail`
**Status:** planned
**Depends on:** Phase 3 slice 7 (Work Graph), Phase 2 slice 8 (Tasks), Phase 4 slice 2 (mail assignments — "items needing my attention" needs these to exist)
**Spec refs:** §13.1 Phase 4 AI workflow row ("executive briefing across Work Graph"), §374 (AI Orchestration Service "receives only allowed subgraphs")

## Goal

The first AI feature that queries ACROSS node types via the Work Graph rather than one type at a time (every earlier AI feature — agenda, brief, thread summary — reads one calendar event or one thread). A short "what needs my attention" briefing spanning upcoming meetings, open tasks, and mail assigned to me — enriched with each item's real Work Graph provenance (e.g. "this task came from this email"), not three unrelated list calls dressed up as one feature.

## Reuse — don't rebuild

- `core/ai.py::_call_structured_ai` — same shape as every other AI generation function in this build.
- `calendar_service.native_events.list_events` / `calendar_service.tasks.list_tasks` / `mail_service.assignments.list_assignments` (Phase 4 slice 2) — the three real data sources; no new query surface duplicates them.
- `work_graph.query_subgraph` — for each candidate item, a real one-hop traversal supplies its provenance (derived_from/attendee_of neighbors), which is what makes this "across Work Graph" rather than three parallel reads.
- Pure L1 read — nothing is staged or mutated, same governance-free framing `generate_meeting_brief` established for read-only AI features.

## Build new

- `core/ai.py::ai_generate_executive_briefing(context: dict) -> dict` — `{"headline", "priorities": [...], "at_risk_items": [...]}`.
- `app/connect/briefing/service.py::generate_executive_briefing(db, ctx) -> dict` — assembles the cross-graph context (upcoming events + open tasks + assigned-to-me mail, each with its subgraph neighbors) and calls the AI function.
- `GET /briefing/executive`.

## Explicitly out of scope

- Scheduled/recurring auto-delivery (e.g. a daily email digest) — this is an on-demand read, not a notification system; add a delivery mechanism only when a real caller asks for one.
- Org-wide (multi-person) executive briefing — this is "my" briefing, scoped to the requesting user, same scoping precedent `native_events.list_events` already uses for a single user's own view.

## Done when

- Calling the endpoint against a real tenant with a mix of upcoming events, open tasks (some derived from calendar events or mail), and assigned mail items produces a coherent briefing that correctly reflects each item's real Work Graph provenance, verified against real Postgres.
