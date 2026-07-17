from pydantic import BaseModel, Field
from typing import Literal


# ── Privacy & Data ───────────────────────────────────────────────────────────

class PrivacyRow(BaseModel):
    label: str
    value: str
    value_color: str | None = None


class UsagePurpose(BaseModel):
    title: str
    description: str
    icon: Literal["check", "info"]
    enabled: bool = True


class PrivacyControl(BaseModel):
    id: str
    label: str
    icon: str
    color: str | None = None


class PolicyLink(BaseModel):
    label: str
    url: str


class PrivacyContextResponse(BaseModel):
    current_session_rows: list[PrivacyRow]
    current_session_disclaimer: str
    usage_purposes: list[UsagePurpose]
    storage_retention_rows: list[PrivacyRow]
    storage_policy: str
    ai_model_use_rows: list[PrivacyRow]
    human_support_message: str
    privacy_controls: list[PrivacyControl]
    policy_links: list[PolicyLink]


# ── About Sema Guide ─────────────────────────────────────────────────────────

class Capability(BaseModel):
    label: str
    description: str


class AboutRow(BaseModel):
    label: str
    value: str
    value_color: str | None = None


class AboutLink(BaseModel):
    label: str
    url: str


class AboutGuideResponse(BaseModel):
    identity_name: str
    identity_description: str
    identity_notice: str
    status: str
    managed_by: str
    capabilities: list[Capability]
    info_access_rows: list[AboutRow]
    info_access_disclaimer: str
    actions_auth: str
    limitations: str
    human_support_message: str
    human_support_enabled: bool
    governance_rows: list[AboutRow]
    service_info_rows: list[AboutRow]
    links: list[AboutLink]


# ── Privacy Actions ─────────────────────────────────────────────────────────

class PrivacyPreferences(BaseModel):
    improvement_opt_in: bool = False
    quality_review_opt_in: bool = False
    product_research_opt_in: bool = False


class SharingPreferences(BaseModel):
    share_with_workspace: bool = False
    share_for_training: bool = False
    share_with_support: bool = True


class PrivacyRequest(BaseModel):
    request_type: Literal["access", "deletion", "portability", "objection", "restriction"]
    details: str = ""


class PrivacyRequestResponse(BaseModel):
    id: str
    status: str
    message: str


class PrivacyActionResponse(BaseModel):
    success: bool
    message: str


# ── Chat / Handoff ───────────────────────────────────────────────────────────

class GuideChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation: list[dict] = Field(default_factory=list)
    surface: str | None = None
    page_route: str | None = None


class SaveConversationRequest(BaseModel):
    conversation: list[dict]


class Source(BaseModel):
    label: str
    url: str | None = None
    title: str = ""


class ActionPreview(BaseModel):
    title: str | None = None
    object: str | None = None
    before: str | None = None
    after: str | None = None
    people_affected: int | None = None
    notifications: str | None = None
    consequence: str | None = None
    reversible: bool | None = None
    reversible_duration: str | None = None


class GuideChatResponse(BaseModel):
    response: str
    verified: bool = False
    sources: list[Source] = Field(default_factory=list)
    action_preview: ActionPreview | None = None


class RankedAction(BaseModel):
    id: str
    label: str
    icon: str
    intent: str
    description: str | None = None


class RankedActionsResponse(BaseModel):
    actions: list[RankedAction] = Field(default_factory=list)


class HandoffRequest(BaseModel):
    context: dict | None = None


class HandoffState(BaseModel):
    state: Literal["queued", "connecting", "human_assigned", "failed"]
    estimated_wait_seconds: int | None = None
    specialist_name: str | None = None
