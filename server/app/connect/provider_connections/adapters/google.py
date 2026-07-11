"""Google Calendar OAuth adapter — authorization-code exchange only.

Provider-specific network calls live here and nowhere else in this module;
service.py talks to this through `exchange_code()`, not to Google directly.
Calendar sync itself (the next slice) adds its own adapter file alongside
this one following the same shape.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

from app.connect.shared.errors import Invalid
from app.core.config import get_settings

_TOKEN_URL = "https://oauth2.googleapis.com/token"
_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


@dataclass(frozen=True)
class ExchangedTokens:
    refresh_token: str
    access_token: str
    access_token_expires_at: datetime
    scopes: list[str]
    account_email: str


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
