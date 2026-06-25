"""Reusable in-memory sliding-window rate limiter.

Same algorithm as core/middleware.py's RateLimitMiddleware, factored out so
endpoints (not just whole paths) can rate-limit with their own limits. Used by
the public guest-token endpoint to cap abuse without touching the global auth
limiter. In-memory + per-process — adequate for the current single-instance
deployment; swap the backing store for Redis if/when horizontally scaled.
"""

import threading
import time
from collections import defaultdict


class SlidingWindowLimiter:
    """Allow at most `max_requests` hits per `window` seconds per key."""

    def __init__(self, max_requests: int, window: int):
        self.max_requests = max_requests
        self.window = window
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def check(self, key: str, *, now: float | None = None) -> bool:
        """Record a hit for `key`. Returns True if allowed, False if over limit.

        On False, NO hit is recorded (so a blocked caller doesn't extend its own
        ban window indefinitely).
        """
        now = time.time() if now is None else now
        cutoff = now - self.window
        with self._lock:
            hits = [t for t in self._hits[key] if t > cutoff]
            if len(hits) >= self.max_requests:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            return True

    def retry_after(self, key: str, *, now: float | None = None) -> int:
        """Seconds until the oldest hit in the window expires (>= 1)."""
        now = time.time() if now is None else now
        with self._lock:
            hits = self._hits.get(key, [])
            if not hits:
                return 1
            return max(int(self.window - (now - hits[0])), 1)


# Guest join: 20 successful token requests per IP per hour (spec). Generous
# enough for a household/office behind one NAT, tight enough to blunt scripted
# room-flooding.
guest_join_limiter = SlidingWindowLimiter(max_requests=20, window=3600)

# Throttle repeated hits against non-existent / ended rooms from one IP — blunts
# enumeration of valid meeting codes. Separate, looser window.
invalid_room_limiter = SlidingWindowLimiter(max_requests=30, window=600)
