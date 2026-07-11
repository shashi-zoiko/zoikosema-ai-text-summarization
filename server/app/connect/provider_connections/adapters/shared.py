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
