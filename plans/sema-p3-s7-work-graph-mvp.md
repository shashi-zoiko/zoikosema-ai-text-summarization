# Phase 3 · Slice 7 — Work Graph Service MVP

**Branch:** `sema/work-graph-mvp`, cut from `feature/sema-calendar-mail`
**Status:** planned
**Depends on:** Phase 3 slices 2-6 (real Email/mail data exists to have a graph over)
**Spec refs:** §3 (Work Graph), §3.1 (node types), §3.2 (edges), §3.3 (query/access rules)

## Sequencing note — this moved

The original Phase 3 sequencing sketch put Work Graph FIRST (slice 1), reasoning that mail needed "a policy-filtered query layer over Email nodes." Building it before slice 2-6 landed real Email data would have meant designing a graph with nothing real to query — exactly the doctrine test violation (§1.3) this whole build has avoided at every other phase boundary (Policy Engine and Action Review Queue in Phase 2 were sequenced the same way: built when Phase 2's OWN first real mutation needed them, not speculatively ahead of it). Moved here, right before slice 8 (AI mail workflows) — the first genuinely real consumer that needs a policy-filtered subgraph (spec §13.2: "Agents receive only the policy-filtered subgraph needed for the declared task").

## Goal

A minimal typed graph over what already exists by this point: `Person` (maps to `User`/`OrganizationMember`, per CONTEXT.md §1's precedent), `Email` (connect_mail_messages), `CalendarEvent` (connect_native_calendar_events), `Task` (connect_tasks, Phase 2 slice 8) — with the edges spec §3.2 names between them, and a policy-filtered query entry point.

## Reuse — don't rebuild

- Every node type's UNDERLYING data already exists in its own table (`connect_mail_messages`, `connect_native_calendar_events`, `connect_tasks`, `users`/`organization_members`) — Work Graph does NOT duplicate this data into a graph-native store. It's a typed QUERY LAYER (edges table + a resolver that joins back to the real tables), not a second copy of the data. This is the single most important scope-limiting decision in this slice.
- `app/connect/policy_engine/` — every graph query is policy-filtered before reaching a caller (spec §3.3), reusing `resolve_effective_autonomy`-style resolution, not a second filtering mechanism.

## Build new

- `connect_work_graph_edges` table: `id, tenant_id, edge_type, from_node_type, from_node_id, to_node_type, to_node_id, created_at`. Minimal edge set for MVP: `sent_by` (Email→Person), `attendee_of` (Person→CalendarEvent), `derived_from` (Task→Email or Task→CalendarEvent — this is what backfills Phase 2 slice 8's `Task.source_event_id` pointer into a real edge, per that slice's own stated intent).
- `app/connect/work_graph/service.py::query_subgraph(db, ctx, *, node_type, node_id, edge_types=None) -> dict` — policy-filtered traversal, returning only nodes/edges the resolved autonomy/policy context admits (spec §3.3: "policy-excluded content appears only to principals and services admitted by the active policy version").
- A backfill script/function that walks existing `Task.source_event_id` pointers and creates the corresponding `derived_from` edges — the "small follow-up, not a redesign" Phase 2 slice 8 explicitly promised.

## Explicitly out of scope

- A general-purpose graph database or query language (Cypher-like DSL, etc.) — spec doesn't ask for one, and this codebase's actual query needs (a handful of edge types, shallow traversal) don't justify that infrastructure. A plain SQL edges table with a thin resolver is the right size.
- Any node type beyond the four listed — `Organisation`, `Message` (chat), `AISummary`, `File`, `AgentAction`, `PolicyVersion` all exist in spec's full node table (§3.1) but have no real consumer needing graph traversal yet; add each when its own real consumer arrives, same discipline as everything else in this build.

## Done when

- Querying the subgraph around a real synced Email node returns its `sent_by` Person and any `derived_from` Tasks, correctly policy-filtered for the requesting context.
- The Phase 2 slice 8 backfill runs against real Task rows and produces correct edges, verified against real Postgres.
