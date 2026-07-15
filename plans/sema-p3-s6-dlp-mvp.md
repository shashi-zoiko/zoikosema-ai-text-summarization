# Phase 3 · Slice 6 — DLP MVP

**Branch:** `sema/dlp-mvp`, cut from `feature/sema-calendar-mail`
**Status:** planned
**Depends on:** Phase 3 slice 5 (something to scan); Phase 2 slice 1 (Policy Engine's stubbed DLP input)
**Spec refs:** §4.1 (`dlp_verdict` autonomy input), §10.2 (Outbound leakage)

## Goal

Outbound preflight scanning — the first real consumer of Policy Engine's `dlp_verdict` input, which Phase 2 slice 1 explicitly stubbed as always-pass ("no feature exists yet to produce a real verdict"). This slice is that feature.

## Reuse — don't rebuild

- `app/connect/policy_engine/service.py::resolve_effective_autonomy` — replace the `dlp_verdict` entry in `_UNIMPLEMENTED_INPUTS` with a real call into this slice's scanner, for the "mail" category once it exists (Policy Engine's `CATEGORIES` tuple currently only has `"calendar"` — extend it here, since this is the first real mail-category policy consumer, matching the tuple's own comment: `"mail" joins in Phase 3 — see migration CHECK constraint, which must be extended alongside this tuple when that lands`).
- Same audit/event pattern every governed check in this codebase already uses (`policy.evaluated`-style audit row per scan, no outbox event — matching Policy Engine slice 1's own "no reader yet" reasoning for skipping per-evaluation fanout).

## Build new

- A DLP MVP classifier: rule-based pattern matching (SSNs, credit card numbers, common secret-key formats, configurable keyword lists) — NOT an ML classifier; spec's own MVP framing and the "Build/Integrate/Defer" table don't mandate a trained model, and building one now with no labeled data would be premature. A structured, extensible rule engine that a later slice can swap for a real ML/vendor DLP product without changing callers.
- `check_outbound_dlp(db, ctx, *, body_text, attachments=None) -> DlpVerdict` (pass/warn/fail + matched-rule explanations, mirroring `resolve_effective_autonomy`'s "log the resolved inputs" discipline).
- Wire into the mail-send path (slice 9) as a hard preflight gate — spec §10.2: "DLP unavailability fails closed for governed sends." A DLP scan that errors must block the send, not silently allow it.

## Explicitly out of scope

- Any ML-based content classification — rule-based only for MVP, explicitly.
- DLP for calendar content (spec scopes DLP to mail sends; calendar's own confidentiality mechanism, Phase 2 slice 7, is a different control).

## Done when

- A test corpus of known-sensitive patterns (SSN-shaped strings, common secret-key prefixes, a configured keyword) are correctly flagged; benign text passes clean.
- Policy Engine's `resolve_effective_autonomy(category="mail")` reflects a real `dlp_verdict` input instead of the always-4 stub, verified end-to-end.
