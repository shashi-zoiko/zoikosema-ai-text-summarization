"""ZoikoTime workforce-truth signal — read (Phase 1 slice 7) and hard-
constraint check (Phase 2 slice 6). Spec §6.1: "Constraint phases:
read-only visibility Phase 1; hard enforcement Phase 2+."

Split into its own module (rather than living in availability.py, where the
read-side seam was first built) so both availability.py (suggestion) and
native_events.py (enforcement on create/update) can depend on it without
a circular import — availability.py already imports native_events.py, so
native_events.py importing availability.py back would cycle.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session as DbSession

from app.connect.shared.tenant import TenantContext
from app.core.config import get_settings


def zoikotime_busy_intervals(
    db: DbSession, ctx: TenantContext, day_start: datetime, day_end: datetime,
) -> list[tuple[datetime, datetime]]:
    """ZoikoTime workforce-truth availability signal (spec §6.1: shift
    off-hours, approved leave/OOO, rest windows) — gated behind
    ZOIKOTIME_INTEGRATION_ENABLED (default off).

    Always returns [] today: no WorkforceSignal data source exists yet in
    this repo — that's plans/zoikotime-workforce-signal-integration.md's
    scope, a separate cross-repo plan with its own webhook receiver and
    table. This function is the intended seam: once that table exists,
    swapping this body for a real query is a small follow-up, because every
    caller already treats whatever this returns like any other busy-
    interval source — no redesign needed then. With the flag off (the only
    real state until that lands), this is a no-op passthrough with zero
    behavior change.
    """
    if not get_settings().zoikotime_integration_enabled:
        return []
    return []  # no data source wired yet — see docstring


def check_hard_constraint(
    db: DbSession, ctx: TenantContext, *, start_at: datetime, end_at: datetime,
) -> str | None:
    """Returns a human-readable rejection reason if [start_at, end_at]
    overlaps a ZoikoTime workforce constraint for ctx.user_id AND hard
    enforcement is on; None otherwise (feature off, or no conflict) — spec
    §6.1 "Constraint solver rejects overload schedules and explains
    rejection." Callers (native_events.create_event/update_event) raise
    Conflict with this string; this function itself never raises, so it
    stays a plain read like zoikotime_busy_intervals above."""
    settings = get_settings()
    if not (settings.zoikotime_integration_enabled and settings.zoikotime_hard_enforcement_enabled):
        return None
    for busy_start, busy_end in zoikotime_busy_intervals(db, ctx, start_at, end_at):
        if busy_start < end_at and busy_end > start_at:
            return (
                f"Conflicts with a ZoikoTime workforce constraint "
                f"({busy_start.isoformat()} - {busy_end.isoformat()})"
            )
    return None
