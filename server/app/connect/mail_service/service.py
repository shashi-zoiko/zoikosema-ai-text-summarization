"""Mail Service — read-only provider sync + stored-message queries.

Same shape as calendar_service.service.sync_calendar: load connection ->
ensure valid access token -> adapter call -> upsert rows -> one audit row +
one outbox event per sync run (not per message, same "no per-item consumer
yet" reasoning calendar_service already established).

Unlike Calendar, Gmail's incremental mechanism (history.list) requires a
historyId checkpoint minted by a prior full pull, so "full pull" and
"incremental" are two branches of one function here, not a deferred
follow-up the way Calendar's optional syncToken allowed (see
plans/sema-p3-s2-gmail-readonly-sync.md).
"""
from __future__ import annotations

import ipaddress
import socket
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
import nh3
from sqlalchemy.orm import Session as DbSession

from app.connect.audit import service as audit
from app.connect.events import types as etypes
from app.connect.events.bus import publish
from app.connect.events.outbox import enqueue
from app.connect.mail_service.models import MailMessage
from app.connect.provider_connections import service as provider_connections_service
from app.connect.provider_connections.adapters import get_adapter
from app.connect.provider_connections.models import ProviderConnection
from app.connect.shared.envelope import EventEnvelope
from app.connect.shared.errors import Invalid, NotFound
from app.connect.shared.ids import uuid7_str
from app.connect.shared.telemetry import get_correlation_id
from app.connect.shared.tenant import TenantContext

DEFAULT_SYNC_WINDOW_PAST = timedelta(days=30)

# Phase 3 slice 4 — server-side half of the two-layer sanitize (this + the
# client's DOMPurify pass, same allowlist by design so a bypass needs to
# defeat two independent implementations, not one). Email HTML is richer
# than typical user content (tables, inline layout styles) so the allowlist
# is deliberately wider than a comment-box sanitizer's default, but every
# addition here is layout/typography only — nothing that can execute or
# navigate. `url_schemes` excludes `cid:` on purpose: inline-attachment
# images are out of scope for this slice (see plan file) and fall back to
# broken-image + alt text rather than being resolved or passed through raw.
_MAIL_HTML_TAGS = {
    "p", "br", "div", "span", "a", "b", "strong", "i", "em", "u", "s", "strike",
    "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
    "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "pre", "code",
    "sub", "sup", "small", "font", "center",
}
_MAIL_HTML_ATTRIBUTES = {
    "*": {"style", "align", "dir"},
    "a": {"href", "title", "target", "rel"},
    "img": {"src", "alt", "width", "height"},
    "table": {"width", "height", "colspan", "rowspan", "bgcolor", "valign"},
    "td": {"width", "height", "colspan", "rowspan", "bgcolor", "valign"},
    "th": {"width", "height", "colspan", "rowspan", "bgcolor", "valign"},
}
_MAIL_HTML_STYLE_PROPERTIES = {
    "color", "background-color", "font-size", "font-family", "font-weight",
    "font-style", "text-align", "text-decoration", "line-height",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "border", "border-color", "border-width", "border-style",
    "width", "height", "max-width", "max-height", "min-width", "min-height",
    "vertical-align", "white-space",
}
_MAIL_HTML_URL_SCHEMES = {"http", "https", "mailto"}


def _sanitize_mail_html(html: str) -> str:
    return nh3.clean(
        html,
        tags=_MAIL_HTML_TAGS,
        attributes=_MAIL_HTML_ATTRIBUTES,
        filter_style_properties=_MAIL_HTML_STYLE_PROPERTIES,
        url_schemes=_MAIL_HTML_URL_SCHEMES,
        link_rel=None,  # we allowlist "rel" on <a> ourselves; don't let nh3 also manage it
    )


async def sync_mail(db: DbSession, ctx: TenantContext, *, provider: str) -> dict:
    adapter = get_adapter(provider)
    # Incremental-sync convention (duck-typed, same as get_adapter()'s existing
    # style): an adapter opts in by exposing list_messages_delta(access_token,
    # start_history_id=...) -> (messages, next_checkpoint), and a HistoryExpired
    # exception class raised when the stored checkpoint is too old to resume
    # from. Adapters without incremental support (or a not-yet-built Outlook
    # Mail adapter) simply don't define these, and full-pull is used instead.
    list_messages_delta = getattr(adapter, "list_messages_delta", None)
    history_expired = getattr(adapter, "HistoryExpired", None)

    connection = (
        db.query(ProviderConnection)
        .filter(
            ProviderConnection.tenant_id == ctx.tenant_id,
            ProviderConnection.user_id == ctx.user_id,
            ProviderConnection.provider == provider,
            ProviderConnection.status == "active",
        )
        .first()
    )
    if connection is None:
        raise NotFound("No active provider connection for this provider")

    access_token = await provider_connections_service.ensure_valid_access_token(db, connection, adapter)

    mode = "full"
    if list_messages_delta and connection.mail_history_id:
        try:
            raw_messages, next_history_id = await list_messages_delta(
                access_token, start_history_id=connection.mail_history_id,
            )
            mode = "incremental"
        except Exception as exc:
            if history_expired is not None and isinstance(exc, history_expired):
                connection.mail_history_id = None
                raw_messages = None  # fall through to full pull below
            else:
                raise
    else:
        raw_messages = None

    if raw_messages is None:
        now = datetime.now(timezone.utc)
        raw_messages = await adapter.list_messages(access_token, time_min=now - DEFAULT_SYNC_WINDOW_PAST)
        next_history_id = connection.mail_history_id

    created = 0
    updated = 0
    for raw in raw_messages:
        existing = (
            db.query(MailMessage)
            .filter(
                MailMessage.tenant_id == ctx.tenant_id,
                MailMessage.provider_connection_id == connection.id,
                MailMessage.provider_message_id == raw.provider_message_id,
            )
            .first()
        )
        if existing:
            existing.subject = raw.subject
            existing.snippet = raw.snippet
            existing.from_email = raw.from_email
            existing.to_emails = raw.to_emails
            existing.sender_domain = raw.sender_domain
            existing.history_id = raw.history_id
            existing.label_ids = raw.label_ids
            updated += 1
        else:
            db.add(MailMessage(
                id=uuid7_str(),
                tenant_id=ctx.tenant_id,
                user_id=ctx.user_id,
                provider_connection_id=connection.id,
                provider=provider,
                provider_message_id=raw.provider_message_id,
                thread_id=raw.thread_id,
                subject=raw.subject,
                snippet=raw.snippet,
                from_email=raw.from_email,
                to_emails=raw.to_emails,
                sender_domain=raw.sender_domain,
                received_at=raw.received_at,
                history_id=raw.history_id,
                label_ids=raw.label_ids,
                correlation_id=get_correlation_id(),
            ))
            created += 1

        if raw.history_id and (next_history_id is None or raw.history_id > next_history_id):
            next_history_id = raw.history_id

    if list_messages_delta:
        connection.mail_history_id = next_history_id

    audit.log(
        db, type="mail.sync.completed", tenant_id=ctx.tenant_id,
        actor_user_id=ctx.user_id, resource_type="provider_connection",
        resource_id=connection.id,
        metadata={"provider": provider, "mode": mode, "fetched": len(raw_messages), "created": created, "updated": updated},
    )
    env = EventEnvelope(
        type=etypes.MAIL_MESSAGE_SYNCED,
        tenant_id=ctx.tenant_id,
        correlation_id=get_correlation_id(),
        actor_user_id=ctx.user_id,
        payload={
            "provider_connection_id": connection.id, "provider": provider, "mode": mode,
            "fetched": len(raw_messages), "created": created, "updated": updated,
        },
    )
    enqueue(db, env)
    db.commit()
    await publish(env, topic=f"provider_connection:{connection.id}")
    return {"mode": mode, "fetched": len(raw_messages), "created": created, "updated": updated}


def list_mail_messages(
    db: DbSession, ctx: TenantContext, *, time_min: datetime | None = None,
) -> list[MailMessage]:
    q = db.query(MailMessage).filter(
        MailMessage.tenant_id == ctx.tenant_id, MailMessage.user_id == ctx.user_id,
    )
    if time_min is not None:
        q = q.filter(MailMessage.received_at >= time_min)
    return q.order_by(MailMessage.received_at.desc()).all()


async def get_message_body(db: DbSession, ctx: TenantContext, message_id: str) -> dict:
    """Phase 3 slice 4 — fetch and sanitize a single message's full body.
    Nothing raw is persisted: the provider is re-fetched on every open, same
    "object-storage-references-only" discipline as the rest of Connect
    (spec §9.3) — there's no reference to store here since we don't store
    the body at all."""
    message = (
        db.query(MailMessage)
        .filter(
            MailMessage.tenant_id == ctx.tenant_id,
            MailMessage.user_id == ctx.user_id,
            MailMessage.id == message_id,
        )
        .first()
    )
    if message is None:
        raise NotFound("Mail message not found")

    connection = (
        db.query(ProviderConnection)
        .filter(
            ProviderConnection.tenant_id == ctx.tenant_id,
            ProviderConnection.id == message.provider_connection_id,
            ProviderConnection.status == "active",
        )
        .first()
    )
    if connection is None:
        raise NotFound("Provider connection for this message is no longer active")

    adapter = get_adapter(message.provider)
    access_token = await provider_connections_service.ensure_valid_access_token(db, connection, adapter)
    raw_body = await adapter.get_message_body(access_token, message.provider_message_id)

    html = _sanitize_mail_html(raw_body.html) if raw_body.html else None
    return {
        "html": html,
        "text": raw_body.text,
        "attachments": [
            {
                "provider_attachment_id": a.provider_attachment_id,
                "filename": a.filename,
                "size_bytes": a.size_bytes,
                "content_type": a.content_type,
            }
            for a in raw_body.attachments
        ],
    }


# ── Image proxy (Phase 3 slice 4) ────────────────────────────────────────
#
# Rewrites remote <img> URLs so the VIEWER's real IP is never exposed to a
# sender-controlled tracking host, and the server, not the browser, is what
# resolves/fetches the URL — this is the whole point of a proxy, and it's
# also a real SSRF surface: an attacker-controlled URL fetched server-side
# could otherwise target internal infra (cloud metadata endpoints, internal
# services). Every hop (initial URL AND any redirect target) is validated
# before being fetched — validating only the first URL is not sufficient,
# since a public-looking URL can 302 to an internal one.

_IMAGE_PROXY_MAX_REDIRECTS = 3
_IMAGE_PROXY_MAX_BYTES = 5 * 1024 * 1024
_IMAGE_PROXY_TIMEOUT = 10.0


def _validate_proxy_target(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise Invalid("Image proxy only supports http/https URLs")
    if not parsed.hostname:
        raise Invalid("Image proxy URL has no host")

    try:
        addrinfo = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise Invalid("Image proxy URL host could not be resolved") from exc

    for family, _, _, _, sockaddr in addrinfo:
        ip = ipaddress.ip_address(sockaddr[0])
        if (
            ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_multicast or ip.is_reserved or ip.is_unspecified
        ):
            raise Invalid("Image proxy URL resolves to a non-public address")


async def fetch_proxied_image(url: str) -> tuple[bytes, str]:
    """Validate then fetch an image URL server-side. Returns (bytes,
    content_type). Manually follows redirects (httpx auto-follow disabled)
    so each hop gets the same private-IP validation as the initial URL."""
    current_url = url
    async with httpx.AsyncClient(timeout=_IMAGE_PROXY_TIMEOUT, follow_redirects=False) as client:
        for _ in range(_IMAGE_PROXY_MAX_REDIRECTS + 1):
            _validate_proxy_target(current_url)
            resp = await client.get(current_url)
            if resp.status_code in (301, 302, 303, 307, 308):
                location = resp.headers.get("location")
                if not location:
                    raise Invalid("Image proxy target redirected with no Location header")
                current_url = location
                continue
            if resp.status_code != 200:
                raise Invalid(f"Image proxy fetch failed: {resp.status_code}")

            content_type = resp.headers.get("content-type", "")
            if not content_type.startswith("image/"):
                raise Invalid("Image proxy target is not an image")
            if len(resp.content) > _IMAGE_PROXY_MAX_BYTES:
                raise Invalid("Image proxy target exceeds size limit")
            return resp.content, content_type

    raise Invalid("Image proxy exceeded max redirects")
