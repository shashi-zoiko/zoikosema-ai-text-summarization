# Phase 3 · Slice 8 — AI Thread Summaries + Reply Drafts, L1-L2

**Branch:** `sema/ai-mail-summaries-drafts`, cut from `feature/sema-calendar-mail`
**Status:** planned
**Depends on:** Phase 3 slices 5-7 (real mail content, Work Graph)
**Spec refs:** §13.1 (Phase 3 AI workflows row), §13.2

## Goal

Mail's equivalent of Phase 2 slice 8 — same AI entry point, same governance wiring, applied to threads instead of calendar events.

## Reuse — don't rebuild

- `core/ai.py::_call_structured_ai` (Phase 2 slice 8) — new `ai_summarize_thread`/`ai_draft_reply` functions follow the exact same shape (system+user prompt, JSON schema, shared helper) as `ai_generate_agenda`/`ai_generate_meeting_brief`.
- `app/connect/action_review/` — reply drafts stage at L2 exactly like Phase 2 slice 7's confidential calendar events and slice 8's follow-up tasks; same queue, same approve/reject/edit contract, no new review surface.
- `app/connect/work_graph/` (slice 7) — a reply draft's context assembly pulls the policy-filtered subgraph around the thread (prior messages, linked calendar events/tasks) rather than a bespoke context-gathering query.
- `app/connect/policy_engine/` — same autonomy-gating pattern as every prior AI feature: summarization is a pure read (no gating, matching Phase 2 slice 8's brief/agenda precedent), draft-and-stage is the one mutation-adjacent action needing the ceiling check.

## Build new

- `ai_summarize_thread(messages) -> dict` / `ai_draft_reply(thread_context, instruction) -> dict` in `core/ai.py`.
- `mail_service` (or a new `mail_ai.py`, mirroring `calendar_service/ai_workflows.py`'s separation from `native_events.py`) wiring: summarize is L1 (direct return), draft-a-reply stages at L2 (Action Review Queue, `mail.draft.prepared` event per spec §12.2's canonical event table — first real use of that event name).
- DLP preflight (slice 6) on every agent-composed draft BEFORE it's staged, per spec §13.2: "Agent-composed mail is DLP-scanned before queueing."

## Explicitly out of scope

- Actual send (slice 9) — a draft is staged/reviewed here, never sent from this slice.
- L3 autonomous send-without-review — spec's Phase 3 AI table caps this feature at L2.

## Done when

- A real synced thread produces a coherent summary (L1, no governance needed) and, separately, a drafted reply that DLP-scans clean and stages in the Action Review Queue (L2) with the real draft content visible to the reviewer — same "reviewer sees the truth, only the outbound copy is ever altered" pattern Phase 2 slice 7 established for confidential calendar events.
