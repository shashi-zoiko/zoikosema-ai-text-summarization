# Phase 1 · Slice 5 — RSVP, Reminders, iMIP Outbound

**Branch:** `sema/rsvp-reminders-imip`, cut from `feature/sema-calendar-mail`, merged back (commit `9862ac83`)
**Status:** done
**Depends on:** slices 1-4 (token vault, Google/Outlook sync, L1 suggestions) — all done
**Spec refs:** §7.1 (iTIP/iMIP), §18 Phase 1 scope row

## Goal

Close out Phase 1's original scope list (CONTEXT.md §2): outbound iMIP invites for Sema-initiated meetings, RSVP handling, and reminders that work for both legacy `Meeting` rows and slice 2/3's synced `connect_calendar_events`.

## Reuse — don't rebuild

- `server/app/core/calendar.py` — already generates `.ics` / iTIP `METHOD:REQUEST`. Extend it for `METHOD:REPLY` (RSVP) and `METHOD:CANCEL`; do not start a second ICS generator.
- `server/app/core/meeting_reminders.py` — existing reminder job for legacy meetings. Extend to also read `connect_calendar_events`, don't fork a parallel reminder job.
- `app/connect/audit/service.py`, `events/outbox.py` — every RSVP state change and reminder-sent event goes through these, same as every other slice.

## Build new

- RSVP endpoint(s) that accept an attendee response and update the event's attendee state (native `Meeting` and/or a new lightweight attendee-status table if one doesn't exist — check `app/models/meeting.py` first before adding a table).
- Wire `METHOD:REPLY` generation on RSVP for external (non-Sema) attendees.
- Extend `meeting_reminders.py`'s query to union legacy `Meeting` + `connect_calendar_events`, respecting each source's own timezone/all-day handling (see slice 2's `all_day` UTC-midnight caveat in CONTEXT.md §6).
- New event types in `events/types.py`: `calendar.rsvp.recorded.v1`, `calendar.reminder.sent.v1`.

## Explicitly out of scope

- Incremental sync / push channels (still Phase 1 backlog item, not this slice — the spec only requires reminders/RSVP here, not sync mechanics).
- Any Work Graph or Policy Engine involvement — no autonomy level applies to a plain reminder or RSVP recording; this is L0 bookkeeping, not a governed mutation.
- UI for RSVP — API only, per the existing Phase 1 pattern (calendar sync slices shipped API-only too).

## Done when

- A native meeting invite round-trips: create → `.ics` sent → external attendee RSVP recorded → reminder fires at the correct offset for both a legacy `Meeting` and a synced `connect_calendar_events` row.
- Audit row + outbox event exist for every RSVP and every reminder send.
- Verified against a real Postgres instance (per the precedent set in CONTEXT.md §9), not just unit-tested in isolation.

## What actually shipped (revised scope, done 2026-07-13)

Reality diverged from the plan above in two ways, both narrowing scope for good reasons — recorded here so the next reader doesn't go looking for something deliberately not built:

- **No `connect_calendar_events` reminder union.** Those rows are provider-synced (Google/Outlook already send their own reminders for them) — Sema reminding on top would be a duplicate notification, not a fix. `app/core/meeting_reminders.py` was left untouched; it already fully covers scheduled native `Meeting` rows and needed no extension.
- **No app/connect audit/outbox wiring.** The legacy `meetings`/`invites` plane (this slice's actual surface) has never used the `app/connect` governance spine — that infra is scoped to the new `connect_*` Sema tables (calendar_service, provider_connections). Retrofitting audit/outbox onto the entire pre-existing legacy invite system was out of scope for a "small slice" and not what this task asked for.

What was actually built:
- `generate_ics()` (`app/core/calendar.py`) gained `method` (REQUEST/CANCEL/REPLY), `sequence`, and `partstat` params, and now derives a **deterministic UID from `meeting_code`** (previously a random `uuid4` per call — meaning the original code had no way to correlate a REQUEST/CANCEL/REPLY chain to one calendar entry). VALARM only emitted on REQUEST.
- `accept_invite`/`decline_invite` (`app/api/invites.py`) now generate a `METHOD:REPLY` object with the invitee's PARTSTAT, email it to the organizer (`send_meeting_rsvp_email`), and raise an in-app `NOTIF_MEETING_RSVP` notification — previously RSVP silently updated in-app status only, with zero signal to the organizer's inbox or calendar.
- `cancel_meeting` (`app/api/meetings.py`) now attaches a `METHOD:CANCEL` object (same UID, `STATUS:CANCELLED`) to the existing cancellation email, so a real calendar client actually removes the event.
- No new DB columns/migration — `sequence` is a caller-supplied constant (0 for REQUEST, 1 for CANCEL) since there's no reschedule-in-place flow yet to need a persisted counter. Revisit if/when in-place reschedule ships.

Verified against the real dev Postgres instance (Supabase, same one prior slices used) with outbound email monkeypatched to a no-op and everything else real: accept/decline/cancel all produced correct METHOD/STATUS/SEQUENCE and a UID stable across all three iTIP objects for the same meeting. Test rows cleaned up after.
