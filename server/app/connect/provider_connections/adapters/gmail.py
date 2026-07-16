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

import base64
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from urllib.parse import urlencode

import httpx

from app.connect.provider_connections.adapters.shared import (
    AttachmentMeta,
    ExchangedTokens,
    RawMessage,
    RawMessageBody,
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


def _walk_mime_parts(payload: dict) -> tuple[str | None, str | None, list[AttachmentMeta]]:
    """Depth-first walk of Gmail's nested MIME `payload` tree. Returns
    (html, text, attachments) — first text/html and first text/plain part
    found win (multipart/alternative puts the "best" version last per RFC,
    but real-world messages are inconsistent enough that first-found is the
    pragmatic choice here, same as most mail clients' actual behavior)."""
    html: str | None = None
    text: str | None = None
    attachments: list[AttachmentMeta] = []

    def visit(part: dict) -> None:
        nonlocal html, text
        mime_type = part.get("mimeType", "")
        filename = part.get("filename") or ""
        body = part.get("body", {})

        if filename and body.get("attachmentId"):
            attachments.append(AttachmentMeta(
                provider_attachment_id=body["attachmentId"],
                filename=filename,
                size_bytes=int(body.get("size", 0)),
                content_type=mime_type,
            ))
        elif mime_type == "text/html" and html is None and body.get("data"):
            html = base64.urlsafe_b64decode(body["data"] + "==").decode("utf-8", errors="replace")
        elif mime_type == "text/plain" and text is None and body.get("data"):
            text = base64.urlsafe_b64decode(body["data"] + "==").decode("utf-8", errors="replace")

        for sub_part in part.get("parts", []):
            visit(sub_part)

    visit(payload)
    return html, text, attachments


async def get_message_body(access_token: str, message_id: str) -> RawMessageBody:
    """Full-format fetch for a single message — separate from list_messages'
    metadata-only fetch since body content is materially larger and only
    needed when a user actually opens a message (Phase 3 slice 4)."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{_GMAIL_API}/messages/{message_id}",
            params={"format": "full"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if resp.status_code != 200:
        raise Invalid(f"Gmail get message body failed: {resp.text}")
    payload = resp.json().get("payload", {})
    html, text, attachments = _walk_mime_parts(payload)
    return RawMessageBody(html=html, text=text, attachments=attachments)


async def send_message(
    access_token: str, *, to_emails: list[str], subject: str, body_text: str,
    thread_id: str | None = None, in_reply_to_message_id: str | None = None,
) -> str:
    """Gmail messages.send (Phase 3 slice 9) — the first WRITE this adapter
    makes; every function above is read-only per slice 1's own scope. This
    is a real, external, non-code dependency (spec §7.3): the gmail.send
    scope is a widening beyond _SCOPE above, and Google requires a fresh
    consent grant per connection — an existing gmail.readonly connection's
    stored access_token will 403 here until the user reconnects with the
    wider scope. That reconnect flow (adding gmail.send to
    build_authorization_url) is a deliberate follow-up, not built here, so
    existing read-only connections aren't silently re-scoped without the
    user's own re-consent.
    """
    mime = MIMEText(body_text)
    mime["To"] = ", ".join(to_emails)
    mime["Subject"] = subject
    if in_reply_to_message_id:
        mime["In-Reply-To"] = in_reply_to_message_id
        mime["References"] = in_reply_to_message_id
    raw = base64.urlsafe_b64encode(mime.as_bytes()).decode("ascii").rstrip("=")

    body: dict = {"raw": raw}
    if thread_id:
        body["threadId"] = thread_id

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{_GMAIL_API}/messages/send", json=body,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if resp.status_code not in (200, 202):
        raise Invalid(f"Gmail send failed: {resp.text}")
    return resp.json().get("id", "")
