"""Media provider interface — the only type the rest of the codebase sees.

No other file may import LiveKit, Daily, or any vendor SDK. When we need
to swap vendors, only this folder changes.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class MediaToken:
    access_token: str      # opaque; client passes verbatim to vendor SDK
    room_name: str
    identity: str
    expires_at: int        # unix seconds


class MediaProvider(ABC):
    @abstractmethod
    async def create_room(self, *, session_id: str, tenant_id: str) -> str:
        """Returns an opaque `media_room_ref` stored on connect_sessions."""

    @abstractmethod
    async def generate_token(
        self, *, media_room_ref: str, user_id: int, display_name: str, role: str,
        is_guest: bool = False,
    ) -> MediaToken:
        ...

    @abstractmethod
    async def release_room(self, media_room_ref: str | None) -> None:
        ...
