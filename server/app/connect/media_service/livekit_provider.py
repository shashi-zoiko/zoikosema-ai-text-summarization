"""LiveKit implementation — the ONLY file that imports the vendor SDK.

Reads config from settings (not os.environ directly) so test overrides and
multi-env config flow through one place.
"""
from __future__ import annotations

import json
import time
from datetime import timedelta

from app.connect.media_service.provider import MediaProvider, MediaToken
from app.core.config import get_settings


class LiveKitMediaProvider(MediaProvider):
    def __init__(self):
        s = get_settings()
        if not (s.livekit_api_key and s.livekit_api_secret and s.livekit_ws_url):
            raise RuntimeError(
                "LiveKit provider selected but LIVEKIT_API_KEY / "
                "LIVEKIT_API_SECRET / LIVEKIT_WS_URL are not all set"
            )
        self.api_key = s.livekit_api_key
        self.api_secret = s.livekit_api_secret
        self.ws_url = s.livekit_ws_url
        self.token_ttl = int(s.livekit_token_ttl_seconds)

    # ── Rooms ──────────────────────────────────────────────────────────────
    async def create_room(self, *, session_id: str, tenant_id: str) -> str:
        # Tenant-scoped name so LiveKit ACLs map cleanly to tenants. Note: we
        # don't pre-create on the SFU — auto_create=false in livekit.yaml, but
        # the FastAPI side calls CreateRoom explicitly via release_media_room's
        # inverse path (room_admin grant covers it on first publish). For now
        # we return the deterministic name and lazy-create on first token use.
        return f"zc:{tenant_id}:{session_id}"

    # ── Tokens ─────────────────────────────────────────────────────────────
    async def generate_token(
        self,
        *,
        media_room_ref: str,
        user_id: int,
        display_name: str,
        role: str,
        is_guest: bool = False,
        metadata: dict | None = None,
    ) -> MediaToken:
        from livekit import api  # lazy import — keeps null-provider deploys SDK-free

        # Guests are exactly a "participant" capability-wise: publish A/V + data,
        # subscribe, but NO room_admin (can't mute/remove others) and NO
        # room_record. A guest can never be host/co-host, so even if role were
        # spoofed upstream, is_guest forces non-admin grants here.
        can_publish = role in ("host", "co_host", "cohost", "participant")
        is_admin = (not is_guest) and role in ("host", "co_host", "cohost")

        # Explicit source allowlist (hardening): a publisher may push ONLY
        # camera, mic and screen share — never any other/unexpected track source.
        # can_publish_sources supersedes can_publish, so this bounds what a
        # compromised or misbehaving client can send at the SFU (a bandwidth/DoS
        # vector at 100 users). Screen-share PERMISSION is still enforced live
        # over the control WS (meeting.screenshare_enabled); this only limits the
        # source TYPES a client may ever publish, matching what the app uses.
        publish_sources = (
            ["camera", "microphone", "screen_share", "screen_share_audio"]
            if can_publish
            else None
        )

        grants = api.VideoGrants(
            room_join=True,
            room=media_room_ref,
            can_publish=can_publish,
            can_publish_sources=publish_sources,
            can_subscribe=True,
            can_publish_data=True,
            room_admin=is_admin,        # mute/remove others
            room_record=is_admin,       # required for Egress
        )

        # Carry identity hints in token metadata so any LiveKit-side consumer
        # (and the client, via participant.metadata) can render the guest badge.
        meta = dict(metadata or {})
        meta.update({"displayName": display_name, "role": role, "guest": bool(is_guest)})

        at = (
            api.AccessToken(self.api_key, self.api_secret)
            .with_identity(f"u:{user_id}")     # stable per-user → SFU dedups duplicate tabs
            .with_name(display_name)
            .with_grants(grants)
            .with_metadata(json.dumps(meta))
            .with_ttl(timedelta(seconds=self.token_ttl))
        )

        return MediaToken(
            access_token=at.to_jwt(),
            room_name=media_room_ref,
            identity=f"u:{user_id}",
            expires_at=int(time.time()) + self.token_ttl,
        )

    # ── Cleanup ────────────────────────────────────────────────────────────
    async def release_room(self, media_room_ref: str | None) -> None:
        if not media_room_ref:
            return
        from livekit import api
        lk = api.LiveKitAPI(self.ws_url, self.api_key, self.api_secret)
        try:
            await lk.room.delete_room(api.DeleteRoomRequest(room=media_room_ref))
        finally:
            await lk.aclose()

    # ── Lazy provisioning (used by API layer) ──────────────────────────────
    async def ensure_room(
        self, *, media_room_ref: str, max_participants: int = 200, empty_timeout: int = 300
    ) -> None:
        """Idempotent CreateRoom — safe to call on every join."""
        from livekit import api
        lk = api.LiveKitAPI(self.ws_url, self.api_key, self.api_secret)
        try:
            await lk.room.create_room(api.CreateRoomRequest(
                name=media_room_ref,
                max_participants=max_participants,
                empty_timeout=empty_timeout,
            ))
        except Exception as e:
            # LiveKit returns AlreadyExists; safe to swallow. Any other error
            # we propagate so the caller can 502 it back to the client.
            if "already exists" in str(e).lower() or "alreadyexists" in str(e).lower():
                return
            raise
        finally:
            await lk.aclose()

    # ── Egress (recording) ─────────────────────────────────────────────────
    async def start_room_composite_egress(
        self, *, media_room_ref: str, file_path: str
    ) -> str:
        """Start a mixed-MP4 recording of the whole room. Returns egress_id."""
        from livekit import api
        lk = api.LiveKitAPI(self.ws_url, self.api_key, self.api_secret)
        try:
            req = api.RoomCompositeEgressRequest(
                room_name=media_room_ref,
                layout="grid",
                audio_only=False,
                file_outputs=[api.EncodedFileOutput(
                    file_type=api.EncodedFileType.MP4,
                    filepath=file_path,
                )],
            )
            info = await lk.egress.start_room_composite_egress(req)
            return info.egress_id
        finally:
            await lk.aclose()

    async def stop_egress(self, egress_id: str) -> None:
        from livekit import api
        lk = api.LiveKitAPI(self.ws_url, self.api_key, self.api_secret)
        try:
            await lk.egress.stop_egress(api.StopEgressRequest(egress_id=egress_id))
        finally:
            await lk.aclose()
