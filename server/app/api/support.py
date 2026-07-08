"""Enterprise Support Command Center data.

Serves the Help & Support page's content as a single aggregate payload so the
frontend fetches it at runtime instead of shipping hardcoded JSON. Values are
demo/seed content for now — swap the module-level dicts for real DB / service
queries as those systems land. Keys match the shapes the client consumes.
"""
from fastapi import APIRouter, Depends

from app.core.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/support", tags=["support"])

TRIAGE_CATEGORIES = [
    "Meeting quality", "Audio/video", "Messaging", "AI summaries", "Agentic actions",
    "Confidential Mode", "Workspace admin", "Security & compliance", "Billing",
    "Integrations", "Telephony / PSTN", "Number porting", "Regulatory",
]

_OVERVIEW = {
    "CURRENT_STATUS": "healthy",
    "STATUS_BANDS": {
        "healthy": {
            "tone": "success", "label": "Operational", "title": "All systems operational",
            "lines": ["Enterprise", "P1 response SLA: 4h"],
            "actions": [{"label": "New Case", "kind": "newCase", "variant": "secondary"}],
        },
        "incident": {
            "tone": "warn", "label": "Known incident", "title": "EU media quality degraded",
            "lines": ["Your workspace affected", "Investigating"],
            "actions": [{"label": "View incident", "kind": "viewIncident", "variant": "secondary"}],
        },
        "critical": {
            "tone": "danger", "label": "Critical incident", "title": "Meeting joins failing in us-east-1",
            "lines": ["Workaround available"],
            "actions": [
                {"label": "View incident", "kind": "viewIncident", "variant": "secondary"},
                {"label": "Subscribe", "kind": "subscribe", "variant": "outline"},
            ],
        },
        "limited": {
            "tone": "warn", "label": "Limited access", "title": "Support access limited by your role",
            "lines": ["Some support actions require a workspace admin"],
            "actions": [{"label": "Contact workspace admin", "kind": "contactAdmin", "variant": "secondary"}],
        },
        "managed": {
            "tone": "navy", "label": "Enterprise managed", "title": "Managed under organization policy",
            "lines": ["P1 escalation enabled"],
            "actions": [{"label": "View policy", "kind": "viewPolicy", "variant": "secondary"}],
        },
    },
    "ACCOUNT_TEAM": {
        "policy": "Managed under Zoiko Group support policy",
        "csm": {"name": "Marcus Chen", "role": "Customer Success Manager", "avatarColor": "#2a6bdd"},
        "tam": {"name": "Priya Patel", "role": "Technical Account Manager", "avatarColor": "#7c3aed"},
        "sla": {"tier": "Enterprise", "p1": "4h response", "p2": "8h response", "coverage": "24×7 follow-the-sun"},
    },
    "TRIAGE_CATEGORIES": TRIAGE_CATEGORIES,
    "TRIAGE_RESULT": {
        "area": "Meeting quality",
        "urgency": "P2 — Degraded",
        "workspace": "Your Workspace (us-east-1)",
        "cause": "Regional media relay packet loss",
        "confidence": 82,
        "knownIssues": [
            {"kind": "incident", "text": "INC-2041 — EU media quality degraded", "tone": "warn"},
            {"kind": "deployment", "text": "No recent deployments to your region", "tone": "neutral"},
            {"kind": "policy", "text": "Confidential Mode active — content excluded from diagnostics", "tone": "accent"},
        ],
        "fix": "Switch the affected meeting to the nearest healthy relay (us-west-2) and re-run the meeting diagnostic. This resolves ~78% of regional packet-loss reports.",
    },
    "CASES": [
        {
            "id": "P2-1047", "priority": "P2", "status": "action_required", "owner": "Marcus Chen",
            "escalation": "Tier 1", "slaRemaining": None, "nextUpdate": "Awaiting your reply",
            "activity": "Zoiko replied 2 hours ago",
            "preview": "Please share the meeting ID from Aug 3 so we can pull the media diagnostics.",
            "area": "Meeting quality",
        },
        {
            "id": "P1-1052", "priority": "P1", "status": "in_progress", "owner": "Marcus Chen",
            "escalation": "Escalated to TAM", "slaRemaining": "3h 42m", "nextUpdate": "in 45m",
            "activity": "Escalated to TAM 20 minutes ago",
            "preview": "Investigating elevated join failures for your us-east-1 workspace.",
            "area": "Meeting joins",
        },
        {
            "id": "P3-1039", "priority": "P3", "status": "in_progress", "owner": "Support queue",
            "escalation": "Tier 1", "slaRemaining": "1d 6h", "nextUpdate": "tomorrow 09:00",
            "activity": "You replied yesterday",
            "preview": "Integration webhook retries — logs attached, under review.",
            "area": "Integrations",
        },
    ],
    "RESOLVED_COUNT": 4,
    "CASE_FORMS": {
        "smb": {
            "label": "Standard case",
            "fields": [
                {"name": "summary", "label": "Issue summary", "type": "text", "required": True},
                {"name": "area", "label": "Product area", "type": "select", "options": TRIAGE_CATEGORIES, "required": True},
                {"name": "feature", "label": "Affected feature", "type": "text"},
                {"name": "screenshot", "label": "Screenshot (optional)", "type": "file"},
                {"name": "diagnosticConsent", "label": "Attach diagnostic bundle", "type": "consent"},
            ],
        },
        "enterprise": {
            "label": "Enterprise case",
            "fields": [
                {"name": "summary", "label": "Issue summary", "type": "text", "required": True},
                {"name": "impact", "label": "Business impact", "type": "textarea", "required": True},
                {"name": "affectedUsers", "label": "Affected users", "type": "number"},
                {"name": "workaround", "label": "Workaround status", "type": "select", "options": ["None", "Partial", "In place"]},
                {"name": "urgency", "label": "Urgency", "type": "select", "options": ["P1", "P2", "P3", "P4"], "required": True},
                {"name": "revenueImpact", "label": "Revenue impact", "type": "text"},
                {"name": "incidentId", "label": "Customer incident ID", "type": "text"},
            ],
        },
        "security": {
            "label": "Security / compliance request",
            "fields": [
                {"name": "requestType", "label": "Request type", "type": "select", "options": ["Legal hold", "Data subject request", "Breach notification", "Audit assistance", "Law enforcement"], "required": True},
                {"name": "legalBasis", "label": "Legal basis", "type": "text", "required": True},
                {"name": "jurisdiction", "label": "Jurisdiction", "type": "text", "required": True},
                {"name": "dueDate", "label": "Due date", "type": "date", "required": True},
            ],
        },
        "telecom": {
            "label": "Telecom request",
            "fields": [
                {"name": "component", "label": "Component", "type": "select", "options": ["PSTN", "SIP trunk", "Number porting", "DID", "Carrier route"], "required": True},
                {"name": "region", "label": "Region", "type": "text", "required": True},
                {"name": "did", "label": "Number / DID", "type": "text"},
                {"name": "carrierRoute", "label": "Carrier route", "type": "text"},
                {"name": "cdrRef", "label": "CDR reference", "type": "text"},
            ],
        },
    },
    "BUNDLE": {
        "included": ["Meeting ID", "Region", "Device", "Browser", "App version", "Jitter", "Packet loss", "Bitrate", "Reconnects", "Error codes"],
        "confidentialExcluded": ["Meeting audio", "Video", "Screen share", "Chat messages", "Transcript"],
        "requiresConsent": ["Transcript excerpt", "Screenshot", "Local recording", "Console logs"],
        "neverIncluded": ["Passwords", "Tokens", "API keys", "Payment data", "Private keys"],
    },
    "DIAGNOSTIC_HISTORY": [
        {"id": "DIAG-8842", "when": "Aug 4, 2026 14:22", "result": "Packet loss 4.1% (us-east-1)", "tone": "warn"},
        {"id": "DIAG-8830", "when": "Aug 2, 2026 09:10", "result": "Healthy — no issues detected", "tone": "success"},
        {"id": "DIAG-8811", "when": "Jul 29, 2026 17:48", "result": "Reconnects ×3 — Wi-Fi instability", "tone": "warn"},
    ],
    "AGENTIC_ACTIONS": [
        {
            "id": "AGT-5521", "workflowId": "WF-followup", "title": "Follow-up Draft", "meeting": "Board Strategy Review",
            "connectedSystem": "Email", "approvalMode": "Review before send", "policy": "Allowed", "confidence": 87,
            "canRollback": True, "actions": ["View draft", "View reasoning trace", "Report issue", "Rollback"],
        },
        {
            "id": "AGT-5518", "workflowId": "WF-zoikotime", "title": "ZoikoTime task creation", "meeting": "Engineering Sync",
            "connectedSystem": "ZoikoTime", "approvalMode": "Auto (governed)", "policy": "Allowed", "confidence": 94,
            "detail": "Created 3 engineering tasks", "canRollback": False, "actions": ["View tasks", "View reasoning trace"],
        },
        {
            "id": "AGT-5502", "workflowId": "WF-crm", "title": "CRM Update", "meeting": "Acme Renewal Call",
            "connectedSystem": "Salesforce", "approvalMode": "Auto (governed)", "policy": "Allowed", "confidence": 79,
            "detail": "Updated opportunity stage → Negotiation", "canRollback": True, "actions": ["View change", "Rollback"],
        },
    ],
    "INCIDENT_LIFECYCLE": ["Investigating", "Identified", "Monitoring", "Resolved", "Post-incident review"],
    "INCIDENTS": [
        {
            "id": "INC-2041", "component": "Media relay", "region": "eu-west-1", "severity": "Major",
            "stage": "Investigating", "start": "Aug 4, 2026 13:05", "owner": "SRE on-call",
            "nextUpdate": "in 30m", "workaround": "Route affected meetings via eu-central-1", "affectsYou": True,
        },
        {
            "id": "INC-2038", "component": "Meeting joins", "region": "us-east-1", "severity": "Critical",
            "stage": "Monitoring", "start": "Aug 4, 2026 11:40", "owner": "Platform team",
            "nextUpdate": "in 1h", "workaround": "Retry join or use us-west-2 fallback", "affectsYou": False,
        },
    ],
    "SUBSCRIPTION_CHANNELS": ["Email", "SMS", "Webhook", "Slack / Teams"],
    "SUBSCRIPTION_SCOPES": ["Component", "Region", "Workspace"],
    "COMPLIANCE_PATHS": [
        {"key": "legal_hold", "title": "Legal Hold", "owner": "Legal Ops", "sla": "4h acknowledge", "required": "Case reference, custodians, scope, date range"},
        {"key": "dsr", "title": "Data Subject Request", "owner": "Privacy Office", "sla": "30 days statutory", "required": "Subject identity, request type, jurisdiction"},
        {"key": "breach", "title": "Breach Notification", "owner": "Security IR", "sla": "72h regulatory", "required": "Incident summary, data categories, affected regions"},
        {"key": "audit", "title": "Audit Assistance", "owner": "Compliance", "sla": "5 business days", "required": "Framework (SOC2/ISO), audit window, scope"},
        {"key": "dpia", "title": "DPIA / DPA Support", "owner": "Privacy Office", "sla": "10 business days", "required": "Processing activity, data flows, controller/processor role"},
        {"key": "subprocessor", "title": "Subprocessor Questionnaire", "owner": "Vendor Risk", "sla": "10 business days", "required": "Questionnaire, framework, deadline"},
        {"key": "law_enforcement", "title": "Law Enforcement Request", "owner": "Legal Ops", "sla": "Case-by-case", "required": "Legal basis, jurisdiction, warrant/subpoena reference"},
        {"key": "telecom_reg", "title": "Telecom Regulatory Request", "owner": "Telecom Compliance", "sla": "Per regulator", "required": "Regulator, region, number/DID, CDR reference"},
        {"key": "sec_escalation", "title": "Security Incident Escalation", "owner": "Security IR", "sla": "1h P1", "required": "Indicators, affected assets, severity"},
    ],
    "TRUST_CENTER": {
        "url": "https://trust.zoiko.com",
        "certifications": [
            {"label": "SOC 2 Type II", "status": "Current"},
            {"label": "ISO 27001", "status": "Current"},
            {"label": "GDPR", "status": "Compliant"},
            {"label": "UK DPA", "status": "Compliant"},
            {"label": "Data Residency", "status": "US · EU · UK"},
            {"label": "Subprocessors", "status": "Published"},
        ],
    },
    "RESOURCES": [
        {"key": "status", "title": "Status Subscriptions", "desc": "Subscribe to component & regional status updates", "cta": "Manage subscriptions"},
        {"key": "known", "title": "Known Issues", "desc": "Current known issues and their workarounds", "cta": "View known issues"},
        {"key": "docs", "title": "Docs & Guides", "desc": "Product documentation and admin guides", "cta": "Open docs"},
        {"key": "community", "title": "Community", "desc": "Ask questions and share with other admins", "cta": "Open community"},
        {"key": "training", "title": "Training", "desc": "Onboarding and certification courses", "cta": "Browse training"},
        {"key": "releases", "title": "Release Notes", "desc": "What changed in the latest releases", "cta": "Read release notes"},
    ],
}


@router.get("/overview")
def support_overview(user: User = Depends(get_current_user)):
    """All Help & Support content in one payload. `role` lets the client gate
    actions without a second call. The User model has no free-form role (only
    is_admin), so map that onto the client's role vocabulary."""
    return {"role": "admin" if user.is_admin else "member", **_OVERVIEW}
