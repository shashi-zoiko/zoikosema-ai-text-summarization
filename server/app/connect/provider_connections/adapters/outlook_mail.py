"""Microsoft Graph (Outlook Mail) OAuth + Mail API adapter (read-only), Phase 3 slice 3.

Same three-plus-two shape as gmail.py — provider-specific network calls live
here and nowhere else; mail_service talks to this through
exchange_code()/refresh_access_token()/list_messages()/list_messages_delta(),
never to Graph directly. Auth follows adapters/outlook.py (Calendar)'s
already-proven Microsoft identity platform pattern.

Uses a SEPARATE Azure AD app (microsoft_mail_client_id/secret/redirect_uri)
from microsoft_calendar_* — Mail.Read is its own admin-consent/review track,
same reasoning as Gmail's separate OAuth app (slice 1).

Unlike Gmail (messages.list + a separate history.list mechanism), Microsoft's
delta query (https://learn.microsoft.com/graph/delta-query-overview) is the
one mechanism Graph recommends for both the initial sync AND incremental
follow-ups: the first call (no token) enumerates current mailbox state page
by page and ends in an @odata.deltaLink; that same deltaLink, called again
later, returns only what changed. So list_messages() (full pull) and
list_messages_delta() (incremental) both page through the same delta
endpoint internally here — this is provider-internal reuse (contained in
this one file), not a cross-adapter abstraction.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
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

_AUTHORITY = "https://login.microsoftonline.com"
_GRAPH = "https://graph.microsoft.com/v1.0"
# Read-only per slice 3's own scope — Mail.Send is a separate, later
# widening (slice 9); each additional scope re-triggers Microsoft admin
# consent review, so scopes are requested minimally and incrementally.
_SCOPE = "offline_access Mail.Read User.Read"
_SELECT = "id,conversationId,subject,bodyPreview,from,toRecipients,receivedDateTime"


def _token_url(tenant: str) -> str:
    return f"{_AUTHORITY}/{tenant}/oauth2/v2.0/token"


def _authorize_url(tenant: str) -> str:
    return f"{_AUTHORITY}/{tenant}/oauth2/v2.0/authorize"


def build_authorization_url(state: str) -> str:
    """Build the Microsoft consent-screen redirect URL for the admin-consent flow."""
    settings = get_settings()
    if not (settings.microsoft_mail_client_id and settings.microsoft_mail_redirect_uri):
        raise Invalid("Microsoft Mail OAuth app is not configured")
    params = {
        "client_id": settings.microsoft_mail_client_id,
        "redirect_uri": settings.microsoft_mail_redirect_uri,
        "response_type": "code",
        "response_mode": "query",
        "scope": _SCOPE,
        "state": state,
    }
    return f"{_authorize_url(settings.microsoft_mail_tenant)}?{urlencode(params)}"


async def exchange_code(code: str) -> ExchangedTokens:
    settings = get_settings()
    if not (settings.microsoft_mail_client_id and settings.microsoft_mail_client_secret):
        raise Invalid("Microsoft Mail OAuth app is not configured")

    async with httpx.AsyncClient(timeout=10.0) as client:
        token_resp = await client.post(_token_url(settings.microsoft_mail_tenant), data={
            "code": code,
            "client_id": settings.microsoft_mail_client_id,
            "client_secret": settings.microsoft_mail_client_secret,
            "redirect_uri": settings.microsoft_mail_redirect_uri,
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
        resp = await client.post(_token_url(settings.microsoft_mail_tenant), data={
            "refresh_token": refresh_token,
            "client_id": settings.microsoft_mail_client_id,
            "client_secret": settings.microsoft_mail_client_secret,
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


class HistoryExpired(Exception):
    """Raised when Graph rejects a stored deltaLink as expired/invalid (410
    Gone, error code resyncRequired) — Outlook's analogue of Gmail's 404 on
    an over-old history_id. The caller's recovery is identical: clear the
    checkpoint and fall back to a full pull via list_messages()."""


def _item_to_raw_message(item: dict, *, delta_link: str | None) -> RawMessage:
    from_email = ((item.get("from") or {}).get("emailAddress") or {}).get("address", "") or ""
    to_emails = [
        (r.get("emailAddress") or {}).get("address")
        for r in item.get("toRecipients", [])
        if (r.get("emailAddress") or {}).get("address")
    ]
    received_raw = item["receivedDateTime"]
    received_at = datetime.fromisoformat(received_raw.replace("Z", "+00:00"))
    return RawMessage(
        provider_message_id=item["id"],
        thread_id=item.get("conversationId") or item["id"],
        subject=item.get("subject"),
        snippet=item.get("bodyPreview"),
        from_email=from_email,
        to_emails=to_emails,
        sender_domain=from_email.rsplit("@", 1)[-1] if "@" in from_email else "",
        received_at=received_at if received_at.tzinfo else received_at.replace(tzinfo=timezone.utc),
        # Every message in a given delta page is stamped with the SAME
        # deltaLink (known only once the last page is reached) — mail_service's
        # generic "advance the checkpoint from raw.history_id" loop treats this
        # as an opaque, monotonically-irrelevant-within-one-run string, same as
        # it does for Gmail's per-message historyId.
        history_id=delta_link,
        label_ids=[],
    )


async def _page_through_delta(client: httpx.AsyncClient, url: str, headers: dict) -> tuple[list[dict], str]:
    """Page through a Graph delta response via @odata.nextLink until the final
    page's @odata.deltaLink is reached. Returns (raw_items, delta_link)."""
    items: list[dict] = []
    delta_link: str | None = None
    params: dict | None = None
    while True:
        resp = await client.get(url, params=params, headers=headers)
        if resp.status_code == 410:
            raise HistoryExpired("Graph delta token is expired/invalid; fall back to a full pull")
        if resp.status_code != 200:
            raise Invalid(f"Graph mail delta failed: {resp.text}")
        data = resp.json()
        items.extend(data.get("value", []))

        if "@odata.deltaLink" in data:
            delta_link = data["@odata.deltaLink"]
            break
        next_link = data.get("@odata.nextLink")
        if not next_link:
            # Defensive: Graph delta responses always carry either nextLink or
            # deltaLink: absence of both means an unexpected/malformed page.
            raise Invalid("Graph mail delta response had neither nextLink nor deltaLink")
        url, params = next_link, None  # nextLink already carries all query params

    return items, delta_link


async def list_messages_delta(
    access_token: str, *, start_history_id: str,
) -> tuple[list[RawMessage], str | None]:
    """Incremental sync via Graph's delta query, resuming from a stored
    deltaLink URL. Returns (new_or_changed_messages, next_delta_link). Raises
    HistoryExpired on a 410 (Graph's signal that start_history_id is too old
    to resume from)."""
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        items, delta_link = await _page_through_delta(client, start_history_id, headers)
    messages = [_item_to_raw_message(item, delta_link=delta_link) for item in items]
    return messages, delta_link


async def list_messages(
    access_token: str, *, time_min: datetime | None = None, max_results: int = 100,
) -> list[RawMessage]:
    """Full pull via delta query's initial (token-less) call — Graph's own
    recommended pattern for a first sync, which conveniently also mints the
    deltaLink used to seed incremental sync from this point forward. A
    time_min filter narrows the initial enumeration the same way Gmail's
    `after:` query does; Graph only accepts $filter on this initial call, not
    on subsequent delta pages."""
    headers = {"Authorization": f"Bearer {access_token}"}
    params: dict[str, str] = {"$select": _SELECT, "$top": str(max_results)}
    if time_min is not None:
        params["$filter"] = f"receivedDateTime ge {time_min.isoformat()}"

    url = f"{_GRAPH}/me/mailFolders('inbox')/messages/delta"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, params=params, headers=headers)
        if resp.status_code != 200:
            raise Invalid(f"Graph mail delta (initial) failed: {resp.text}")
        data = resp.json()
        items = list(data.get("value", []))
        delta_link = data.get("@odata.deltaLink")
        next_link = data.get("@odata.nextLink")
        if delta_link is None:
            # Multi-page initial pull: continue with the shared pager, which
            # doesn't resend $select/$filter (nextLink already carries them).
            more_items, delta_link = await _page_through_delta(client, next_link, headers)
            items.extend(more_items)

    return [_item_to_raw_message(item, delta_link=delta_link) for item in items]


async def get_message_body(access_token: str, message_id: str) -> RawMessageBody:
    """Single-message full-body fetch (Phase 3 slice 4). Unlike Gmail, Graph
    normalizes the body server-side — `body.contentType` is always "html" or
    "text", no MIME tree to walk. Attachment metadata is a separate call
    ($select excludes contentBytes so bytes are never pulled into memory
    server-side — metadata-only is this slice's whole point)."""
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        msg_resp = await client.get(
            f"{_GRAPH}/me/messages/{message_id}",
            params={"$select": "body"},
            headers=headers,
        )
        if msg_resp.status_code != 200:
            raise Invalid(f"Graph get message body failed: {msg_resp.text}")
        body = msg_resp.json().get("body") or {}
        content_type = (body.get("contentType") or "").lower()
        content = body.get("content")

        att_resp = await client.get(
            f"{_GRAPH}/me/messages/{message_id}/attachments",
            params={"$select": "id,name,size,contentType"},
            headers=headers,
        )
        if att_resp.status_code != 200:
            raise Invalid(f"Graph list attachments failed: {att_resp.text}")
        attachments = [
            AttachmentMeta(
                provider_attachment_id=a["id"],
                filename=a.get("name", ""),
                size_bytes=int(a.get("size", 0)),
                content_type=a.get("contentType", ""),
            )
            for a in att_resp.json().get("value", [])
        ]

    html = content if content_type == "html" else None
    text = content if content_type == "text" else None
    return RawMessageBody(html=html, text=text, attachments=attachments)
