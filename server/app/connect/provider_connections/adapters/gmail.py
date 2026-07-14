"""Gmail OAuth + Gmail API adapter (read-only), Phase 3 slice 1.

Same three-plus-one shape as adapters/google.py (Calendar) — provider-
specific network calls live here and nowhere else; mail_service (Phase 3
slice 2) talks to this through exchange_code()/refresh_access_token()/
list_messages(), never to Gmail directly.

Uses a SEPARATE OAuth app (gmail_client_id/secret/redirect_uri) from
google_calendar_* — Gmail restricted scopes are their own Google
verification/CASA review track (spec §7.3); reusing the Calendar app's
client id would conflate two independent scope-review processes.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

from app.connect.provider_connections.adapters.shared import (
    ExchangedTokens,
    RawMessage,
    RefreshedAccessToken,
)
from app.connect.shared.errors import Invalid
from app.core.config import get_settings

_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
_GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
# Read-only per Phase 3 slice 1's own scope — gmail.send is a separate,
# later widening (slice 9); each additional scope re-triggers Google
# verification review (spec §7.3), so scopes are requested minimally and
# incrementally, not all up front.
_SCOPE = "openid email https://www.googleapis.com/auth/gmail.readonly"


def build_authorization_url(state: str) -> str:
    """Build the Gmail consent-screen redirect URL — same access_type=offline
    + prompt=consent requirement as the Calendar adapter, for the same
    reason (a returning user without prompt=consent gets no refresh_token)."""
    settings = get_settings()
    if not (settings.gmail_client_id and settings.gmail_redirect_uri):
        raise Invalid("Gmail OAuth app is not configured")
    params = {
        "client_id": settings.gmail_client_id,
        "redirect_uri": settings.gmail_redirect_uri,
        "response_type": "code",
        "scope": _SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{_AUTHORIZE_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> ExchangedTokens:
    settings = get_settings()
    if not (settings.gmail_client_id and settings.gmail_client_secret):
        raise Invalid("Gmail OAuth app is not configured")

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_resp = await client.post(_TOKEN_URL, data={
            "code": code,
            "client_id": settings.gmail_client_id,
            "client_secret": settings.gmail_client_secret,
            "redirect_uri": settings.gmail_redirect_uri,
            "grant_type": "authorization_code",
        })
        if token_resp.status_code != 200:
            raise Invalid(f"Gmail token exchange failed: {token_resp.text}")
        token_data = token_resp.json()

        refresh_token = token_data.get("refresh_token")
        if not refresh_token:
            raise Invalid("Google did not return a refresh token; retry with prompt=consent")

        userinfo_resp = await client.get(
            _USERINFO_URL, headers={"Authorization": f"Bearer {token_data['access_token']}"},
        )
        if userinfo_resp.status_code != 200:
            raise Invalid(f"Gmail userinfo lookup failed: {userinfo_resp.text}")
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
            "client_id": settings.gmail_client_id,
            "client_secret": settings.gmail_client_secret,
            "grant_type": "refresh_token",
        })
    if resp.status_code != 200:
        raise Invalid(f"Gmail token refresh failed: {resp.text}")
    data = resp.json()
    return RefreshedAccessToken(
        access_token=data["access_token"],
        access_token_expires_at=datetime.now(timezone.utc) + timedelta(seconds=data["expires_in"]),
    )


def _header(headers: list[dict], name: str) -> str | None:
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value")
    return None


def _extract_email(header_value: str) -> str:
    """"Display Name <email@x.com>" -> "email@x.com"; bare addresses pass through."""
    if "<" in header_value and ">" in header_value:
        return header_value.split("<", 1)[1].split(">", 1)[0].strip()
    return header_value.strip()


class HistoryExpired(Exception):
    """Raised when Gmail's history.list rejects a stored history_id as too
    old (its own analogue of Calendar's syncToken 410-Gone, spec §7.1) — the
    caller's recovery is to clear the checkpoint and fall back to a full
    pull via list_messages(), same recovery shape spec'd for Calendar."""


async def _fetch_message(client: httpx.AsyncClient, access_token: str, message_id: str) -> RawMessage:
    detail_resp = await client.get(
        f"{_GMAIL_API}/messages/{message_id}",
        params={"format": "metadata", "metadataHeaders": ["Subject", "From", "To"]},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if detail_resp.status_code != 200:
        raise Invalid(f"Gmail get message failed: {detail_resp.text}")
    detail = detail_resp.json()
    headers = detail.get("payload", {}).get("headers", [])
    from_email = _extract_email(_header(headers, "From") or "")
    to_emails = [_extract_email(e) for e in (_header(headers, "To") or "").split(",") if e.strip()]
    return RawMessage(
        provider_message_id=detail["id"],
        thread_id=detail.get("threadId", detail["id"]),
        subject=_header(headers, "Subject"),
        snippet=detail.get("snippet"),
        from_email=from_email,
        to_emails=to_emails,
        sender_domain=from_email.rsplit("@", 1)[-1] if "@" in from_email else "",
        received_at=datetime.fromtimestamp(int(detail["internalDate"]) / 1000, tz=timezone.utc),
        history_id=detail.get("historyId"),
        label_ids=detail.get("labelIds", []),
    )


async def list_messages_delta(
    access_token: str, *, start_history_id: str,
) -> tuple[list[RawMessage], str | None]:
    """Incremental sync via Gmail's history.list — the mechanism that needs
    a full pull's historyId checkpoint to work at all (unlike Calendar's
    optional syncToken), so it lives in the same slice as list_messages
    rather than a deferred follow-up. Returns (new_or_changed_messages,
    next_history_id). Raises HistoryExpired on a 404 (Gmail's signal that
    start_history_id is too old to resume from — its 410-Gone analogue)."""
    added_ids: set[str] = set()
    next_history_id = start_history_id

    async with httpx.AsyncClient(timeout=15.0) as client:
        page_token: str | None = None
        while True:
            params: dict[str, str] = {"startHistoryId": start_history_id, "historyTypes": "messageAdded"}
            if page_token:
                params["pageToken"] = page_token
            resp = await client.get(
                f"{_GMAIL_API}/history", params=params, headers={"Authorization": f"Bearer {access_token}"},
            )
            if resp.status_code == 404:
                raise HistoryExpired("Gmail history_id is too old; fall back to a full pull")
            if resp.status_code != 200:
                raise Invalid(f"Gmail history.list failed: {resp.text}")
            data = resp.json()

            for entry in data.get("history", []):
                for added in entry.get("messagesAdded", []):
                    added_ids.add(added["message"]["id"])

            if "historyId" in data:
                next_history_id = data["historyId"]
            page_token = data.get("nextPageToken")
            if not page_token:
                break

        messages = [await _fetch_message(client, access_token, mid) for mid in added_ids]
    return messages, next_history_id


async def list_messages(
    access_token: str, *, time_min: datetime | None = None, max_results: int = 100,
) -> list[RawMessage]:
    """Full pull over messages.list + messages.get(format=metadata) — plain
    time-window listing only. Used for the first sync of a connection, or
    to recover after list_messages_delta raises HistoryExpired."""
    messages: list[RawMessage] = []
    query = f"after:{int(time_min.timestamp())}" if time_min else None

    async with httpx.AsyncClient(timeout=15.0) as client:
        page_token: str | None = None
        while True:
            params: dict[str, str] = {"maxResults": str(max_results)}
            if query:
                params["q"] = query
            if page_token:
                params["pageToken"] = page_token
            list_resp = await client.get(
                f"{_GMAIL_API}/messages", params=params, headers={"Authorization": f"Bearer {access_token}"},
            )
            if list_resp.status_code != 200:
                raise Invalid(f"Gmail list messages failed: {list_resp.text}")
            list_data = list_resp.json()

            for stub in list_data.get("messages", []):
                detail_resp = await client.get(
                    f"{_GMAIL_API}/messages/{stub['id']}",
                    params={"format": "metadata", "metadataHeaders": ["Subject", "From", "To"]},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                if detail_resp.status_code != 200:
                    raise Invalid(f"Gmail get message failed: {detail_resp.text}")
                detail = detail_resp.json()
                headers = detail.get("payload", {}).get("headers", [])
                from_email = _extract_email(_header(headers, "From") or "")
                to_emails = [
                    _extract_email(e) for e in (_header(headers, "To") or "").split(",") if e.strip()
                ]
                messages.append(RawMessage(
                    provider_message_id=detail["id"],
                    thread_id=detail.get("threadId", detail["id"]),
                    subject=_header(headers, "Subject"),
                    snippet=detail.get("snippet"),
                    from_email=from_email,
                    to_emails=to_emails,
                    sender_domain=from_email.rsplit("@", 1)[-1] if "@" in from_email else "",
                    received_at=datetime.fromtimestamp(int(detail["internalDate"]) / 1000, tz=timezone.utc),
                    history_id=detail.get("historyId"),
                    label_ids=detail.get("labelIds", []),
                ))

            page_token = list_data.get("nextPageToken")
            if not page_token:
                break
    return messages
