"""Media Orchestration Service — single entrypoint for all media operations.

Provider is chosen by settings.media_provider (`livekit` | `null`). The rest
of the app calls `create_media_room` / `generate_token` / `release_media_room`
and never imports a provider class directly.
"""
from __future__ import annotations

from functools import lru_cache

from app.connect.media_service.provider import MediaProvider, MediaToken
from app.core.config import get_settings


@lru_cache(maxsize=1)
def _provider() -> MediaProvider:
    kind = (get_settings().media_provider or "null").lower()
    if kind == "livekit":
        from app.connect.media_service.livekit_provider import LiveKitMediaProvider
        return LiveKitMediaProvider()
    from app.connect.media_service.null_provider import NullMediaProvider
    return NullMediaProvider()


async def create_media_room(*, session_id: str, tenant_id: str) -> str:
    return await _provider().create_room(session_id=session_id, tenant_id=tenant_id)


async def generate_token(
    *, media_room_ref: str, user_id: int, display_name: str, role: str,
) -> MediaToken:
    return await _provider().generate_token(
        media_room_ref=media_room_ref, user_id=user_id,
        display_name=display_name, role=role,
    )


async def release_media_room(media_room_ref: str | None) -> None:
    await _provider().release_room(media_room_ref)


async def ensure_media_room(media_room_ref: str) -> None:
    """Idempotent CreateRoom on the SFU. No-op for providers without it
    (the null provider, etc.)."""
    p = _provider()
    fn = getattr(p, "ensure_room", None)
    if fn is not None:
        await fn(media_room_ref=media_room_ref)


async def start_recording(*, media_room_ref: str, file_path: str) -> str:
    """Start a room-composite egress; returns the egress id."""
    p = _provider()
    fn = getattr(p, "start_room_composite_egress", None)
    if fn is None:
        raise RuntimeError("media provider does not support recording")
    return await fn(media_room_ref=media_room_ref, file_path=file_path)


async def stop_recording(egress_id: str) -> None:
    p = _provider()
    fn = getattr(p, "stop_egress", None)
    if fn is None:
        raise RuntimeError("media provider does not support recording")
    await fn(egress_id)
