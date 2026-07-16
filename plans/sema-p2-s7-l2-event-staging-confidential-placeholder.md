# Phase 2 · Slice 7 — L2 Event Staging + Confidential External Placeholder

**Branch:** `sema/l2-event-staging-confidential-placeholder`, cut from `feature/sema-calendar-mail`, merged back (commit `49a838cb`)
**Status:** done
**Depends on:** Phase 2 slices 2-3 (Action Review Queue, native CalendarEvent CRUD)
**Spec refs:** §4 (L2 row), §9.2, §18 Phase 2 exit gate ("confidential external placeholder behaviour verified")

## Goal

This is the slice the Phase 2 exit gate actually names: L2 Action Review must be "live" (not just built, exercised) and confidential external placeholder behavior must be verified. Slice 3 already wired L2 ceiling into staging vs. direct-create; this slice makes it a real, testable end-to-end path plus the confidentiality-specific UI/data rule.

## Reuse — don't rebuild

- `app/connect/action_review/` (slice 2) — the L2 staging path already exists structurally from slice 3; this slice is the first one to actually drive an event proposal through approve/reject/edit against a live Action Review Queue UI, not synthetic data.
- Spec §9's Cryptographically-Inaccessible vs Policy-Excluded distinction — already a hard rule for messaging/mail; this slice applies the *same* distinction to calendar confidentiality, it does not invent a third category.

## Build new

- `confidentiality_class` field (already on the model per slice 3's schema) gets real enforcement: a confidential event's title/details are replaced with a placeholder string in any outbound iTIP/iMIP invite to external (non-Sema) attendees, per §9.2 "Confidential external calendar invites must use placeholder titles externally."
- UI disclosure: the composer must show that protocol metadata (time, organiser, attendee routing) still leaves Sema even when the title is placeheld — a copy/UX requirement, not just a backend one (§9.2, §15.2's icon-distinctness rule for Policy-Protected vs cryptographic Confidential Mode).
- End-to-end L2 flow: user proposes a confidential event with an external attendee → staged in Action Review Queue with the real placeholder-title payload visible to the reviewer → approve → placeholder-titled iMIP sent externally, full-titled version retained internally.

## Explicitly out of scope

- Cryptographic (E2EE) confidential calendar — spec §9.1 scopes "cryptographically inaccessible" to channels/DMs/confidential meetings and defers Zoiko-to-Zoiko internal mail to Phase 5; native calendar confidentiality here is policy-excluded, never labeled E2EE (§9.2 hard rule — copy review needed before merge).
- Any Mail equivalent (Mail Connect confidentiality is Phase 3).

## Done when

- A confidential event with an external attendee, staged and approved through the Action Review Queue, produces an iMIP invite with a placeholder title to the external party and the real title internally — verified end-to-end, not just at the data-model level.
- QA copy review confirms no UI text implies the placeholder is end-to-end encryption (this is the exact overclaim spec §9.2/§20's risk register calls out as Critical severity).

## What actually shipped (done 2026-07-14)

Built as planned, with one scope check that changed nothing: I looked for existing client-side native-event UI before writing any "composer disclosure" copy and found none — no native-event composer exists anywhere in this codebase (all of Phase 2 has been backend-only). Building disclosure copy for a UI surface that doesn't exist would be dead code with no consumer to exercise it; that requirement is deferred to whichever slice ships the first real composer, not skipped.

What was actually built:
- `_is_external_attendee()`: an attendee is external unless they're a registered User in the event's own organisation. A personal (no-org) tenant has no teammates by definition, so every attendee there is external — a small but real edge case worth getting right, since a solo user's every invite would otherwise silently never redact.
- The placeholder applies to the email **subject line**, not just the `.ics` body — the subject is the most visible leak vector (inbox previews, notification banners), and redacting only the calendar attachment while leaving the real title in the subject would have been an easy, embarrassing miss.
- Kept this redaction path deliberately separate from `team_calendar.py`'s own "Busy" redaction (slice 5) — different audience, different placeholder text, different fields redacted. Forcing them into one shared function would have been the wrong kind of reuse; DRY applies to duplicated *logic*, not to two genuinely different outputs that happen to key off the same field.
- The placeholder copy was written with the "never claim encryption" rule already in mind, and a copy-review assertion (checking for "encrypt"/"end-to-end" substrings) is part of the verification itself, not a manual eyeball check that could be forgotten next time this text changes.

Verified against the real dev Postgres DB: a confidential event with mixed internal/external attendees shows the real title to the DB row and the internal teammate, a placeholder to the external attendee (subject and `.ics` both); a non-confidential event correctly shows the real title externally too (confirms no over-redaction); and the exact exit-gate scenario — ceiling raised to L2, confidential event with an external attendee staged (real title visible to the reviewer), approved, materialized, and notified, with the external attendee still only ever seeing the placeholder. Slices 3-6's full regression suites were re-run afterward with no change in outcome.

**This closes out Phase 2's exit gate** (spec §18: L2 Action Review live, event rollback verified, confidential placeholder verified) — all three load-bearing pieces (slices 2, 3, 7) are now done and verified end-to-end.
