import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable

log = logging.getLogger(__name__)


class ToolRiskClass(Enum):
    READ_ONLY = "read-only"
    LOW_SIDE_EFFECT = "low"
    MEDIUM_SIDE_EFFECT = "medium"
    HIGH_SIDE_EFFECT = "high"
    CRITICAL = "critical"


class ToolAuthorization(Enum):
    NORMAL = "normal"
    SESSION_CONFIRM = "session_confirm"
    HUMAN_CONFIRM = "human_confirm"
    HUMAN_AUTH_REQUIRED = "human_auth_required"


RISK_TO_AUTH = {
    ToolRiskClass.READ_ONLY: ToolAuthorization.NORMAL,
    ToolRiskClass.LOW_SIDE_EFFECT: ToolAuthorization.SESSION_CONFIRM,
    ToolRiskClass.MEDIUM_SIDE_EFFECT: ToolAuthorization.HUMAN_CONFIRM,
    ToolRiskClass.HIGH_SIDE_EFFECT: ToolAuthorization.HUMAN_CONFIRM,
    ToolRiskClass.CRITICAL: ToolAuthorization.HUMAN_AUTH_REQUIRED,
}


@dataclass
class ToolDef:
    id: str
    name: str
    description: str
    risk_class: ToolRiskClass
    auth: ToolAuthorization
    reversible: bool = False
    reversible_duration: str | None = None
    handler: Callable | None = None
    parameters: dict = field(default_factory=dict)


_tools: dict[str, ToolDef] = {}


def register(tool: ToolDef):
    _tools[tool.id] = tool


def get(tool_id: str) -> ToolDef | None:
    return _tools.get(tool_id)


def list_all() -> list[ToolDef]:
    return list(_tools.values())


def list_authorized(user_role: str, plan: str) -> list[ToolDef]:
    return [
        t for t in _tools.values()
        if t.auth != ToolAuthorization.HUMAN_AUTH_REQUIRED
    ]


register(ToolDef(
    id="get-meeting-recordings",
    name="Get Meeting Recordings",
    description="List and retrieve meeting recordings",
    risk_class=ToolRiskClass.READ_ONLY,
    auth=ToolAuthorization.NORMAL,
))

register(ToolDef(
    id="schedule-meeting",
    name="Schedule Meeting",
    description="Create a new meeting with invitees",
    risk_class=ToolRiskClass.LOW_SIDE_EFFECT,
    auth=ToolAuthorization.SESSION_CONFIRM,
    reversible=True,
    reversible_duration="5 minutes",
))

register(ToolDef(
    id="invite-member",
    name="Invite Member",
    description="Send a workspace invitation to an email address",
    risk_class=ToolRiskClass.LOW_SIDE_EFFECT,
    auth=ToolAuthorization.SESSION_CONFIRM,
))

register(ToolDef(
    id="update-billing",
    name="Update Billing",
    description="Change billing plan or payment method",
    risk_class=ToolRiskClass.CRITICAL,
    auth=ToolAuthorization.HUMAN_AUTH_REQUIRED,
))
