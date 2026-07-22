from app.connect.sema_guide.models import RankedAction


def rank_actions(
    surface: str | None = None,
    page_route: str | None = None,
    user_role: str = "member",
    user_plan: str = "free",
    recent_failure: str | None = None,
    active_incident: bool = False,
) -> list[RankedAction]:
    all_actions = _build_action_pool(user_role, user_plan)

    if active_incident:
        status_actions = [a for a in all_actions if a.intent == "status"]
        others = [a for a in all_actions if a.intent != "status"]
        all_actions = status_actions + others

    if surface == "meeting":
        meeting_actions = [a for a in all_actions if a.intent in ("join", "schedule", "recordings")]
        others = [a for a in all_actions if a.intent not in ("join", "schedule", "recordings")]
        all_actions = meeting_actions + others

    return all_actions[:6]


def _build_action_pool(user_role: str = "member", user_plan: str = "free") -> list[RankedAction]:
    actions = [
        RankedAction(id="schedule-meeting", label="Schedule a meeting", icon="calendar", intent="schedule", description="Create a new meeting invite"),
        RankedAction(id="join-meeting", label="Join a meeting", icon="video", intent="join", description="Join an existing meeting by code"),
        RankedAction(id="check-recording", label="Find recordings", icon="play-circle", intent="recordings", description="Browse your meeting recordings"),
        RankedAction(id="check-plan", label="Check plan & limits", icon="credit-card", intent="billing", description="View your current plan and usage"),
        RankedAction(id="invite-people", label="Invite people", icon="users", intent="invite", description="Add members to your workspace"),
        RankedAction(id="help-center", label="Help center", icon="help-circle", intent="help_center", description="Browse help articles"),
        RankedAction(id="service-status", label="Service status", icon="activity", intent="status", description="Check current platform status"),
    ]

    if user_role == "admin":
        actions.append(RankedAction(id="manage-workspace", label="Manage workspace", icon="settings", intent="admin", description="Configure workspace settings and policies"))

    if user_plan in ("business", "enterprise"):
        actions.append(RankedAction(id="security-report", label="Security report", icon="shield", intent="security", description="View security and compliance reports"))

    return actions
