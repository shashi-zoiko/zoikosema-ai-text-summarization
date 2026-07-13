"""Google Calendar OAuth + Calendar API adapter.

Provider-specific network calls live here and nowhere else in this module;
service.py talks to this through `exchange_code()` / `refresh_access_token()`
/ `list_events()`, not to Google directly.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from app.connect.provider_connections.adapters.shared import (
    ExchangedTokens,
    RawEvent,
    RefreshedAccessToken,
)
from app.connect.shared.errors import Invalid
from app.core.config import get_settings

_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
# Read-only per Phase 1 scope (CONTEXT.md §2) — sync never writes to Google.
_SCOPE = "openid email https://www.googleapis.com/auth/calendar.readonly"


def build_authorization_url(state: str) -> str:
    """Build the Google consent-screen redirect URL for the admin-consent flow.

    access_type=offline + prompt=consent are required so Google actually
    returns a refresh_token — without them a returning user (who already
    granted consent once) gets none, which is exactly the failure
    exchange_code() already guards against.
    """
    settings = get_settings()
    if not (settings.google_calendar_client_id and settings.google_calendar_redirect_uri):
        raise Invalid("Google Calendar OAuth app is not configured")
    params = {
        "client_id": settings.google_calendar_client_id,
        "redirect_uri": settings.google_calendar_redirect_uri,
        "response_type": "code",
        "scope": _SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> ExchangedTokens:
    settings = get_settings()
    if not (settings.google_calendar_client_id and settings.google_calendar_client_secret):
        raise Invalid("Google Calendar OAuth app is not configured")

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_resp = await client.post(_TOKEN_URL, data={
            "code": code,
            "client_id": settings.google_calendar_client_id,
            "client_secret": settings.google_calendar_client_secret,
            "redirect_uri": settings.google_calendar_redirect_uri,
            "grant_type": "authorization_code",
        })
        if token_resp.status_code != 200:
            raise Invalid(f"Google token exchange failed: {token_resp.text}")
        token_data = token_resp.json()

        refresh_token = token_data.get("refresh_token")
        if not refresh_token:
            # Google omits refresh_token on repeat consent without prompt=consent.
            raise Invalid("Google did not return a refresh token; retry with prompt=consent")

        userinfo_resp = await client.get(
            _USERINFO_URL, headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        if userinfo_resp.status_code != 200:
            raise Invalid(f"Google userinfo lookup failed: {userinfo_resp.text}")
        account_email = userinfo_resp.json().get("email", "")

    return ExchangedTokens(
        refresh_token=refresh_token,
        access_token=token_data["access_token"],
        access_token_expires_at=datetime.now(timezone.utc) + timedelta(seconds=token_data["expires_in"]),
        scopes=token_data.get("scope", "").split(),
        account_email=account_email,
    )


async def refresh_access_token(refresh_token: str) -> RefreshedAccessToken:
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(_TOKEN_URL, data={
            "refresh_token": refresh_token,
            "client_id": settings.google_calendar_client_id,
            "client_secret": settings.google_calendar_client_secret,
            "grant_type": "refresh_token",
        })
    if resp.status_code != 200:
        raise Invalid(f"Google token refresh failed: {resp.text}")
    data = resp.json()
    return RefreshedAccessToken(
        access_token=data["access_token"],
        access_token_expires_at=datetime.now(timezone.utc) + timedelta(seconds=data["expires_in"]),
    )


def _parse_when(when: dict[str, Any]) -> tuple[datetime | None, bool]:
    if "date" in when:
        # All-day events give a bare date, not a dateTime; midnight UTC is a
        # placeholder — display code must treat all_day events specially,
        # not read start_at as a real instant.
        return datetime.fromisoformat(when["date"]).replace(tzinfo=timezone.utc), True
    if "dateTime" in when:
        return datetime.fromisoformat(when["dateTime"]), False
    return None, False


_STATUS_MAP = {"confirmed": "confirmed", "tentative": "tentative", "cancelled": "cancelled"}


async def list_events(access_token: str, *, time_min: datetime, time_max: datetime) -> list[RawEvent]:
    events: list[RawEvent] = []
    page_token: str | None = None
    async with httpx.AsyncClient(timeout=15.0) as client:
        while True:
            params = {
                "timeMin": time_min.isoformat(),
                "timeMax": time_max.isoformat(),
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": "250",
            }
            if page_token:
                params["pageToken"] = page_token
            resp = await client.get(
                _EVENTS_URL, params=params, headers={"Authorization": f"Bearer {access_token}"},
            )
            if resp.status_code != 200:
                raise Invalid(f"Google Calendar list events failed: {resp.text}")
            data = resp.json()
            for item in data.get("items", []):
                start_at, all_day = _parse_when(item.get("start", {}))
                end_at, _ = _parse_when(item.get("end", {}))
                events.append(RawEvent(
                    provider_event_id=item["id"],
                    title=item.get("summary"),
                    description=item.get("description"),
                    location=item.get("location"),
                    start_at=start_at,
                    end_at=end_at,
                    all_day=all_day,
                    status=_STATUS_MAP.get(item.get("status", "confirmed"), "confirmed"),
                    attendees=[
                        {"email": a.get("email"), "response_status": a.get("responseStatus")}
                        for a in item.get("attendees", [])
                    ],
                ))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
    return events
