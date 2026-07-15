# Phase 3 · Slice 10 — Email-to-Meeting/Channel/Task Governed Conversions

**Branch:** `sema/email-to-meeting-task-conversion`, cut from `feature/sema-calendar-mail`
**Status:** planned
**Depends on:** Phase 3 slices 5, 7 (real mail to convert FROM, Work Graph to record the provenance edge)
**Spec refs:** §3.2 (`derived_from` edge), §11 (Mail Connector Service)

## Goal

"Convert this email into a meeting/task/channel message" — a governed, provenance-tracked creation, not a copy-paste convenience.

## Reuse — don't rebuild

- `native_events.create_event()` (Phase 2 slice 3) for email→meeting — same autonomy gating, same L2 staging path, no second event-creation code path.
- `ai_workflows`/`tasks.py` (Phase 2 slice 8) for email→task — same `create_task`, tagging `source_event_id`-equivalent (a `source_message_id` pointer, same "plain pointer now, real Work Graph edge once slice 7 lands" pattern).
- `app/connect/work_graph/` (slice 7) — every conversion writes a real `derived_from` edge (Email→CalendarEvent or Email→Task) at creation time, since Work Graph already exists by this point — no "backfill later" deferral needed here, unlike Phase 2 slice 8's Task edges (which predated Work Graph and had to be backfilled after the fact).

## Explicitly out of scope

- Email→channel-message conversion — depends on the messaging_service's own conventions for cross-posting; smaller and lower-priority than meeting/task, defer until named as needed.

## Done when

- Converting a real synced email into a native calendar event or a task produces the correct object AND a real Work Graph `derived_from` edge pointing back to the source email, verified against real Postgres.
