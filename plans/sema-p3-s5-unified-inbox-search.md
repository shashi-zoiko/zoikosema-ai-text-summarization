# Phase 3 · Slice 5 — Unified Inbox UI + Read-Only Search

**Branch:** `sema/unified-inbox-search`, cut from `feature/sema-calendar-mail`
**Status:** planned
**Depends on:** Phase 3 slices 2-4 (synced messages + safe rendering)
**Spec refs:** §11 (Search Service row), §15.1 (Navigation Placement)

## Goal

The first real client UI Phase 3 needs — unlike every Phase 2 calendar slice (deliberately backend-only), Mail Connect's whole value is visible in an inbox. List + read messages across connected Gmail/Outlook accounts in one view.

## Reuse — don't rebuild

- `client/src/components/Layout.jsx`'s `WORKSPACE_NAV` — add "Mail"/"Inbox" as a persistent sidebar entry, same pattern as slice 2's own "Review Queue" addition (Phase 2 slice 2).
- `mail_service::list_mail_messages` (slice 2/3) for listing; slice 4's render endpoint for reading one message.
- `CalendarIntegrations.jsx`'s connect/disconnect UI pattern — the mail equivalent (`MailIntegrations.jsx` or extend the same page to also show mail providers, since `provider-connections` is already provider-type-agnostic) rather than a third UI for connecting a provider.

## Build new

- `GET /mail/search?q=...` — read-only search over synced metadata (subject/from/snippet) to start; full-text body search is a heavier index (spec's own Search Service is security-trimmed and cross-surface) that can wait for a real usage signal, not built speculatively now.
- Client: an Inbox page (list + reading pane), reusing the design system components already established (`components/ui/Card`, `Badge`, etc., per the precedent set by `ReviewQueue.jsx`).

## Explicitly out of scope

- Send/reply/forward (slice 9) — read-only view only.
- AI summaries in the reading pane (slice 8) — plain rendering first.
- Cross-surface unified search (mail + calendar + messages + files) — spec's eventual Search Service vision; this slice is mail-only search, a narrower and immediately buildable slice of it.

## Done when

- A connected account's messages are browsable and readable (safely rendered per slice 4) in a real client page, reachable from the persistent sidebar.
- Basic metadata search returns correct results against real synced data.
