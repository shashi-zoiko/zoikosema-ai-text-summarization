"""Server-side social / Open Graph metadata injection for the SPA shell.

The frontend is a Vite SPA, so link-preview crawlers (WhatsApp, facebookexternalhit,
LinkedInBot, Discordbot, Slackbot, Twitterbot, Telegram, …) — which do NOT execute
JavaScript — would otherwise only ever see the static tags baked into index.html.

This module rewrites the relevant <head> tags for meeting URLs *before* the HTML
leaves the server, so a shared meeting link unfurls with meeting-specific title /
description / canonical URL. The og:image is unchanged (one branded card for the
whole product, Google-Meet style).

It does string substitution on the built index.html rather than templating so it
stays decoupled from the exact markup — the tags it targets are the ones declared
in client/index.html.
"""

from __future__ import annotations

import html
import re

# Meeting codes are generated as xxx-xxxx-xxx (lowercase ascii + hyphens) by
# api.meetings._generate_code. The first path segment of a meeting URL is the
# code; anything after it (/room-lk, /intelligence, …) is still the same meeting.
_CODE_RE = re.compile(r"^[a-z]{3}-[a-z]{4}-[a-z]{3}$")

_MEETING_TITLE = "ZoikoSema Meeting"
_MEETING_DESC = "Join this ZoikoSema meeting securely in your browser."


def meeting_code_from_path(full_path: str) -> str | None:
    """Return the meeting code if ``full_path`` is a meeting URL, else None."""
    first = full_path.lstrip("/").split("/", 1)[0]
    return first if _CODE_RE.match(first) else None


def _set_meta(doc: str, attr: str, key: str, value: str) -> str:
    """Replace the ``content`` of ``<meta {attr}="{key}" content="...">``."""
    esc = html.escape(value, quote=True)
    pattern = re.compile(
        rf'(<meta {attr}="{re.escape(key)}" content=")[^"]*(")'
    )
    return pattern.sub(lambda m: m.group(1) + esc + m.group(2), doc, count=1)


def _set_title(doc: str, value: str) -> str:
    esc = html.escape(value)
    return re.sub(r"<title>.*?</title>", f"<title>{esc}</title>", doc, count=1, flags=re.S)


def _set_canonical(doc: str, url: str) -> str:
    esc = html.escape(url, quote=True)
    return re.sub(
        r'(<link rel="canonical" href=")[^"]*(")',
        lambda m: m.group(1) + esc + m.group(2),
        doc,
        count=1,
    )


def render_index(base_html: str, full_path: str, base_url: str) -> str:
    """Return index.html with metadata tailored to ``full_path``.

    ``base_url`` is the absolute site origin (no trailing slash), e.g.
    ``https://meet.zoikosema.com`` — used to build absolute canonical / og:url.
    """
    code = meeting_code_from_path(full_path)
    if not code:
        # Non-meeting routes use the static homepage metadata as-is.
        return base_html

    title = f"{_MEETING_TITLE} – ZoikoSema"
    url = f"{base_url}/{code}"

    doc = base_html
    doc = _set_title(doc, title)
    doc = _set_meta(doc, "name", "description", _MEETING_DESC)
    doc = _set_meta(doc, "property", "og:title", _MEETING_TITLE)
    doc = _set_meta(doc, "property", "og:description", _MEETING_DESC)
    doc = _set_meta(doc, "property", "og:url", url)
    doc = _set_meta(doc, "name", "twitter:title", _MEETING_TITLE)
    doc = _set_meta(doc, "name", "twitter:description", _MEETING_DESC)
    doc = _set_canonical(doc, url)
    return doc
