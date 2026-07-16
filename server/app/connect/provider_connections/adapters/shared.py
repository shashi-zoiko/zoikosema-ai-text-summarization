"""Provider-agnostic result shapes shared by every adapter.

Each adapter (google.py, outlook.py, ...) maps its own provider's wire
format onto these; service.py and calendar_service only ever see these
shapes, never a provider-specific payload.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class ExchangedTokens:
    refresh_token: str
    access_token: str
    access_token_expires_at: datetime
    scopes: list[str]
    account_email: str


@dataclass(frozen=True)
class RefreshedAccessToken:
    access_token: str
    access_token_expires_at: datetime


@dataclass(frozen=True)
class RawEvent:
    provider_event_id: str
    title: str | None
    description: str | None
    location: str | None
    start_at: datetime | None
    end_at: datetime | None
    all_day: bool
    status: str
    attendees: list[dict[str, Any]]


@dataclass(frozen=True)
class RawMessage:
    """Mail's equivalent of RawEvent (Phase 3 slice 1) — provider adapters
    (gmail.py, outlook_mail.py) map their own wire format onto this; mail_service
    only ever sees this shape. Headers/metadata/snippet only, no body — full
    body fetch is Phase 3 slice 4's job, deliberately separate (that's the
    slice that has to exist before any HTML is ever rendered)."""
    provider_message_id: str
    thread_id: str
    subject: str | None
    snippet: str | None
    from_email: str
    to_emails: list[str]
    sender_domain: str
    received_at: datetime
    history_id: str | None
    label_ids: list[str]


@dataclass(frozen=True)
class AttachmentMeta:
    """Metadata only — no bytes. Phase 3 slice 4 surfaces this so the client
    can show what's attached; download/preview is explicitly deferred to a
    later slice pending malware-scanning integration (spec's Build/Integrate
    table treats scanning as an Integrate-a-vendor item, not build-here)."""
    provider_attachment_id: str
    filename: str
    size_bytes: int
    content_type: str


@dataclass(frozen=True)
class RawMessageBody:
    """Phase 3 slice 4 — a single message's body, provider-normalized but
    NOT YET sanitized: `html` here is raw provider output. mail_service is
    the one place that sanitizes it (nh3) before it ever leaves the server —
    adapters and this dataclass only handle provider wire-format mapping."""
    html: str | None
    text: str | None
    attachments: list[AttachmentMeta]
