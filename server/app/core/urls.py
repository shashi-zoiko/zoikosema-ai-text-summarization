"""Canonical meeting URL generation.

The ONE place the public meeting URL scheme is defined on the server. Meeting
links live at the frontend root:

    <frontend_url>/<code>

Used by invite emails and calendar (.ics) generation. The legacy
``<frontend_url>/meet/<code>`` form still works because the SPA permanently
redirects it client-side, so links in previously-sent emails keep resolving.
"""

from app.core.config import get_settings


def meeting_url(code: str) -> str:
    """Absolute public URL for a meeting's pre-join lobby."""
    base = get_settings().frontend_url.rstrip("/")
    return f"{base}/{code}"
