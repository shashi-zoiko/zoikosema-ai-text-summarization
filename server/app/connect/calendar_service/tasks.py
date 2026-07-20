"""Task CRUD — spec §3.1 Task node, Phase 2 slice 8.

Plain reference/work-item data (see models.py's Task docstring for why this
is an ordinary mutable table, not append-only). Governance — autonomy
gating, Action Review staging for agent-created tasks — lives in
ai_workflows.py, which is the only writer that needs it; a human directly
creating their own task (create_task, generated_by_agent=False) doesn't
need L2 review of themselves.

Version history + restore (Phase 4 slice, spec §5.2's Task row: "restore
previous task version or delete task if newly created") — see models.py's
TaskVersion docstring and migrations/connect_v3_024_task_versions.sql for
why this is a side snapshot table rather than converting Task into a
version-chain like NativeCalendarEvent. Every create/status-update writes a
new TaskVersion snapshot; restore_previous_task_version re-applies the
prior snapshot onto the live row (itself recorded as a further new
version, same "restore is also a new version" semantics native_events.py
established).
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.calendar_service.models import TASK_PRIORITIES, TASK_STATUSES, Task, TaskVersion
from app.connect.shared.errors import Conflict, Invalid, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext


def _latest_version_row(db: DbSession, tenant_id: str, task_id: str) -> TaskVersion | None:
    return (
        db.query(TaskVersion)
        .filter(TaskVersion.tenant_id == tenant_id, TaskVersion.task_id == task_id)
        .order_by(TaskVersion.version_number.desc())
        .first()
    )


def _record_version(db: DbSession, ctx: TenantContext, task: Task) -> TaskVersion:
    prior = _latest_version_row(db, ctx.tenant_id, task.id)
    next_version = (prior.version_number + 1) if prior else 1
    version = TaskVersion(
        id=uuid7_str(), tenant_id=ctx.tenant_id, task_id=task.id, version_number=next_version,
        title=task.title, status=task.status, priority=task.priority, assignee_email=task.assignee_email,
    )
    db.add(version)
    db.flush()
    return version


def create_task(
    db: DbSession, ctx: TenantContext, *,
    title: str, priority: str = "med", assignee_email: str | None = None,
    source_event_id: str | None = None, generated_by_agent: bool = False,
) -> Task:
    if not title or not title.strip():
        raise Invalid("title is required")
    if priority not in TASK_PRIORITIES:
        raise Invalid(f"Unknown priority: {priority}")
    task = Task(
        id=uuid7_str(), tenant_id=ctx.tenant_id, title=title.strip(), priority=priority,
        assignee_email=assignee_email, source_event_id=source_event_id,
        generated_by_agent=generated_by_agent, created_by=ctx.user_id,
        correlation_id=get_correlation_id(),
    )
    db.add(task)
    db.flush()
    _record_version(db, ctx, task)

    if source_event_id:
        # Work Graph derived_from edge (Task->CalendarEvent, spec §3.2),
        # Phase 3 slice 7 — written at creation time now that Work Graph
        # exists, so this task never needs the backfill that covers tasks
        # created before this slice (see work_graph/service.py's
        # backfill_task_derived_from_edges). Local import: work_graph/
        # service.py imports this module at top level to resolve task
        # nodes, so importing it back at module scope here would cycle.
        from app.connect.work_graph import service as work_graph
        work_graph.create_edge(
            db, ctx, edge_type="derived_from",
            from_node_type="task", from_node_id=task.id,
            to_node_type="calendar_event", to_node_id=source_event_id,
        )

    db.commit()
    return task


def list_tasks(db: DbSession, ctx: TenantContext, *, status: str | None = None) -> list[Task]:
    q = db.query(Task).filter(Task.tenant_id == ctx.tenant_id)
    if status:
        q = q.filter(Task.status == status)
    return q.order_by(Task.created_at.desc()).all()


def get_task(db: DbSession, ctx: TenantContext, task_id: str) -> Task:
    task = db.query(Task).filter(Task.tenant_id == ctx.tenant_id, Task.id == task_id).first()
    if task is None:
        raise NotFound("Task not found")
    return task


def update_task_status(db: DbSession, ctx: TenantContext, task_id: str, *, status: str) -> Task:
    if status not in TASK_STATUSES:
        raise Invalid(f"Unknown status: {status}")
    task = get_task(db, ctx, task_id)
    task.status = status
    db.flush()
    _record_version(db, ctx, task)
    db.commit()
    return task


def list_task_versions(db: DbSession, ctx: TenantContext, task_id: str) -> list[TaskVersion]:
    get_task(db, ctx, task_id)  # 404s if the task doesn't exist / isn't this tenant's
    return (
        db.query(TaskVersion)
        .filter(TaskVersion.tenant_id == ctx.tenant_id, TaskVersion.task_id == task_id)
        .order_by(TaskVersion.version_number.desc())
        .all()
    )


def restore_previous_task_version(db: DbSession, ctx: TenantContext, task_id: str) -> Task:
    """Re-applies the version immediately before the current one onto the
    live Task row. Spec §5.2: "restore previous task version OR delete task
    if newly created" — a task with only its version-1 (creation) snapshot
    has nothing to restore to; the caller is expected to delete it instead
    (no delete_task exists yet either — same "not built until a real
    caller needs it" precedent this codebase uses throughout; deleting a
    task today means dismissing it via update_task_status(status="dismissed"))."""
    task = get_task(db, ctx, task_id)
    current = _latest_version_row(db, ctx.tenant_id, task_id)
    if current is None or current.version_number < 2:
        raise Conflict("This task has no prior version to restore — dismiss it instead if it was just created")

    previous = (
        db.query(TaskVersion)
        .filter(
            TaskVersion.tenant_id == ctx.tenant_id, TaskVersion.task_id == task_id,
            TaskVersion.version_number == current.version_number - 1,
        )
        .first()
    )
    if previous is None:
        raise Conflict("Prior version record is missing — cannot restore")

    task.title = previous.title
    task.status = previous.status
    task.priority = previous.priority
    task.assignee_email = previous.assignee_email
    db.flush()
    _record_version(db, ctx, task)
    db.commit()
    return task


def to_dict(task: Task) -> dict[str, Any]:
    return {
        "id": task.id, "title": task.title, "status": task.status, "priority": task.priority,
        "assignee_email": task.assignee_email, "source_event_id": task.source_event_id,
        "generated_by_agent": task.generated_by_agent, "created_by": task.created_by,
        "created_at": task.created_at.isoformat() if task.created_at else None,
    }
