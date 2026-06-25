"""Stub provider — returns synthetic room refs + tokens so local dev and
CI don't need a LiveKit cloud account. Never used in staging/prod.
"""
from __future__ import annotations

import hashlib
import time

from app.connect.media_service.provider import MediaProvider, MediaToken


class NullMediaProvider(MediaProvider):
    async def create_room(self, *, session_id: str, tenant_id: str) -> str:
        return f"null://{tenant_id}/{session_id}"

    async def generate_token(
        self, *, media_room_ref: str, user_id: int, display_name: str, role: str,
        is_guest: bool = False,
    ) -> MediaToken:
        fake = hashlib.sha256(f"{media_room_ref}:{user_id}:{time.time()}".encode()).hexdigest()
        return MediaToken(
            access_token=f"null-token-{fake[:32]}",
            room_name=media_room_ref,
            identity=f"user-{user_id}",
            expires_at=int(time.time()) + 3600,
        )

    async def release_room(self, media_room_ref: str | None) -> None:
        return None
