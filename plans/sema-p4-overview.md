# Phase 4 — Shared Inboxes & L4: Sequencing Overview (not yet slice-detailed)

Not slice-detailed yet — depends entirely on how Phase 3's Mail Connector and DLP land. See [sema-roadmap.md](./sema-roadmap.md) for phase index.

**Spec refs:** §18 Phase 4 row, §13.1 (Phase 4 AI workflows row)

## Sequencing intent (4 anticipated slices)

1. **Shared/group mailboxes + delegated access model** — represented as graph edges and audit events per §10.1 ("Delegated access is represented as graph edges and audit events, not hidden provider-only state"), reusing Phase 3 slice 1's Work Graph.
2. **Assignment + internal notes on shared inbox items** — explicitly bounded by spec §1.2's non-goal: assignment/shared-inbox primitives are allowed, ticketing/SLA productisation is not. Any slice plan here must re-check that line before scoping.
3. **L4 bounded autonomy (calendar + mail)** — first L4 feature in the build; requires the incident-brake control (§4.1's autonomy input list, previously stubbed always-pass in Phase 2 slice 1) to have a real implementation before this slice ships, since L4 is "continuous monitoring, incident brake, and admin controls required" (§4 table) — not optional at this level like it was at L1-L3.
4. **Executive briefing across Work Graph** — the first cross-category AI feature that queries the full graph rather than one node type at a time.

## Phase 4 exit gate (spec §18)

L4 incident-free for 60 days on design-partner tenants; audit-ledger export accepted by an enterprise compliance reviewer.

## Do not start until

Phase 3 exit gate met, and specifically: DLP MVP (Phase 3 slice 7) has real production usage data to tune the incident-brake thresholds slice 3 needs — building L4's incident brake against zero real DLP signal would be guessing at thresholds, not engineering them.
