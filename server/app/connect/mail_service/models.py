"""connect_mail_messages model.

DDL is the source of truth (see migrations/connect_v3_012_mail_messages.sql);
this is a thin SQLAlchemy mapping that only INSERT/UPDATE rows.

MailMessage is plain synced data from Gmail/Outlook (Phase 3 slice 2), not a
Work Graph node — same class as calendar_service.models.CalendarEvent, not
append-only. Headers/metadata/snippet only; body content is slice 4's job.
"""
from __future__ import annotations

from sqlalchemy import BigInteger, Column, DateTime, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.connect.shared.base import ConnectBase


class MailMessage(ConnectBase):
    __tablename__ = "connect_mail_messages"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    user_id = Column(BigInteger, nullable=False)
    provider_connection_id = Column(UUID(as_uuid=False), nullable=False)
    provider = Column(String, nullable=False)
    provider_message_id = Column(String, nullable=False)
    thread_id = Column(String, nullable=False)
    subject = Column(String, nullable=True)
    snippet = Column(String, nullable=True)
    from_email = Column(String, nullable=False)
    to_emails = Column(JSONB, nullable=False, default=list)
    sender_domain = Column(String, nullable=False, default="")
    received_at = Column(DateTime(timezone=True), nullable=False)
    history_id = Column(String, nullable=True)
    label_ids = Column(JSONB, nullable=False, default=list)
    correlation_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))


MAIL_SEND_STATUSES = ("buffered", "cancelled", "released", "failed")


class MailSend(ConnectBase):
    """connect_mail_sends — DDL is migrations/connect_v3_015_mail_sends.sql.

    Phase 3 slice 9 (send/reply/forward, delayed-send buffer, L3). Ordinary
    mutable table (status transitions), not append-only — a buffered send
    resolves to cancelled/released/failed exactly once, no version chain.
    """
    __tablename__ = "connect_mail_sends"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    user_id = Column(BigInteger, nullable=False)
    provider_connection_id = Column(UUID(as_uuid=False), nullable=False)
    provider = Column(String, nullable=False)
    draft_payload = Column(JSONB, nullable=False)
    dlp_verdict = Column(JSONB, nullable=False, default=dict)
    scheduled_release_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(String, nullable=False, default="buffered")
    provider_message_id = Column(String, nullable=True)
    failure_reason = Column(String, nullable=True)
    correlation_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))


ASSIGNMENT_STATUSES = ("open", "done")


class MailAssignment(ConnectBase):
    """connect_mail_assignments — DDL is migrations/connect_v3_019_mail_assignments.sql.

    Phase 4 slice 2. Exactly one current assignment per message (reassigned
    in place, not versioned) — see assignments.py's module docstring for
    the spec §1.2 non-goal boundary this table must stay inside.
    """
    __tablename__ = "connect_mail_assignments"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    message_id = Column(UUID(as_uuid=False), nullable=False)
    assigned_to_user_id = Column(BigInteger, nullable=False)
    assigned_by_user_id = Column(BigInteger, nullable=False)
    status = Column(String, nullable=False, default="open")
    correlation_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))


class MailNote(ConnectBase):
    """connect_mail_notes — DDL is migrations/connect_v3_020_mail_notes.sql.

    Phase 4 slice 2. Append-only — a note is never edited/deleted, a
    correction is a new note.
    """
    __tablename__ = "connect_mail_notes"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=False), primary_key=True)
    tenant_id = Column(String, nullable=False)
    message_id = Column(UUID(as_uuid=False), nullable=False)
    author_user_id = Column(BigInteger, nullable=False)
    body = Column(String, nullable=False)
    correlation_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
