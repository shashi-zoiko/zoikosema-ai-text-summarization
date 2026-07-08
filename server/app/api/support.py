"""Help & Support.

Serves a real, minimal support surface: live system status, the current user's
account/workspace, product FAQs, and the user's own support cases (persisted in
the support_cases table). No fabricated agents, incidents, or SLAs.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.organization import Organization, OrganizationMember
from app.models.support import SupportCase
from app.models.user import User

router = APIRouter(prefix="/api/support", tags=["support"])

# Categories a case can be filed under — also the FAQ topic set. Real product
# areas; kept in code because it's fixed help taxonomy, not per-user data.
CATEGORIES = [
    "Meetings", "Audio & video", "Recordings", "AI summaries",
    "Chat & messaging", "Account & billing", "Other",
]

# Product help content. Static copy by nature (like docs) — not fabricated data.
FAQS = [
    {"q": "How do I start an instant meeting?",
     "a": "From the home page, click “Start meeting” on the instant-meeting card. Use the dropdown arrow beside it to create a meeting for later or schedule one instead."},
    {"q": "Where do I find my recordings?",
     "a": "Open Recordings from the left sidebar. Meetings you recorded are listed there and can be replayed, downloaded, or shared."},
    {"q": "How are AI summaries generated?",
     "a": "When AI summaries are enabled for a meeting, the transcript is processed after the meeting ends and a summary with action items appears under AI Summaries."},
    {"q": "How do I invite people to my workspace?",
     "a": "Use “Invite people” on the home page, or go to People and send an invite by email. Invitees get a link to join your workspace."},
    {"q": "Can I join a meeting with just a code?",
     "a": "Yes. Click “Join by code” on the home page and enter the meeting code you were given."},
    {"q": "How do I contact support?",
     "a": "Open a support case below. Describe your issue and pick a category — we’ll follow up on it."},
]


class CaseCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=200)
    category: str = Field(min_length=1, max_length=60)
    message: str = Field(min_length=5, max_length=5000)


def _case_dict(c: SupportCase) -> dict:
    return {
        "id": c.id,
        "subject": c.subject,
        "category": c.category,
        "message": c.message,
        "status": c.status,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _workspace_name(db: Session, user: User) -> str | None:
    """The user's org name via their most recent membership, if any."""
    org = db.scalar(
        select(Organization)
        .join(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .where(OrganizationMember.user_id == user.id)
        .order_by(OrganizationMember.joined_at.desc())
        .limit(1)
    )
    return org.name if org else None


@router.get("/overview")
def support_overview(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    cases = db.scalars(
        select(SupportCase)
        .where(SupportCase.user_id == user.id)
        .order_by(SupportCase.created_at.desc())
    ).all()
    return {
        # If this endpoint is answering, the API is up — report it honestly.
        "status": {"state": "operational", "checkedAt": datetime.now(timezone.utc).isoformat()},
        "account": {
            "name": user.name,
            "email": user.email,
            "role": "Admin" if user.is_admin else "Member",
            "workspace": _workspace_name(db, user),
        },
        "categories": CATEGORIES,
        "faqs": FAQS,
        "cases": [_case_dict(c) for c in cases],
    }


@router.post("/cases", status_code=201)
def create_case(
    payload: CaseCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    case = SupportCase(
        user_id=user.id,
        subject=payload.subject.strip(),
        category=payload.category.strip(),
        message=payload.message.strip(),
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return _case_dict(case)
