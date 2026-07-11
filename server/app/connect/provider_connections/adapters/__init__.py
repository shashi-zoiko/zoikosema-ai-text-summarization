"""Provider adapter registry.

Every service that needs to talk to a provider goes through `get_adapter()`
rather than importing google/outlook directly — this is the one place that
knows which provider strings are supported, so provider_connections/service.py
and calendar_service/service.py don't each need their own if/elif ladder.
"""
from __future__ import annotations

from types import ModuleType

from app.connect.provider_connections.adapters import google, outlook
from app.connect.shared.errors import Invalid

_ADAPTERS: dict[str, ModuleType] = {
    "google_calendar": google,
    "microsoft_calendar": outlook,
}


def get_adapter(provider: str) -> ModuleType:
    adapter = _ADAPTERS.get(provider)
    if adapter is None:
        raise Invalid(f"Unknown provider: {provider}")
    return adapter
