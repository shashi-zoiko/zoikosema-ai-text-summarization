"""Best-effort audit bridge for LEGACY meeting privileged actions (ZS-MTG-IMP-04).

The legacy meeting plane (app/api/meetings.py, app/websocket/signaling.py) predates
the Zoiko Connect governance spine and is not yet a `connect.session_service`, so it
can't do the governed same-transaction audit those services do. This bridge lets the
legacy endpoints still emit to the same immutable audit ledger
(`connect.audit.service`) without risking the critical admission/role paths:

  • It resolves the actor's tenant (org, or the synthetic `personal:{id}` for solo
    users) and appends ONE audit event in its OWN transaction, AFTER the caller has
    already committed the real mutation.
  • It NEVER raises: any failure (missing tenant tables, RLS, etc.) is swallowed and
    logged, so auditing can never break admitting a guest or changing a role.
  • It stores ONLY opaque identifiers (meeting id, numeric user ids) + an action verb
    and counts — never names, emails, messages, media or avatars (spec §Audit).

The governed same-transaction path is the target once meetings migrate onto
`connect.session_service`; this bridge is the interim, non-breaking retrofit.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.connect.audit import service as audit
from app.connect.shared.tenant import resolve_tenant
from app.models.user import User

log = logging.getLogger(__name__)

# Canonical audit event types for meeting privileged actions.
ADMIT = "meeting.admission.admit"
DENY = "meeting.admission.deny"
ADMIT_ALL = "meeting.admission.admit_all"
ROLE_CHANGE = "meeting.role.change"


def audit_meeting_action(
    db: Session,
    *,
    user: Optional[User],
    event_type: str,
    meeting_id: Any,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    """Append one audit event for a meeting privileged action. Best-effort,
    own-transaction, never raises. Call AFTER the mutation has been committed."""
    try:
        ctx = resolve_tenant(db, user)
        audit.log(
            db,
            type=event_type,
            tenant_id=ctx.tenant_id,
            resource_type="meeting",
            resource_id=str(meeting_id),
            actor_user_id=getattr(user, "id", None),
            metadata=metadata or {},
        )
        db.commit()
    except Exception:  # noqa: BLE001 — audit must never break a privileged action
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        log.warning("meeting audit failed (event=%s meeting=%s)", event_type, meeting_id, exc_info=True)
