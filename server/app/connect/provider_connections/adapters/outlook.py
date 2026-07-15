"""Microsoft Graph (Outlook Calendar) OAuth + Calendar API adapter.

Same shape as adapters/google.py — this is the second provider that proves
the adapter interface (exchange_code / refresh_access_token / list_events)
is actually generic, not Google-shaped. Provider-specific network calls
live here and nowhere else in this module.
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

_AUTHORITY = "https://login.microsoftonline.com"
_GRAPH = "https://graph.microsoft.com/v1.0"
# Read-only per Phase 1 scope (CONTEXT.md §2) — used consistently across
# authorize/exchange/refresh so a scope drift can't leave a token that was
# granted one set of permissions but requested to refresh with another.
_SCOPE = "offline_access Calendars.Read User.Read"


def _token_url(tenant: str) -> str:
    return f"{_AUTHORITY}/{tenant}/oauth2/v2.0/token"


def _authorize_url(tenant: str) -> str:
    return f"{_AUTHORITY}/{tenant}/oauth2/v2.0/authorize"


def build_authorization_url(state: str) -> str:
    """Build the Microsoft consent-screen redirect URL for the admin-consent flow."""
    settings = get_settings()
    if not (settings.microsoft_calendar_client_id and settings.microsoft_calendar_redirect_uri):
        raise Invalid("Microsoft Calendar OAuth app is not configured")
    params = {
        "client_id": settings.microsoft_calendar_client_id,
        "redirect_uri": settings.microsoft_calendar_redirect_uri,
        "response_type": "code",
        "response_mode": "query",
        "scope": _SCOPE,
        "state": state,
    }
    return f"{_authorize_url(settings.microsoft_calendar_tenant)}?{urlencode(params)}"


async def exchange_code(code: str) -> ExchangedTokens:
    settings = get_settings()
    if not (settings.microsoft_calendar_client_id and settings.microsoft_calendar_client_secret):
        raise Invalid("Microsoft Calendar OAuth app is not configured")

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_resp = await client.post(_token_url(settings.microsoft_calendar_tenant), data={
            "code": code,
            "client_id": settings.microsoft_calendar_client_id,
            "client_secret": settings.microsoft_calendar_client_secret,
            "redirect_uri": settings.microsoft_calendar_redirect_uri,
            "grant_type": "authorization_code",
            "scope": _SCOPE,
        })
        if token_resp.status_code != 200:
            raise Invalid(f"Microsoft token exchange failed: {token_resp.text}")
        token_data = token_resp.json()

        refresh_token = token_data.get("refresh_token")
        if not refresh_token:
            raise Invalid("Microsoft did not return a refresh token; scope must include offline_access")

        me_resp = await client.get(
            f"{_GRAPH}/me", headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        if me_resp.status_code != 200:
            raise Invalid(f"Microsoft Graph /me lookup failed: {me_resp.text}")
        me = me_resp.json()
        account_email = me.get("mail") or me.get("userPrincipalName") or ""

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
        resp = await client.post(_token_url(settings.microsoft_calendar_tenant), data={
            "refresh_token": refresh_token,
            "client_id": settings.microsoft_calendar_client_id,
            "client_secret": settings.microsoft_calendar_client_secret,
            "grant_type": "refresh_token",
            "scope": _SCOPE,
        })
    if resp.status_code != 200:
        raise Invalid(f"Microsoft token refresh failed: {resp.text}")
    data = resp.json()
    return RefreshedAccessToken(
        access_token=data["access_token"],
        access_token_expires_at=datetime.now(timezone.utc) + timedelta(seconds=data["expires_in"]),
    )


def _parse_graph_datetime(field: dict[str, Any] | None) -> datetime | None:
    if not field or not field.get("dateTime"):
        return None
    # Graph returns naive dateTime + a separate IANA timeZone field (default
    # "UTC" when the calendar's dateTimeTimeZone preference is UTC, which is
    # what we request implicitly by not setting Prefer: outlook.timezone).
    raw = field["dateTime"]
    dt = datetime.fromisoformat(raw)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def list_events(access_token: str, *, time_min: datetime, time_max: datetime) -> list[RawEvent]:
    events: list[RawEvent] = []
    url = f"{_GRAPH}/me/calendarview"
    params = {
        "startDateTime": time_min.isoformat(),
        "endDateTime": time_max.isoformat(),
        "$orderby": "start/dateTime",
        "$top": "250",
    }
    headers = {"Authorization": f"Bearer {access_token}", "Prefer": 'outlook.timezone="UTC"'}
    async with httpx.AsyncClient(timeout=15.0) as client:
        while url:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code != 200:
                raise Invalid(f"Microsoft Graph calendarView failed: {resp.text}")
            data = resp.json()
            for item in data.get("value", []):
                events.append(RawEvent(
                    provider_event_id=item["id"],
                    title=item.get("subject"),
                    description=(item.get("bodyPreview") or None),
                    location=(item.get("location") or {}).get("displayName"),
                    start_at=_parse_graph_datetime(item.get("start")),
                    end_at=_parse_graph_datetime(item.get("end")),
                    all_day=bool(item.get("isAllDay")),
                    status="cancelled" if item.get("isCancelled") else "confirmed",
                    attendees=[
                        {
                            "email": (a.get("emailAddress") or {}).get("address"),
                            "response_status": (a.get("status") or {}).get("response"),
                        }
                        for a in item.get("attendees", [])
                    ],
                ))
            # Graph pagination is a full next-page URL, already carrying the
            # query params — must not resend `params` on subsequent requests.
            url = data.get("@odata.nextLink")
            params = None
    return events
