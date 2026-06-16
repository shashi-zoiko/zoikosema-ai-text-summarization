import asyncio
from collections import defaultdict
from typing import Any

from fastapi import WebSocket


class RoomManager:
    """Generic room-based pub/sub for WebSockets."""

    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()
        # The running event loop, captured at startup. Lets synchronous REST
        # handlers (which run in a threadpool, off the loop) fan messages out to
        # WS rooms without each path having to own an async context.
        self._loop: asyncio.AbstractEventLoop | None = None

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

    async def broadcast(
        self, room: str, payload: dict[str, Any], exclude: WebSocket | None = None
    ) -> list[WebSocket]:
        """Send to every member except *exclude*. Drop any ws whose send
        fails — the connection is dead from our point of view, and leaving
        it in the room set would cause it to keep showing up as a phantom
        member in future welcome messages until TCP keepalive eventually
        notices. Returns the dead sockets so callers can broadcast a
        peer-left for them.
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


chat_manager = RoomManager()
meet_manager = RoomManager()
