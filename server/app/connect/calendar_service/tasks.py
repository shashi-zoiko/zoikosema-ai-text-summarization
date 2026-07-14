"""Task CRUD — spec §3.1 Task node, Phase 2 slice 8.

Plain reference/work-item data (see models.py's Task docstring for why this
is an ordinary mutable table, not append-only). Governance — autonomy
gating, Action Review staging for agent-created tasks — lives in
ai_workflows.py, which is the only writer that needs it; a human directly
creating their own task (create_task, generated_by_agent=False) doesn't
need L2 review of themselves.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.calendar_service.models import TASK_PRIORITIES, TASK_STATUSES, Task
from app.connect.shared.errors import Invalid, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext


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
    db.commit()
    return task


def to_dict(task: Task) -> dict[str, Any]:
    return {
        "id": task.id, "title": task.title, "status": task.status, "priority": task.priority,
        "assignee_email": task.assignee_email, "source_event_id": task.source_event_id,
        "generated_by_agent": task.generated_by_agent, "created_by": task.created_by,
        "created_at": task.created_at.isoformat() if task.created_at else None,
    }
