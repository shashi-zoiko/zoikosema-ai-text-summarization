import asyncio
import json
import logging
import os
import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

log = logging.getLogger(__name__)


class RoomManager:
    """Generic room-based pub/sub for WebSockets.

    Sockets are always process-local (a WebSocket object lives in exactly one
    worker), and so is room membership. When ``REDIS_URL`` is set, every
    broadcast is ALSO published to a Redis channel and each instance re-delivers
    it to its own local sockets — so chat / reactions / captions / raise-hand /
    media-state / host events reach every participant of a meeting no matter
    which instance or worker holds their socket. This is what makes running more
    than one FastAPI instance safe for the real-time control plane.

    Without ``REDIS_URL`` (the current single-instance deploy) the fanout is a
    no-op and behaviour is byte-for-byte what it was before.

    NOT fanned out (single-recipient / DB-derived, handled per-instance):
      - single-user sends via ``_user_ws`` (signaling.notify_user)
      - the waiting-room list (recomputed from the DB on each instance)
    Cross-instance admission still converges via the waiting-room hold loop's
    ~2 s DB-poll fallback, so correctness holds without pushing those over Redis.
    """

    def __init__(self, name: str) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        # The running event loop, captured at startup. Lets synchronous REST
        # handlers (which run in a threadpool, off the loop) fan messages out to
        # WS rooms without each path having to own an async context.
        self._loop: asyncio.AbstractEventLoop | None = None
        # Channel namespace ("meet" | "chat") + a per-process id so an instance
        # skips re-delivering its own published messages (already sent locally).
        self._name = name
        self._origin = uuid.uuid4().hex
        self._redis = None
        self._fanout_task: asyncio.Task | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def schedule(self, coro) -> None:
        """Run an awaitable on the bound loop from synchronous/threadpool code.
        No-ops (and closes the coroutine to avoid 'never awaited' warnings) if
        no loop is bound yet — e.g. during very early startup."""
        loop = self._loop
        if loop is None:
            coro.close()
            return
        try:
            asyncio.run_coroutine_threadsafe(coro, loop)
        except RuntimeError:
            coro.close()

    def broadcast_threadsafe(
        self, room: str, payload: dict[str, Any], exclude: WebSocket | None = None
    ) -> None:
        """Fire-and-forget broadcast callable from synchronous REST endpoints."""
        self.schedule(self.broadcast(room, payload, exclude))

    async def join(self, room: str, ws: WebSocket) -> None:
        async with self._lock:
            self._rooms[room].add(ws)

    async def leave(self, room: str, ws: WebSocket) -> None:
        async with self._lock:
            if ws in self._rooms.get(room, set()):
                self._rooms[room].discard(ws)
            if room in self._rooms and not self._rooms[room]:
                self._rooms.pop(room, None)

    def members(self, room: str) -> list[WebSocket]:
        return list(self._rooms.get(room, set()))

    def stats(self) -> dict[str, int]:
        """Snapshot gauge for observability: how many rooms and total live
        sockets this instance holds. Lock-free read of a point-in-time size —
        good enough for a metrics scrape, never used for control flow."""
        rooms = self._rooms
        return {"rooms": len(rooms), "sockets": sum(len(s) for s in rooms.values())}

    async def broadcast(
        self, room: str, payload: dict[str, Any], exclude: WebSocket | None = None
    ) -> list[WebSocket]:
        """Deliver to this instance's local members (respecting ``exclude``) AND,
        when Redis fanout is enabled, publish to peer instances so their local
        members receive it too. ``exclude`` is a local WebSocket, so it is applied
        only here on the origin; peer instances don't hold that socket and deliver
        to all of their own members. Returns the LOCAL dead sockets so callers can
        emit peer-left for them (same contract as before)."""
        dead = await self._local_broadcast(room, payload, exclude)
        await self._publish(room, payload)
        return dead

    async def _local_broadcast(
        self, room: str, payload: dict[str, Any], exclude: WebSocket | None = None
    ) -> list[WebSocket]:
        """Send to every LOCAL member except *exclude*. Drop any ws whose send
        fails — the connection is dead from our point of view, and leaving it in
        the room set would cause it to keep showing up as a phantom member in
        future welcome messages until TCP keepalive eventually notices.
        """
        dead: list[WebSocket] = []
        for ws in list(self._rooms.get(room, set())):
            if ws is exclude:
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                bucket = self._rooms.get(room)
                if bucket is not None:
                    for ws in dead:
                        bucket.discard(ws)
                    if not bucket:
                        self._rooms.pop(room, None)
        return dead

    # ── Cross-instance fanout (Redis pub/sub) ────────────────────────────────
    def fanout_enabled(self) -> bool:
        return self._fanout_task is not None and not self._fanout_task.done()

    def _channel(self) -> str:
        return f"ws-fanout:{self._name}"

    async def start_fanout(self) -> None:
        """Begin consuming the cross-instance fanout channel. No-op without
        REDIS_URL — a single-instance deploy needs nothing here."""
        if self._fanout_task is not None:
            return
        if not os.getenv("REDIS_URL"):
            return
        from app.connect.shared.redis import get_redis
        self._redis = await get_redis()
        if self._redis is None:
            log.warning("REDIS_URL set but redis client unavailable; WS fanout disabled")
            return
        self._fanout_task = asyncio.create_task(self._consume())
        log.info("cross-instance WS fanout enabled on channel %s", self._channel())

    async def stop_fanout(self) -> None:
        if self._fanout_task is not None:
            self._fanout_task.cancel()
            try:
                await self._fanout_task
            except asyncio.CancelledError:
                pass
            self._fanout_task = None

    async def _consume(self) -> None:
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(self._channel())
        try:
            async for msg in pubsub.listen():
                if msg.get("type") != "message":
                    continue
                try:
                    env = json.loads(msg["data"])
                except Exception:
                    continue
                if env.get("o") == self._origin:
                    continue  # our own publish — already delivered locally
                await self._local_broadcast(env.get("room", ""), env.get("p") or {})
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("WS fanout consumer crashed on %s", self._channel())
        finally:
            try:
                await pubsub.aclose()
            except Exception:
                pass

    async def _publish(self, room: str, payload: dict[str, Any]) -> None:
        r = self._redis
        if r is None:
            return
        try:
            await r.publish(
                self._channel(),
                json.dumps({"o": self._origin, "room": room, "p": payload}),
            )
        except Exception:
            # Fanout is best-effort; local delivery already happened.
            log.debug("WS fanout publish failed", exc_info=True)


chat_manager = RoomManager("chat")
meet_manager = RoomManager("meet")
