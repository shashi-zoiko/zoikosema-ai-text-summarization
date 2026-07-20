# Phase 4 · Slice 2 — Assignment + Internal Notes on Mail Items

**Branch:** `sema/mail-assignment-internal-notes`, cut from `feature/sema-calendar-mail`
**Status:** planned
**Depends on:** Phase 4 slice 1 (a shared mailbox is the real case this matters for, though it works on any synced message)
**Spec refs:** §1.2 explicit non-goal ("Sema shall not become a helpdesk, CRM, billing inbox product... Assignment and shared inbox primitives are allowed; ticketing/SLA productisation is not.")

## Goal

"Assign this email to a teammate, leave an internal note" — the collaboration primitive spec explicitly allows, stopping well short of a ticketing system.

## Reuse — don't rebuild

- `MailMessage` (Phase 3 slice 2/3) — assignment/notes reference an existing synced message by id; no new message concept.
- `app/connect/shared_mailboxes/accessible_connection_ids` (slice 1) — the same "can this user see this message" check gates who can assign/note it.
- Same audit-log-per-mutation discipline every other governed write in this codebase already follows.

## Build new

- `connect_v3_019_mail_assignments.sql` — `connect_mail_assignments` (id, tenant_id, message_id, assigned_to_user_id, assigned_by_user_id, status: open|done, timestamps). One current assignment per message (upsert on reassign), ordinary mutable table.
- `connect_v3_020_mail_notes.sql` — `connect_mail_notes` (id, tenant_id, message_id, author_user_id, body, created_at). Append-only (a note, once written, is never edited/deleted — same discipline as the audit ledger; a correction is a new note, not an edit).
- `app/connect/mail_service/assignments.py` — `assign_message`, `update_assignment_status`, `list_assignments`, `add_note`, `list_notes`.
- New event types: `mail.assignment.created.v1`, `mail.assignment.status_changed.v1`, `mail.note.added.v1`.

## Explicitly out of scope — the non-goal line, re-checked

- No due dates, SLA timers, priority levels, or auto-escalation — status is exactly `open`/`done`, nothing richer. Spec's own line is the test: if a field would only make sense on a support ticket, it doesn't belong here.
- No customer-facing reply-from-note (a note is internal-only by construction — there is no code path that could accidentally include one in an outbound send).
- No notification/mention system for assignment — a real, disclosed gap; add if a real caller needs "assignee gets pinged," not speculatively now.

## Done when

- Assigning a message to a teammate and leaving a note both work end-to-end, respect the same mailbox-access check reading does, and are queryable ("my assigned items", "notes on this message") against real Postgres.
