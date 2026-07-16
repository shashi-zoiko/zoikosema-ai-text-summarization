"""Team calendar — a saved query over members' events, not a materialized
calendar of its own (spec §6.1, CONTEXT.md §1: Person/Organisation nodes
map onto the existing User/OrganizationMember tables, not a new identity
concept). No new event storage: this module aggregates
connect_native_calendar_events across a team's members, the same way
availability.py aggregates one user's events into busy intervals —
list_occurrences() is the single expansion authority both call, so a
recurring series can't show differently in the team view than it does in
its owner's own calendar.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session as DbSession

from app.connect.calendar_service import native_events
from app.connect.shared.tenant import TenantContext
from app.models.organization import OrganizationMember


def _team_member_ids(db: DbSession, ctx: TenantContext) -> list[int]:
    """Team membership today is whoever's in the same org (spec §6.1 notes
    roster-derived membership as a later refinement once ZoikoTime roster
    reads exist — see Phase 1 slice 7's stub; until then, manual
    OrganizationMember rows, which already work, are the team). A personal
    (no-org) tenant's "team" is just its one member."""
    if not ctx.tenant_id.startswith("org:"):
        return [ctx.user_id]
    org_id = int(ctx.tenant_id.removeprefix("org:"))
    rows = db.query(OrganizationMember.user_id).filter(OrganizationMember.organization_id == org_id).all()
    return [r[0] for r in rows]


def _redact_if_confidential(occurrence: dict[str, Any], *, owner_id: int, viewer_id: int) -> dict[str, Any]:
    """The one real visibility rule that exists today: a confidential event
    shows as an opaque busy block to anyone but its own creator. Full
    placeholder-in-outbound-invite behavior (spec §9.2) is slice 7's job;
    this is the same confidentiality_class field, applied to the one
    surface (team calendar) that reads across other people's events before
    slice 7 lands — not a redesign later, just an earlier, narrower use of
    the same data."""
    out = {**occurrence, "owner_id": owner_id}
    if occurrence.get("confidentiality_class") == "confidential" and owner_id != viewer_id:
        out.update(title="Busy", description=None, location=None, attendees=[], resources=[])
    return out


def list_team_calendar(
    db: DbSession, ctx: TenantContext, *, range_start: datetime, range_end: datetime,
) -> list[dict[str, Any]]:
    member_ids = _team_member_ids(db, ctx)
    out: list[dict[str, Any]] = []
    for member_id in member_ids:
        member_ctx = TenantContext(user_id=member_id, tenant_id=ctx.tenant_id, role=ctx.role)
        for event in native_events.list_events(db, member_ctx):
            occurrences = native_events.list_occurrences(
                db, member_ctx, version_chain_id=event.version_chain_id,
                range_start=range_start, range_end=range_end,
            )
            for occ in occurrences:
                if occ["status"] == "cancelled":
                    continue
                out.append(_redact_if_confidential(occ, owner_id=member_id, viewer_id=ctx.user_id))
    return sorted(out, key=lambda o: o["start_at"])
