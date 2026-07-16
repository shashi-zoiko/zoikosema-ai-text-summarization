# Phase 4 · Slice 1 — Shared/Group Mailboxes + Delegated Access

**Branch:** `sema/shared-mailboxes-delegated-access`, cut from `feature/sema-calendar-mail`
**Status:** planned
**Depends on:** Phase 3 slices 1-3 (provider connections + mail sync), Phase 3 slice 7 (Work Graph)
**Spec refs:** §1.1 (scope: "Shared mailboxes and delegated access where they reinforce collaboration and governance"), §10.1 ("Delegated access is represented as graph edges and audit events, not hidden provider-only state")

## Goal

A shared/group mailbox (e.g. `support@company.com`) is just a `connect_provider_connections` row like any other — connected once by whoever set it up (the "owner"). This slice adds a real, revocable grant so OTHER tenant members can read that mailbox's synced mail too, with the grant itself visible as a Work Graph edge and an audit trail, not hidden provider-side state.

## Reuse — don't rebuild

- `connect_provider_connections` IS the shared mailbox — no new "mailbox" entity duplicates it. A shared mailbox is simply a connection whose delegate list has more than its owner.
- `app/connect/work_graph/` (Phase 3 slice 7) — every grant/revoke also writes a `delegated_access` edge (Person -> Mailbox) for graph-level visibility, per spec §10.1's explicit wording. The edge is a durable, append-only VISIBILITY record (a grant once existed) — it is NOT the authorization source of truth, since Work Graph edges can't be deleted/revoked in place (see native_events' own append-only precedent). The real access decision reads `connect_mailbox_delegates.status`.
- `mail_service.list_mail_messages` / `search_messages` / `get_message_body` (Phase 3 slices 2-5) — extended to scope by "accessible provider_connection_ids" (owned + actively-delegated) instead of strict `user_id == ctx.user_id`, so a delegate's inbox actually shows the shared mailbox's mail. This is the one existing-file change this slice makes — without it, "shared mailbox" would have no real reading effect, a half-built feature.

## Build new

- `connect_v3_017_mailbox_delegates.sql` — `connect_mailbox_delegates` (id, tenant_id, provider_connection_id, delegate_user_id, granted_by_user_id, status: active|revoked, correlation_id, timestamps). Ordinary mutable table (touch trigger), not append-only — a grant is actually revocable, that's the point.
- A migration extending `connect_work_graph_edges`' CHECK constraints with node_type `mailbox` and edge_type `delegated_access` (same ALTER-in-a-new-migration pattern `connect_v3_016_policy_versions_mail_category.sql` established, not editing `connect_v3_014` in place).
- `app/connect/shared_mailboxes/` (new bounded module): `models.py`, `service.py` (`grant_delegate_access`, `revoke_delegate_access`, `list_delegates`, `accessible_connection_ids` — the helper mail_service now calls), `api.py`.
- `work_graph/service.py` gets a `_resolve_mailbox` resolver so `mailbox` subgraph queries work like every other node type.

## Explicitly out of scope

- Sending FROM a shared mailbox as a delegate (slice 9's send path stays owner-only) — a real, disclosed gap; wiring delegate-send would touch L3 governance and isn't asked for by this slice's own scope ("collaboration and governance" for reading/triage, not send authority).
- Per-folder/per-label granular delegation (e.g. "delegate can see Inbox but not Sent") — one grant = full read access to that connection's synced mail, matching this slice's own MVP framing.

## Done when

- Granting delegate access lets a second tenant member see a shared mailbox's synced messages in their own Inbox (list, search, and read a message body); revoking removes that access immediately.
- The grant is visible as a real Work Graph edge AND a real audit-log entry, not just a row in a table only this feature reads.
