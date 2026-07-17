from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.connect.sema_guide.models import (
    GuideChatRequest,
    SaveConversationRequest,
    GuideChatResponse,
    RankedActionsResponse,
    HandoffRequest,
    HandoffState,
    PrivacyContextResponse,
    AboutGuideResponse,
    PrivacyPreferences,
    SharingPreferences,
    PrivacyRequest,
    PrivacyRequestResponse,
    PrivacyActionResponse,
)
from app.connect.sema_guide.service import chat as chat_service
from app.connect.sema_guide.action_ranker import rank_actions
from app.connect.sema_guide.handoff_service import request_handoff, get_active_session
from app.connect.sema_guide.observability import get_stats

PRIVACY_CONTEXT_JSON = """{
  "current_session_rows": [
    {"label": "Conversation messages", "value": "In use", "value_color": "#059669"},
    {"label": "Account context", "value": "Limited", "value_color": "#D97706"},
    {"label": "Workspace context", "value": "Managed by organization", "value_color": "#6366F1"},
    {"label": "Meeting content", "value": "Not accessed", "value_color": "#059669"},
    {"label": "Device diagnostics", "value": "Not shared", "value_color": "#6B7280"},
    {"label": "Attachments", "value": "None"},
    {"label": "Human access", "value": "None", "value_color": "#6B7280"},
    {"label": "Processing region", "value": "Europe"}
  ],
  "current_session_disclaimer": "You are interacting with Sema Guide, an AI support agent. Meeting audio, video, chat and screen content are not accessed merely because Sema Guide is open.",
  "usage_purposes": [
    {"title": "Answer and resolve your request", "description": "Processes messages and minimum relevant context.", "icon": "check", "enabled": true},
    {"title": "Maintain support history", "description": "Allows return to a conversation and continuity with support.", "icon": "check", "enabled": true},
    {"title": "Protect the service", "description": "Detects fraud, malicious files, unauthorized access, spam and abuse.", "icon": "check", "enabled": true},
    {"title": "Operational analytics", "description": "Measures reliability, unresolved topics and tool success.", "icon": "info", "enabled": true},
    {"title": "Optional improvement", "description": "Improves Sema Guide only when law, policy and user choice permit.", "icon": "info", "enabled": false}
  ],
  "storage_retention_rows": [
    {"label": "Conversation history", "value": "30 days after last message"},
    {"label": "Security records", "value": "Up to 12 months"},
    {"label": "Processing region", "value": "Europe"},
    {"label": "Policy owner", "value": "Zoiko Group", "value_color": "#6366F1"}
  ],
  "storage_policy": "Policy: Zoiko Group Sema Privacy Policy v1.0",
  "ai_model_use_rows": [
    {"label": "Live inference", "value": "Required", "value_color": "#059669"},
    {"label": "Grounded retrieval", "value": "Enabled"},
    {"label": "Safety processing", "value": "Required", "value_color": "#059669"},
    {"label": "Foundation-model training", "value": "No", "value_color": "#059669"},
    {"label": "Optional improvement", "value": "Off", "value_color": "#6B7280"},
    {"label": "Human quality review", "value": "Policy restricted", "value_color": "#D97706"}
  ],
  "human_support_message": "No support specialist currently has access to this conversation.",
  "privacy_controls": [
    {"id": "download", "label": "Download this conversation", "icon": "file-text"},
    {"id": "delete", "label": "Delete this conversation", "icon": "trash", "color": "#DC2626"},
    {"id": "manage-optional", "label": "Manage optional data uses", "icon": "sliders"},
    {"id": "manage-sharing", "label": "Manage support-sharing preferences", "icon": "users"},
    {"id": "privacy-request", "label": "Submit a privacy request", "icon": "shield"}
  ],
  "policy_links": [
    {"label": "Privacy notice", "url": "#"},
    {"label": "Trust Center", "url": "#"},
    {"label": "Subprocessors", "url": "#"},
    {"label": "Privacy support", "url": "#"}
  ]
}"""

ABOUT_GUIDE_JSON = """{
  "identity_name": "Sema Guide",
  "identity_description": "AI support and product guidance agent",
  "identity_notice": "Sema Guide is an AI system, not a human representative.",
  "status": "Available",
  "managed_by": "Zoiko Group",
  "capabilities": [
    {"label": "Answers", "description": "Approved product, plan, policy and status information."},
    {"label": "Troubleshooting", "description": "Meeting join, microphone, camera, speaker and supported issues."},
    {"label": "Guidance", "description": "Settings, workflows, entitlements and feature restrictions."},
    {"label": "Human support", "description": "Live handoff or case creation when you need a person."}
  ],
  "info_access_rows": [
    {"label": "Conversation messages", "value": "In use", "value_color": "#059669"},
    {"label": "Account context", "value": "Limited", "value_color": "#D97706"},
    {"label": "Workspace policy", "value": "Authorized", "value_color": "#059669"},
    {"label": "Meeting audio/video", "value": "Not accessed", "value_color": "#059669"},
    {"label": "Screen/chat/files", "value": "Not accessed", "value_color": "#059669"},
    {"label": "Human access", "value": "None", "value_color": "#6B7280"}
  ],
  "info_access_disclaimer": "Opening Sema Guide does not automatically give it access to meeting audio, video, chat, shared screens, files, transcripts or recordings.",
  "actions_auth": "Sema Guide may prepare supported actions, but consequential changes require your confirmation and applicable permission.",
  "limitations": "Sema Guide can make mistakes. Verify consequential details before relying on them.",
  "human_support_message": "No support specialist currently has access to this conversation.",
  "human_support_enabled": true,
  "governance_rows": [
    {"label": "Workspace", "value": "Zoiko Group"},
    {"label": "Policy source", "value": "AI and Agentic Controls v2.1"},
    {"label": "Foundation-model training", "value": "No", "value_color": "#059669"},
    {"label": "Optional improvement", "value": "Off", "value_color": "#6B7280"},
    {"label": "Processing region", "value": "Europe"}
  ],
  "service_info_rows": [
    {"label": "Product version", "value": "1.0"},
    {"label": "Experience version", "value": "2026.07"},
    {"label": "Knowledge revision", "value": "July 14, 2026"},
    {"label": "Status", "value": "Operational", "value_color": "#059669"}
  ],
  "links": [
    {"label": "Privacy & data", "url": "#"},
    {"label": "Security & Trust Center", "url": "#"},
    {"label": "Service status", "url": "#"},
    {"label": "Send feedback", "url": "#"}
  ]
}"""

router = APIRouter(prefix="/api/sema-guide", tags=["sema-guide"])


@router.post("/chat", response_model=GuideChatResponse)
def guide_chat(
    data: GuideChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = user.role if hasattr(user, "role") and user.role else "member"
    plan = getattr(user, "plan", "free") or "free"

    return chat_service(
        message=data.message,
        conversation=data.conversation,
        user_id=user.id,
        user_name=user.name,
        user_role=role,
        user_plan=plan,
        surface=data.surface,
        page_route=data.page_route,
    )


@router.get("/actions", response_model=RankedActionsResponse)
def get_ranked_actions(
    surface: str | None = Query(None),
    page_route: str | None = Query(None),
    recent_failure: str | None = Query(None),
    active_incident: bool = Query(False),
    user: User = Depends(get_current_user),
):
    role = user.role if hasattr(user, "role") and user.role else "member"
    plan = getattr(user, "plan", "free") or "free"

    actions = rank_actions(
        surface=surface,
        page_route=page_route,
        user_role=role,
        user_plan=plan,
        recent_failure=recent_failure,
        active_incident=active_incident,
    )
    return RankedActionsResponse(actions=actions)


@router.post("/handoff", response_model=HandoffState)
def request_human_handoff(
    data: HandoffRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = get_active_session(user.id)
    if existing:
        return HandoffState(
            state=existing.state.value,
            estimated_wait_seconds=existing.estimated_wait_seconds,
        )

    session = request_handoff(user.id, context=(data.context if data else None))
    return HandoffState(
        state=session.state.value,
        estimated_wait_seconds=session.estimated_wait_seconds,
    )


@router.get("/handoff/state", response_model=HandoffState)
def get_handoff_state(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = get_active_session(user.id)
    if not session:
        return HandoffState(state="idle")

    return HandoffState(
        state=session.state.value,
        estimated_wait_seconds=session.estimated_wait_seconds,
        specialist_name=session.specialist_name,
    )


@router.get("/privacy-context", response_model=PrivacyContextResponse)
def get_privacy_context(
    user: User = Depends(get_current_user),
):
    import json
    return PrivacyContextResponse(**json.loads(PRIVACY_CONTEXT_JSON))


@router.get("/about", response_model=AboutGuideResponse)
def get_about_guide(
    user: User = Depends(get_current_user),
):
    import json
    return AboutGuideResponse(**json.loads(ABOUT_GUIDE_JSON))


_privacy_prefs: dict[int, dict] = {}
_sharing_prefs: dict[int, dict] = {}
_privacy_requests: list[dict] = []
_conversations: dict[int, list[dict]] = {}


@router.post("/privacy/download")
def download_conversation(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.models.chat import Message
    mids = db.query(Message).filter(
        Message.sender_id == user.id
    ).order_by(Message.created_at.asc()).all()
    data = [
        {
            "id": m.id,
            "body": m.body,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in mids
    ]
    return JSONResponse(content={"messages": data, "total": len(data)})


@router.delete("/privacy/conversation", response_model=PrivacyActionResponse)
def delete_conversation(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.models.chat import Message
    count = db.query(Message).filter(
        Message.sender_id == user.id
    ).delete()
    db.commit()
    return PrivacyActionResponse(success=True, message=f"Deleted {count} message(s)")


@router.get("/privacy/preferences", response_model=PrivacyPreferences)
def get_privacy_preferences(
    user: User = Depends(get_current_user),
):
    prefs = _privacy_prefs.get(user.id, {})
    return PrivacyPreferences(**prefs)


@router.put("/privacy/preferences", response_model=PrivacyActionResponse)
def update_privacy_preferences(
    data: PrivacyPreferences,
    user: User = Depends(get_current_user),
):
    _privacy_prefs[user.id] = data.model_dump()
    return PrivacyActionResponse(success=True, message="Preferences saved")


@router.get("/privacy/sharing-preferences", response_model=SharingPreferences)
def get_sharing_preferences(
    user: User = Depends(get_current_user),
):
    prefs = _sharing_prefs.get(user.id, {})
    return SharingPreferences(**prefs)


@router.put("/privacy/sharing-preferences", response_model=PrivacyActionResponse)
def update_sharing_preferences(
    data: SharingPreferences,
    user: User = Depends(get_current_user),
):
    _sharing_prefs[user.id] = data.model_dump()
    return PrivacyActionResponse(success=True, message="Sharing preferences saved")


@router.post("/privacy/request", response_model=PrivacyRequestResponse)
def submit_privacy_request(
    data: PrivacyRequest,
    user: User = Depends(get_current_user),
):
    import uuid
    request_id = uuid.uuid4().hex[:12]
    _privacy_requests.append({
        "id": request_id,
        "user_id": user.id,
        "request_type": data.request_type,
        "details": data.details,
        "status": "submitted",
    })
    return PrivacyRequestResponse(id=request_id, status="submitted", message="Your privacy request has been received. We will respond within 30 days.")


@router.get("/conversation")
def get_conversation(
    user: User = Depends(get_current_user),
):
    msgs = _conversations.get(user.id, [])
    return {"messages": msgs}


@router.put("/conversation")
def save_conversation(
    data: SaveConversationRequest,
    user: User = Depends(get_current_user),
):
    _conversations[user.id] = data.conversation
    return {"success": True}


@router.get("/observability/stats")
def get_observability_stats(
    minutes: int = 60,
    user: User = Depends(get_current_user),
):
    from app.core.deps import get_current_user as _admin_check
    return get_stats(minutes=minutes)
