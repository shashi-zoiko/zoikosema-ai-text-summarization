"""Enterprise Settings Control Center data.

Serves the Settings page's content as a single aggregate payload so the
frontend fetches it at runtime instead of shipping hardcoded JSON. Values are
demo/seed content for now — swap the module-level dicts for real DB / service
queries (and add PATCH endpoints) as those systems land. Keys match the shapes
the client consumes.
"""
from fastapi import APIRouter, Depends

from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/settings", tags=["settings"])

_OVERVIEW = {
    "POLICY_BANNER": {
        "managedBy": "Zoiko Group",
        "lockedCount": 4,
        "configuring": [
            {"label": "Personal Preferences", "kind": "user"},
            {"label": "Zoiko Group Workspace", "kind": "workspace"},
            {"label": "Tier 1 Tenant", "kind": "tenant"},
        ],
    },
    "SECTIONS": [
        {"id": "account", "label": "Account", "icon": "User"},
        {"id": "meetings", "label": "Meetings", "icon": "Video"},
        {"id": "ai", "label": "AI & Agentic", "icon": "Sparkles"},
        {"id": "notifications", "label": "Notifications", "icon": "Bell"},
        {"id": "privacy", "label": "Privacy & Security", "icon": "ShieldCheck"},
        {"id": "integrations", "label": "Integrations", "icon": "Plug"},
        {"id": "advanced", "label": "Advanced", "icon": "Settings2"},
    ],
    "POLICY": {
        "tenant_enforced": {"scope": "Tenant", "label": "Locked by Tier 1 tenant policy", "tone": "danger", "icon": "Lock", "readOnly": True, "action": "Request Exception"},
        "workspace_inherited": {"scope": "Workspace", "label": "Inherited from Zoiko Group Workspace", "tone": "accent", "icon": "Building2", "readOnly": False, "action": "Override"},
        "user_preference": {"scope": "User", "label": "Your preference", "tone": "neutral", "icon": "User", "readOnly": False},
        "enterprise_only": {"scope": "Tenant", "label": "Available on Sema Enterprise", "tone": "neutral", "icon": "Crown", "readOnly": True, "gated": True},
        "compliance_critical": {"scope": "Tenant", "label": "Compliance critical — re-authentication required", "tone": "warn", "icon": "Shield", "readOnly": False, "compliance": True},
    },
    "ACCOUNT": {
        "lockedFields": ["Email", "Employee ID", "Department"],
        "languageRegion": [
            {"key": "uiLanguage", "label": "UI language", "value": "English (US)", "options": ["English (US)", "English (UK)", "Français", "Deutsch", "Español", "日本語"], "state": "user_preference"},
            {"key": "meetingLanguage", "label": "Meeting language", "value": "English (US)", "options": ["English (US)", "Français", "Deutsch", "Español"], "state": "user_preference"},
            {"key": "summaryLanguage", "label": "AI summary language", "value": "English (US)", "options": ["English (US)", "Match meeting", "Français", "Deutsch"], "state": "workspace_inherited"},
            {"key": "transcriptionLanguage", "label": "Transcription language", "value": "Auto-detect", "options": ["Auto-detect", "English (US)", "Français", "Deutsch"], "state": "user_preference"},
            {"key": "timezone", "label": "Timezone", "value": "(GMT+00:00) London", "options": ["(GMT+00:00) London", "(GMT-05:00) New York", "(GMT+01:00) Paris", "(GMT+05:30) Mumbai"], "state": "user_preference"},
            {"key": "dateFormat", "label": "Date format", "value": "DD/MM/YYYY", "options": ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"], "state": "user_preference"},
            {"key": "calendarRegion", "label": "Calendar region", "value": "United Kingdom", "options": ["United Kingdom", "United States", "European Union"], "state": "workspace_inherited"},
        ],
        "sessions": [
            {"device": "MacBook Pro · Chrome", "location": "London, UK", "current": True, "lastActive": "Active now"},
            {"device": "iPhone 15 · Zoiko iOS", "location": "London, UK", "current": False, "lastActive": "2h ago"},
            {"device": "Windows · Edge", "location": "Manchester, UK", "current": False, "lastActive": "Yesterday"},
        ],
        "providers": [
            {"name": "Google Workspace", "connected": True},
            {"name": "Microsoft Entra ID", "connected": True},
            {"name": "Okta", "connected": False},
        ],
        "dataResidency": "EU-West-1 (Ireland)",
        "regulatoryJurisdiction": "United Kingdom · EU GDPR",
    },
    "MEETINGS": {
        "joinDefaults": [
            {"key": "joinMuted", "label": "Join muted", "type": "toggle", "value": True, "state": "user_preference"},
            {"key": "cameraOff", "label": "Camera off on join", "type": "toggle", "value": False, "state": "user_preference"},
            {"key": "lobby", "label": "Lobby behavior", "type": "select", "value": "Everyone waits", "options": ["Off", "Guests wait", "Everyone waits"], "state": "workspace_inherited"},
            {"key": "speaker", "label": "Default speaker", "type": "select", "value": "System default", "options": ["System default", "MacBook Pro Speakers", "AirPods Pro"], "state": "user_preference"},
            {"key": "microphone", "label": "Default microphone", "type": "select", "value": "MacBook Pro Mic", "options": ["System default", "MacBook Pro Mic", "AirPods Pro"], "state": "user_preference"},
            {"key": "camera", "label": "Default camera", "type": "select", "value": "FaceTime HD", "options": ["System default", "FaceTime HD", "External 4K"], "state": "user_preference"},
        ],
        "appearance": [
            {"key": "backgrounds", "label": "Virtual backgrounds", "type": "toggle", "value": True, "state": "user_preference"},
            {"key": "blur", "label": "Background blur", "type": "toggle", "value": True, "state": "user_preference"},
            {"key": "lowLight", "label": "Low-light correction", "type": "toggle", "value": False, "state": "user_preference"},
            {"key": "touchUp", "label": "Touch-up appearance", "type": "toggle", "value": False, "state": "user_preference"},
        ],
        "behavior": [
            {"key": "duration", "label": "Default duration", "type": "select", "value": "30 minutes", "options": ["15 minutes", "30 minutes", "45 minutes", "60 minutes"], "state": "user_preference"},
            {"key": "autoCopy", "label": "Auto copy meeting link", "type": "toggle", "value": True, "state": "user_preference"},
            {"key": "calendarAttach", "label": "Calendar attachment", "type": "toggle", "value": True, "state": "workspace_inherited"},
            {"key": "guestPrompts", "label": "Guest join prompts", "type": "toggle", "value": True, "state": "workspace_inherited"},
        ],
        "captions": [
            {"key": "liveCaptions", "label": "Live captions", "type": "toggle", "value": True, "state": "user_preference"},
            {"key": "captionSize", "label": "Caption size", "type": "select", "value": "Medium", "options": ["Small", "Medium", "Large", "Extra large"], "state": "user_preference"},
            {"key": "speakerLabels", "label": "Speaker labels", "type": "toggle", "value": True, "state": "user_preference"},
            {"key": "transcriptLanguage", "label": "Transcript language", "type": "select", "value": "Auto-detect", "options": ["Auto-detect", "English (US)", "Français"], "state": "user_preference"},
        ],
        "confidentialConflicts": [
            {"setting": "Cloud recording", "conflict": "Disabled in Confidential Mode meetings"},
            {"setting": "AI live captions", "conflict": "Runs on-device only — cloud transcription off"},
            {"setting": "Phone dial-in", "conflict": "Blocked for Confidential Mode meetings"},
        ],
    },
    "AUTONOMY_LEVELS": [
        {"level": 0, "name": "Suggest Only", "desc": "AI suggests. User executes manually.", "tone": "neutral"},
        {"level": 1, "name": "Draft with Approval", "desc": "AI drafts. User approves execution.", "tone": "accent"},
        {"level": 2, "name": "Execute with Notification", "desc": "Low-risk actions execute automatically. Notify user.", "tone": "accent"},
        {"level": 3, "name": "Autonomous with Guardrails", "desc": "Enterprise workflows. Caps and audit required.", "tone": "warn"},
        {"level": 4, "name": "Fully Autonomous", "desc": "Restricted enterprise automation.", "tone": "danger"},
    ],
    "CURRENT_AUTONOMY": 1,
    "CATEGORY_GOVERNANCE": [
        {"category": "Meeting follow-up drafts", "level": 1, "spendCap": "$500 / month", "rollback": "User + Admin", "state": "workspace_inherited"},
        {"category": "ZoikoTime task creation", "level": 2, "spendCap": "$200 / month", "rollback": "User + Admin", "state": "workspace_inherited"},
        {"category": "CRM updates", "level": 1, "spendCap": "$300 / month", "rollback": "Admin only", "state": "workspace_inherited"},
        {"category": "External emails", "level": 0, "spendCap": "—", "rollback": "No rollback", "state": "tenant_enforced"},
        {"category": "Payment actions", "level": None, "spendCap": "Blocked", "rollback": "Blocked", "state": "tenant_enforced", "blocked": True},
    ],
    "ROLLBACK_RULES": [
        {"kind": "Draft content", "rule": "Delete / revise", "tone": "success"},
        {"kind": "Internal tasks", "rule": "Delete task", "tone": "success"},
        {"kind": "CRM", "rule": "Restore previous value", "tone": "accent"},
        {"kind": "Emails", "rule": "Irreversible — warning shown", "tone": "warn"},
        {"kind": "Destructive actions", "rule": "Blocked by default", "tone": "danger"},
    ],
    "REASONING_TRACE": {
        "retention": "90 days", "storage": "EU-West-1",
        "access": ["User", "Workspace Admin", "Security Admin", "Legal Hold"],
        "state": "compliance_critical",
    },
    "SPEND": {
        "current": 412.7, "budget": 2000, "projected": 687, "softCap": 1600, "hardCap": 2000,
        "allocation": [
            {"category": "Meeting Follow-ups", "amount": 800},
            {"category": "ZoikoTime workflows", "amount": 600},
            {"category": "CRM Updates", "amount": 400},
            {"category": "Custom Actions", "amount": 200},
        ],
    },
    "NOTIFICATIONS": {
        "channels": [
            {"key": "desktop", "label": "Desktop", "value": True},
            {"key": "email", "label": "Email", "value": True},
            {"key": "push", "label": "Mobile Push", "value": True},
            {"key": "sms", "label": "SMS", "value": False},
        ],
        "quietHours": {"weekday": "18:00 – 08:00", "weekend": "All day"},
        "focusMode": {"allowed": ["Direct mentions", "P1 escalations"], "exceptions": ["Marcus Chen (CSM)"]},
        "vacation": {"active": False, "dates": "Not set", "suppress": True, "autoReply": "On — \"Out of office, back Monday\""},
        "delegated": [
            {"key": "assistantAccess", "label": "Assistant access", "value": True},
            {"key": "meetingAlerts", "label": "Meeting alerts to delegate", "value": True},
            {"key": "escalations", "label": "Escalations to delegate", "value": False},
        ],
        "categories": [
            {"key": "meetings", "label": "Meetings", "desktop": True, "email": True, "push": True, "sms": False},
            {"key": "messages", "label": "Messages", "desktop": True, "email": False, "push": True, "sms": False},
            {"key": "summaries", "label": "AI summaries", "desktop": True, "email": True, "push": False, "sms": False},
            {"key": "agentic", "label": "Agentic actions", "desktop": True, "email": True, "push": True, "sms": False},
            {"key": "billing", "label": "Billing", "desktop": False, "email": True, "push": False, "sms": False},
            {"key": "security", "label": "Security", "desktop": True, "email": True, "push": True, "sms": True, "state": "compliance_critical"},
        ],
    },
    "CONFIDENTIAL_MODES": [
        {"key": "off", "label": "Off", "desc": "Confidential Mode is never suggested."},
        {"key": "suggest", "label": "Suggest Confidential Mode", "desc": "Prompt when a meeting looks sensitive."},
        {"key": "auto_eligible", "label": "Auto-enable eligible meetings", "desc": "Turn on automatically for eligible meetings."},
        {"key": "auto_groups", "label": "Auto-enable selected groups", "desc": "Turn on for chosen teams or labels."},
        {"key": "strict", "label": "Strict Confidential Mode only", "desc": "All meetings are confidential. No exceptions."},
    ],
    "CURRENT_CONFIDENTIAL": "suggest",
    "CONFIDENTIAL_EFFECTS": ["AI notes disabled", "Cloud recording disabled", "Phone dial-in disabled"],
    "PRIVACY_CARDS": [
        {"key": "residency", "title": "Data Residency", "value": "EU-West-1 (Ireland)", "desc": "Where your meeting data is stored", "state": "tenant_enforced", "action": "Request Exception"},
        {"key": "retention", "title": "Retention", "value": "Recordings 90d · Transcripts 180d", "desc": "How long data is kept", "state": "workspace_inherited", "action": "Configure"},
        {"key": "dsr", "title": "DSR Requests", "value": "2 open · SLA 30 days", "desc": "Data subject access & erasure", "state": "compliance_critical", "action": "Open DSR Console"},
        {"key": "sessions", "title": "Active Sessions", "value": "3 devices", "desc": "Signed-in devices & providers", "state": "user_preference", "action": "Manage"},
        {"key": "controls", "title": "Privacy Controls", "value": "Presence · read receipts · discoverability", "desc": "Who can see your activity", "state": "user_preference", "action": "Configure"},
        {"key": "legal_hold", "title": "Legal Hold Notices", "value": "1 active hold", "desc": "Holds override retention & deletion", "state": "compliance_critical", "action": "View Holds"},
    ],
    "INTEGRATIONS": [
        {"key": "calendar", "title": "Calendar", "desc": "Google & Microsoft calendar sync", "status": "connected", "detail": "Google Workspace"},
        {"key": "crm", "title": "CRM", "desc": "Salesforce & HubSpot", "status": "connected", "detail": "Salesforce"},
        {"key": "webhooks", "title": "Webhooks", "desc": "Outbound event delivery", "status": "connected", "detail": "3 endpoints"},
    ],
    "MCP_SERVERS": [
        {"name": "ZoikoTime MCP", "status": "healthy", "tools": ["create-task", "verify-attendance", "read-workforce-signal"], "scopes": ["read:workforce", "write:tasks"], "actions": ["View Audit", "Rotate Credentials", "Disconnect"]},
        {"name": "Zoiko One MCP", "status": "healthy", "tools": ["create-workflow", "approve-request"], "scopes": ["read:workflows", "write:workflows"], "actions": ["View Audit", "Rotate Credentials", "Disconnect"]},
        {"name": "Salesforce MCP", "status": "reduced_scope", "tools": ["read-opportunity", "update-stage"], "scopes": ["read:crm"], "warning": "Running with reduced scope — some tools disabled", "actions": ["View Audit", "Reconnect", "Disconnect"]},
        {"name": "HubSpot MCP", "status": "expiring", "tools": ["read-contact", "log-activity"], "scopes": ["read:crm", "write:activity"], "warning": "Authorization expires in 6 days", "actions": ["View Audit", "Rotate Credentials", "Reconnect"]},
    ],
    "TELEPHONY": {
        "emergencyAddress": "20 Water St, London EC1, UK",
        "dialRegion": "United Kingdom (+44)",
        "diagnostics": "SIP registered · PSTN healthy · last check 4m ago",
        "state": "compliance_critical",
    },
    "WORKSPACE_DEFAULTS": [
        {"key": "meetingPolicies", "label": "Meeting policies", "value": "Zoiko Standard", "state": "workspace_inherited"},
        {"key": "aiDefaults", "label": "AI defaults", "value": "Draft with Approval (L1)", "state": "workspace_inherited"},
        {"key": "retention", "label": "Retention", "value": "Recordings 90d", "state": "tenant_enforced"},
        {"key": "templates", "label": "Templates", "value": "Zoiko Recommended", "state": "workspace_inherited"},
    ],
    "ACCESSIBILITY": [
        {"key": "textSize", "label": "Text size", "type": "select", "value": "Default", "options": ["Small", "Default", "Large", "Extra large"]},
        {"key": "highContrast", "label": "High contrast", "type": "toggle", "value": False},
        {"key": "reducedMotion", "label": "Reduced motion", "type": "toggle", "value": False},
        {"key": "focusIndicators", "label": "Enhanced focus indicators", "type": "toggle", "value": True},
        {"key": "liveCaptions", "label": "Live captions by default", "type": "toggle", "value": True},
        {"key": "keyboardShortcuts", "label": "Keyboard shortcuts", "type": "toggle", "value": True},
    ],
    "SAFE_TEMPLATES": [
        {"key": "recommended", "label": "Zoiko Recommended", "desc": "Balanced defaults for most teams", "active": True},
        {"key": "healthcare", "label": "Healthcare Safe", "desc": "HIPAA-aligned, recording restricted"},
        {"key": "financial", "label": "Financial Services", "desc": "FINRA/SEC retention & supervision"},
        {"key": "government", "label": "Government", "desc": "Data residency & clearance controls"},
        {"key": "telecom", "label": "Telecom Operator", "desc": "CDR retention & lawful intercept ready"},
        {"key": "eu_first", "label": "EU First", "desc": "EU residency & GDPR-strict defaults"},
    ],
    "IMPORT_SOURCES": ["Zoom", "Microsoft Teams", "Google Meet"],
    "DELEGATIONS": [
        {
            "name": "Maya Chen", "role": "Executive Assistant", "avatarColor": "#7c3aed",
            "can": ["View meetings", "Manage notifications", "Prepare summaries"],
            "cannot": ["Change settings", "Billing", "Private messages"],
            "actions": ["Adjust Permissions", "Revoke", "View Activity"],
        },
    ],
    "RECENT_CHANGES": [
        {"id": "CH-3021", "title": "AI autonomy changed", "detail": "Level 2 → Level 1", "by": "Sarah Adams", "role": "Workspace Admin", "when": "2 days ago", "device": "10.4.2.19 · Chrome", "revertible": True, "section": "AI & Agentic"},
        {"id": "CH-3018", "title": "Spend cap changed", "detail": "Hard cap $1,800 → $2,000", "by": "Sarah Adams", "role": "Billing Admin", "when": "5 days ago", "device": "10.4.2.19 · Chrome", "revertible": True, "section": "AI & Agentic"},
        {"id": "CH-3009", "title": "MCP server added", "detail": "HubSpot MCP connected", "by": "You", "role": "Workspace Owner", "when": "9 days ago", "device": "10.4.2.7 · Safari", "revertible": False, "section": "Integrations"},
    ],
}


@router.get("/overview")
def settings_overview(user: User = Depends(get_current_user)):
    """All Settings content in one payload. `role` lets the client gate
    actions; the Account section merges the live user profile client-side.
    The User model has no free-form role (only is_admin), so map that onto
    the client's role vocabulary."""
    return {"role": "admin" if user.is_admin else "member", **_OVERVIEW}
