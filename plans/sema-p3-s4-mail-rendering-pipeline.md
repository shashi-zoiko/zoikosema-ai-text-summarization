# Phase 3 · Slice 4 — Mail Rendering / Sanitization Pipeline

**Branch:** `sema/mail-rendering-pipeline`, cut from `feature/sema-calendar-mail`
**Status:** in progress — backend (body fetch, nh3 sanitize, SSRF-guarded image proxy) and client (MailBodyView, DOMPurify pass) built; wired into a temporary QA surface (`MailPreview.jsx`, not the real inbox); nh3 install + unit tests for sanitize/SSRF logic verified passing. Still open: the plan's actual "Done when" acceptance run (real malicious-HTML test corpus against a live synced message, manually observed in-browser), attachment preview stays out of scope per plan.
**Depends on:** Phase 3 slices 2-3 (synced mail metadata exists to attach body-fetch to)
**Spec refs:** §10.2 (Mail Threat Surface), §19.2 (Security Testing)

## Goal

Fetch and safely render one message's HTML body — sandboxed, sanitized, no script execution, image proxy, strict CSP. Must exist before slice 5's inbox UI ever shows real message content; this is a hard sequencing dependency, not a preference.

## Reuse — don't rebuild

- Nothing existing in this codebase renders untrusted third-party HTML today (chat messages are plain text/Tiptap-authored, not attacker-controlled HTML) — this is genuinely new. Check for an existing HTML-sanitization dependency in `client/package.json` before adding one (a library like DOMPurify is the standard, mature choice here — same "don't hand-roll what a mature library already solves correctly" reasoning as recurrence.py's dateutil choice).

## Build new

- Backend: `GET /mail/messages/{id}/body` fetches the full message body from the provider (Gmail `messages.get(format=full)` / Graph `me/messages/{id}`), stores nothing raw server-side beyond what's needed for re-render (spec's object-storage-references-only pattern, §9.3), returns sanitized-safe HTML or a structured body the client sanitizes.
- Client: sandboxed rendering (iframe with a strict `sandbox` attribute and CSP, or DOMPurify-based sanitization allowlist) + image proxy endpoint (`GET /mail/image-proxy?url=...`) that strips tracking params and never leaks the viewer's real IP to the remote image host.
- Attachment metadata surfaced (filename, size, content-type) without auto-download; a "preview" action is a later slice once malware-scanning integration exists (spec's own Build/Integrate/Defer table lists malware scanning as "Integrate," not built here).

## Explicitly out of scope

- Malware scanning/attachment detonation — spec's own table marks this "Integrate" (a vendor), not something this slice builds.
- Link-reputation rewriting — a Business+/Enterprise tier feature per spec §10.2, not blocking the MVP rendering path.
- Any AI processing of body content (slice 8).

## Done when

- A real HTML email (including a script tag, an external tracking pixel, and an inline `onclick` handler as test-corpus inputs) renders with the script stripped, the tracking pixel proxied, and no inline event handler executable — verified with an actual malicious-HTML test corpus, not just "looks fine on one email," matching spec §19.1's "Malicious HTML, script stripping, remote-image proxy, CSP enforcement" acceptance line item.
