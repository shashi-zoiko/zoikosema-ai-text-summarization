# Phase 3 · Slice 9 — Send/Reply/Forward with Delayed-Send Buffer, L3 Execute

**Branch:** `sema/mail-send-delayed-buffer-l3`, cut from `feature/sema-calendar-mail`
**Status:** planned
**Depends on:** Phase 3 slices 1, 6, 8 (send-scope OAuth, DLP, drafts to send)
**Spec refs:** §4 (L3 row), §5.2 (rollback: cancel buffered send), §5.3 (Delayed-Send Buffer)

## Goal

The first L3 feature in the whole build. Everything through Phase 2 and Phase 3 slice 8 has topped out at L2 (stage, human approves, something else executes). This slice adds L3: the agent (or a human, at lower autonomy) sends, but within a cancellable delay window — spec's "honest" rollback for external email (§5.2: "Cancelable only while delayed-send buffer has not expired. No false recall after provider delivery").

## Reuse — don't rebuild

- `app/connect/action_review/models.py::ROLLBACK_DESCRIPTORS` already has `"cancel_buffered_send"` defined (Phase 2 slice 2) with NO executor built for it yet — this is that executor, the first real implementation of a contract slice 2 anticipated two phases ago.
- OAuth scope widening: slice 1's Gmail/Outlook adapters requested read-only scopes; sending requires `gmail.send`/`Mail.Send`, which per spec §7.3 re-triggers Google verification review — this is a real, external, non-code dependency to track (same category as slice 11's CASA paperwork), not just a config flag flip.
- DLP (slice 6) as a hard preflight gate, re-run again at buffer-expiry if the draft changed after staging (spec §13.2: "DLP-scanned before queueing and again before release from delayed-send buffer if the draft changed").

## Build new

- Buffer mechanics: default 5 minutes, admin-configurable 0-30 minutes (spec §5.3) — a `connect_mail_sends` table (`id, tenant_id, draft_payload, scheduled_release_at, status: buffered|cancelled|released|failed`) with a background dispatcher (matching the outbox dispatcher's own "separate process reads pending rows" shape, `events/outbox.py`'s established pattern) that releases (actually sends via the provider API) once `scheduled_release_at` passes, unless cancelled first.
- `mail.send.buffered.v1` / `mail.send.cancelled.v1` / `mail.send.released.v1` events — spec §12.2 already names these canonical event types; add them to `events/types.py` now that there's a real producer.
- `POST /mail/sends/{id}/cancel` — the actual "cancel_buffered_send" rollback executor, callable up until `scheduled_release_at`.

## Explicitly out of scope

- Zero-buffer send even for allowlisted domains (spec allows tenant policy to permit it) — a policy refinement for later; MVP always uses the buffer.
- L4 (fully autonomous send within bounds) — spec's own table places L4 in Phase 4, not here.

## Done when

- A drafted, DLP-clean reply sent at L3 is held for the buffer window, is cancellable during that window (verified: cancel before expiry stops delivery), and is actually delivered (or, without real send-scope credentials yet, verified against a mocked provider send call) once the window passes uncancelled.
- A cancellation attempt AFTER the buffer has expired is correctly rejected — spec's hard rule that expiry is irreversible for external recipients.
