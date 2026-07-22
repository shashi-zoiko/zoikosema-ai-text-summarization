import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from sqlalchemy.orm import Session

from app.models.support_ticket import SupportTicket

log = logging.getLogger(__name__)


class SupportTicketStatus(str, Enum):
    NOT_REQUESTED = "not_requested"
    EMAIL_SENDING = "email_sending"
    EMAIL_SENT = "email_sent"
    WAITING_FOR_SPECIALIST = "waiting_for_specialist"
    SPECIALIST_ASSIGNED = "specialist_assigned"
    ACTIVE_CHAT = "active_chat"
    CLOSED = "closed"


def _generate_ticket_id(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    last = db.query(SupportTicket).order_by(SupportTicket.id.desc()).first()
    seq = (last.id + 1) if last else 1
    return f"ZS-{year}-{seq:06d}"


def request_handoff(
    db: Session,
    user_id: int,
    user_email: str,
    user_name: str = "",
    message: str = "",
) -> SupportTicket:
    ticket_id = _generate_ticket_id(db)
    ticket = SupportTicket(
        ticket_id=ticket_id,
        user_id=user_id,
        user_email=user_email,
        user_name=user_name,
        status=SupportTicketStatus.EMAIL_SENDING.value,
        message=message,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    log.info("Support ticket %s created for user %s", ticket_id, user_id)
    return ticket


def get_active_ticket(db: Session, user_id: int) -> Optional[SupportTicket]:
    return (
        db.query(SupportTicket)
        .filter(
            SupportTicket.user_id == user_id,
            SupportTicket.status.in_([
                SupportTicketStatus.EMAIL_SENDING.value,
                SupportTicketStatus.EMAIL_SENT.value,
                SupportTicketStatus.WAITING_FOR_SPECIALIST.value,
                SupportTicketStatus.SPECIALIST_ASSIGNED.value,
                SupportTicketStatus.ACTIVE_CHAT.value,
            ]),
        )
        .order_by(SupportTicket.id.desc())
        .first()
    )


def update_ticket_status(
    db: Session,
    ticket_id: str,
    status: SupportTicketStatus,
) -> Optional[SupportTicket]:
    ticket = db.query(SupportTicket).filter(SupportTicket.ticket_id == ticket_id).first()
    if ticket:
        ticket.status = status.value
        ticket.updated_at = datetime.now(timezone.utc)
        if status == SupportTicketStatus.CLOSED:
            ticket.closed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(ticket)
    return ticket


def mark_email_sent(db: Session, ticket_id: str) -> Optional[SupportTicket]:
    return update_ticket_status(db, ticket_id, SupportTicketStatus.EMAIL_SENT)
