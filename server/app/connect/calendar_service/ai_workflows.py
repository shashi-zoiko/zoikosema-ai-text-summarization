"""AI agenda builder / pre-meeting brief / follow-up tasks — Phase 2 slice 8,
spec §13.1's Phase 2 AI workflow row.

Governance wiring lives here, not in core/ai.py: this module resolves
autonomy (Policy Engine, slice 1), stages L2 proposals (Action Review
Queue, slice 2), and persists Task rows (this slice) or events (slice 3).
core/ai.py's three new generation functions are pure "call Claude, get
structured JSON back" — no DB, no policy, so they can't leak governance
decisions into the wrong layer.

Autonomy gating only applies where something is actually mutated:
- Agenda and brief are pure suggestions — nothing is written, so neither
  needs autonomy gating at all (matches availability.py's own "L1... only
  reads" framing). Agenda staging at L2 is the one exception spec's own
  wording calls for ("stage a complete agenda... at L2") — see
  generate_agenda's docstring for the deliberately narrow scope that gets.
- Follow-up task creation IS a mutation (a new connect_tasks row), so it
  gets the exact same ceiling check create_event() already uses.

Task version-history/rollback (spec §5.2's Task row: "restore previous
task version or delete task if newly created") is NOT built in this
slice — a rejected/unwanted suggested task is just deleted or dismissed.
Full version-chain infrastructure for a brand-new, low-stakes entity with
no real usage yet would be building for a scenario nobody has hit;
revisit if task edits/undo actually matter in practice.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.action_review import service as action_review
from app.connect.calendar_service import native_events, tasks as tasks_service
from app.connect.policy_engine import service as policy_engine
from app.connect.shared.errors import Conflict, Invalid
from app.connect.shared.tenant import TenantContext
from app.core.ai import ai_generate_agenda, ai_generate_followup_tasks, ai_generate_meeting_brief
from app.models.user import User

CALENDAR_AGENDA_PROPOSE_ACTION = "calendar.agenda.propose.v1"
TASKS_CREATE_ACTION = "calendar.followup_tasks.create.v1"
_STAGE_AT_LEVEL = 2  # same threshold native_events.create_event() uses


def _attendee_display_names(db: DbSession, event) -> list[str]:
    emails = [a.get("email") for a in (event.attendees or []) if a.get("email")]
    if not emails:
        return []
    users = {u.email: u.name for u in db.query(User).filter(User.email.in_(emails)).all()}
    return [users.get(email, email) for email in emails]


async def generate_agenda(
    db: DbSession, ctx: TenantContext, *, version_chain_id: str, context_notes: str | None = None,
) -> dict[str, Any]:
    """L1: returns the generated agenda directly (nothing persisted, nothing
    to stage — it's a suggestion, the human decides what to do with it).
    L2: stages the SAME generated agenda as an Action Review Queue proposal
    (action_type calendar.agenda.propose.v1) instead of returning it
    directly, per spec's "stage a complete agenda... at L2." Deliberately
    does NOT build an approve-applies-to-event executor — unlike
    native_events' create-proposal flow, nothing here has named "approving
    updates the event's description" as a requirement, and building that
    write path speculatively would be scope creep; a reviewer today
    approves this to acknowledge/hand it off, not to trigger a further
    mutation."""
    event = native_events.get_current_event(db, ctx, version_chain_id)
    resolved = policy_engine.resolve_effective_autonomy(db, ctx, category="calendar")
    agenda = ai_generate_agenda(event.title, _attendee_display_names(db, event), context_notes)

    if resolved.level >= _STAGE_AT_LEVEL:
        staged = await action_review.stage_action(
            db, ctx,
            action_type=CALENDAR_AGENDA_PROPOSE_ACTION,
            action_payload={"version_chain_id": version_chain_id, "agenda_items": agenda["agenda_items"]},
            policy_verdicts={"autonomy": resolved.level},
            reasoning_trace={
                "rationale": (
                    f"Generated agenda for '{event.title}' from {len(event.attendees or [])} "
                    f"attendee(s)" + (" with supplied context notes." if context_notes else ".")
                ),
                "source_nodes": [{"node_type": "calendar_event", "node_id": event.version_chain_id}],
                "tool_chain": ["core.ai.ai_generate_agenda", "calendar_service.ai_workflows.generate_agenda"],
                "model": agenda.get("_model"),
            },
            rollback_descriptor="no_rollback",
            proposed_by_agent="ai_generate_agenda",
            policy_version_id=policy_engine.get_current_version_id(db, ctx, category="calendar"),
        )
        return {"staged": True, "review_item": staged, "agent_generated": True}
    return {"staged": False, "agenda_items": agenda["agenda_items"], "agent_generated": True, "_error": agenda.get("_error")}


def generate_meeting_brief(db: DbSession, ctx: TenantContext, *, version_chain_id: str) -> dict[str, Any]:
    """Pure L1 — read-only, nothing persisted or staged, same governance-free
    framing as availability.py's suggestions: no agent action is being
    taken, only information surfaced for a human to read before their
    meeting."""
    event = native_events.get_current_event(db, ctx, version_chain_id)
    attendee_emails = [a.get("email") for a in (event.attendees or []) if a.get("email")]
    prior_titles = _prior_related_event_titles(db, ctx, event, attendee_emails)
    brief = ai_generate_meeting_brief(event.title, _attendee_display_names(db, event), prior_titles)
    return {**brief, "agent_generated": True}


def _prior_related_event_titles(db: DbSession, ctx: TenantContext, event, attendee_emails: list[str]) -> list[str]:
    """Past native events of the CALLER's own (native_events.list_events is
    already scoped that way) sharing at least one attendee with the current
    event — "attendee history" from the requester's own point of view, not
    a tenant-wide search (team_calendar.py's cross-member aggregation is a
    different, heavier query this brief doesn't need)."""
    if not attendee_emails:
        return []
    now = datetime.now(timezone.utc)
    candidates = native_events.list_events(db, ctx, time_max=now)
    related = [
        e for e in candidates
        if e.version_chain_id != event.version_chain_id
        and e.status != "cancelled"
        and any(a.get("email") in attendee_emails for a in (e.attendees or []))
    ]
    related.sort(key=lambda e: e.start_at, reverse=True)
    return [e.title for e in related[:5]]


async def generate_followup_tasks(
    db: DbSession, ctx: TenantContext, *, version_chain_id: str, context_notes: str,
) -> dict[str, Any]:
    """Post-meeting only (spec: follow-up suggestions happen after the
    event) — rejects if the event hasn't ended yet, since "follow-up" for
    a meeting that hasn't happened is a different feature (that's
    generate_agenda's job). Gated by the SAME autonomy ceiling
    native_events.create_event() uses, because creating a Task row is a
    real mutation, unlike agenda/brief."""
    event = native_events.get_current_event(db, ctx, version_chain_id)
    if event.end_at > datetime.now(timezone.utc):
        raise Invalid("Follow-up tasks can only be generated after the meeting has ended")
    if not context_notes or not context_notes.strip():
        raise Invalid("context_notes is required to generate follow-up tasks")

    resolved = policy_engine.resolve_effective_autonomy(db, ctx, category="calendar")
    generated = ai_generate_followup_tasks(event.title, context_notes)
    task_payloads = generated["tasks"]

    if resolved.level >= _STAGE_AT_LEVEL:
        staged = await action_review.stage_action(
            db, ctx,
            action_type=TASKS_CREATE_ACTION,
            action_payload={"version_chain_id": version_chain_id, "tasks": task_payloads},
            policy_verdicts={"autonomy": resolved.level},
            reasoning_trace={
                "rationale": (
                    f"Generated {len(task_payloads)} follow-up task(s) for '{event.title}' "
                    f"from post-meeting context notes."
                ),
                "source_nodes": [{"node_type": "calendar_event", "node_id": event.version_chain_id}],
                "tool_chain": [
                    "core.ai.ai_generate_followup_tasks",
                    "calendar_service.ai_workflows.generate_followup_tasks",
                ],
                "model": generated.get("_model"),
            },
            rollback_descriptor="no_rollback",
            proposed_by_agent="ai_generate_followup_tasks",
            policy_version_id=policy_engine.get_current_version_id(db, ctx, category="calendar"),
        )
        return {"staged": True, "review_item": staged, "agent_generated": True}

    created = [
        tasks_service.create_task(
            db, ctx, title=t["title"], priority=t.get("priority", "med"),
            assignee_email=t.get("assignee_email"), source_event_id=version_chain_id,
            generated_by_agent=True,
        )
        for t in task_payloads
    ]
    return {"staged": False, "tasks": [tasks_service.to_dict(t) for t in created], "agent_generated": True}


async def create_tasks_from_approved_proposal(db: DbSession, ctx: TenantContext, item_id: str) -> list[dict[str, Any]]:
    """Executor for a follow-up-tasks batch staged via generate_followup_tasks()
    at L2+ — mirrors native_events.create_event_from_approved_proposal()'s
    shape (validate action_type + approved status, then materialize)."""
    item = action_review.get_item(db, ctx, item_id)
    if item.action_type != TASKS_CREATE_ACTION:
        raise Invalid(f"Item {item_id} is not a follow-up-tasks proposal")
    if item.status != "approved":
        raise Conflict(f"Item is '{item.status}', not 'approved' — cannot materialize")

    payload = item.action_payload
    created = [
        tasks_service.create_task(
            db, ctx, title=t["title"], priority=t.get("priority", "med"),
            assignee_email=t.get("assignee_email"), source_event_id=payload.get("version_chain_id"),
            generated_by_agent=True,
        )
        for t in payload["tasks"]
    ]

    # Work Graph mutated edge (AgentAction->Task, spec §3.2: "Blast-radius
    # analysis") — one per task this approved proposal actually created.
    # Local import: work_graph/service.py imports this module (via
    # calendar_service.tasks) at top level, so importing it back here at
    # module scope would cycle — same pattern native_events.py's own
    # Work Graph helpers already established.
    from app.connect.work_graph import service as work_graph
    for task in created:
        work_graph.create_edge(
            db, ctx, edge_type="mutated",
            from_node_type="agent_action", from_node_id=item_id,
            to_node_type="task", to_node_id=task.id,
        )
    db.commit()

    return [tasks_service.to_dict(t) for t in created]
