import time
import threading
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


# ── Rate limiter ──────────────────────────────────────────────────────────

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiter for auth endpoints.

    Limits by client IP. Uses a sliding window of `window` seconds
    and allows at most `max_requests` per window.
    """

    def __init__(self, app, max_requests: int = 10, window: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window = window
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    # Paths that are rate-limited
    RATE_LIMITED_PATHS = {
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/refresh",
        # Password-reset flow — coarse per-IP burst protection (the endpoints
        # also enforce a per-email hourly cap and a per-OTP attempt cap).
        "/api/auth/forgot-password",
        "/api/auth/verify-otp",
        "/api/auth/reset-password",
    }

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _cleanup(self, key: str, now: float) -> None:
        cutoff = now - self.window
        self._hits[key] = [t for t in self._hits[key] if t > cutoff]

    async def dispatch(self, request: Request, call_next):
        if request.url.path not in self.RATE_LIMITED_PATHS:
            return await call_next(request)

        ip = self._get_client_ip(request)
        now = time.time()
        key = f"{ip}:{request.url.path}"

        with self._lock:
            self._cleanup(key, now)
            if len(self._hits[key]) >= self.max_requests:
                retry_after = int(self.window - (now - self._hits[key][0]))
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests, please try again later"},
                    headers={"Retry-After": str(max(retry_after, 1))},
                )
            self._hits[key].append(now)

        return await call_next(request)


# ── Security headers ─────────────────────────────────────────────────────

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add standard security headers to all responses."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), display-capture=(self)"
        # Strict-Transport-Security header for HTTPS deployments
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response
