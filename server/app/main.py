import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.types import Scope

from app.core.config import get_settings
from app.core.social_meta import render_index
from app.core.database import engine, init_db
from app.core.middleware import RateLimitMiddleware, SecurityHeadersMiddleware
from app.core.recording_cleanup import recording_cleanup_loop
from app.core.guest_cleanup import guest_cleanup_loop
from app.core.meeting_reminders import meeting_reminder_loop
from app.api import auth, users, chat, meetings, recordings, organizations, notifications, invites, dashboard, ai, admin, calls, intelligence, webhooks, support, settings as settings_api
from app.connect.sema_guide.api import router as sema_guide_router
from app.websocket import chat as chat_ws, signaling as meeting_ws
from app.websocket.manager import chat_manager, meet_manager
from app.connect import router as connect_router

log = logging.getLogger(__name__)

settings = get_settings()


async def _init_db_background() -> None:
    # Runs in a worker thread so a slow/unreachable Postgres can never block
    # uvicorn from binding the port — Cloud Run kills the container otherwise.
    try:
        await asyncio.to_thread(init_db)
    except Exception:
        log.exception("init_db failed at startup; serving with DB unhealthy")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Capture the serving loop so synchronous REST handlers can fan messages out
    # to WebSocket rooms (e.g. REST-sent chat messages reaching live peers).
    _loop = asyncio.get_running_loop()
    chat_manager.bind_loop(_loop)
    meet_manager.bind_loop(_loop)
    # Loudly flag the #1 "meetings die at ~15 users" trigger: a Supabase SESSION
    # pooler / direct connection (:5432, 15-client hard cap). Scaling needs the
    # TRANSACTION pooler (:6543), which multiplexes. Only Supabase hosts on :5432
    # are flagged — local Postgres / docker `db:5432` are legitimately on 5432.
    _db_url = settings.database_url or ""
    if "supabase" in _db_url and ":5432" in _db_url:
        log.warning(
            "Supabase session pooler detected (:5432, 15-client cap). "
            "Use the transaction pooler (:6543) for scaling — otherwise DB "
            "routes 500 around ~15 concurrent participants."
        )
    # Cross-instance WebSocket fanout (chat/reactions/host events across FastAPI
    # instances). No-op unless REDIS_URL is set, so single-instance deploys are
    # unaffected — this only activates once you run more than one instance.
    await meet_manager.start_fanout()
    await chat_manager.start_fanout()
    init_task = asyncio.create_task(_init_db_background())
    cleanup_task = asyncio.create_task(recording_cleanup_loop())
    guest_task = asyncio.create_task(guest_cleanup_loop())
    reminder_task = asyncio.create_task(meeting_reminder_loop())
    try:
        yield
    finally:
        await meet_manager.stop_fanout()
        await chat_manager.stop_fanout()
        for t in (init_task, cleanup_task, guest_task, reminder_task):
            t.cancel()
        for t in (init_task, cleanup_task, guest_task, reminder_task):
            try:
                await t
            except asyncio.CancelledError:
                pass
            except Exception:
                log.exception("background task raised during shutdown")


app = FastAPI(title="ZoikoSema API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Compress JSON / HTML / JS / CSS bodies above 1KB. Cloud Run doesn't add gzip
# at the edge, so without this the SPA bundle and chat history payloads ship
# uncompressed over the wire.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware, max_requests=10, window=60)


class _ImmutableStaticFiles(StaticFiles):
    """StaticFiles that stamps long-lived cache headers on hashed Vite assets.

    Vite emits content-hashed filenames (e.g. index-6HPNC4rZ.js); they never
    change for a given hash, so a 1y immutable cache eliminates revalidation
    on repeat visits. index.html is served separately and stays uncached.
    """

    async def get_response(self, path: str, scope: Scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


@app.get("/api/health")
def health():
    """Lightweight liveness probe — process is up and serving."""
    return {"status": "ok"}


@app.get("/api/health/ready")
def health_ready():
    """Readiness probe — verifies the DB is reachable before accepting traffic.

    Returns 503 with a structured error so load balancers / orchestrators can
    pull the pod out of rotation when Postgres is unreachable instead of
    routing requests that will then 500 inside endpoints.
    """
    checks: dict[str, dict] = {}
    overall_ok = True

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = {"ok": True}
    except Exception as exc:  # noqa: BLE001 — surface any DB failure mode
        overall_ok = False
        checks["database"] = {"ok": False, "error": str(exc)[:200]}
        log.warning("readiness: database check failed: %s", exc)

    # AI is informational only — we don't fail readiness just because the key
    # isn't configured; the app still serves non-AI traffic fine.
    checks["ai"] = {"ok": bool(settings.anthropic_api_key), "configured": bool(settings.anthropic_api_key)}

    body = {"status": "ok" if overall_ok else "degraded", "checks": checks}
    return JSONResponse(body, status_code=200 if overall_ok else 503)


@app.get("/api/health/metrics")
async def health_metrics():
    """Point-in-time scalability gauges — curl this during a load test to watch
    the failure modes that crash large meetings: DB-pool exhaustion, per-instance
    socket saturation, and Redis latency once the fanout is enabled. Gauges are
    for THIS instance/worker only; with multiple instances, scrape each and sum.
    """
    import time as _time

    pool = engine.pool
    # QueuePool exposes these; the SQLite fallback pool may not — guard each.
    db_pool = {
        k: getattr(pool, k)()
        for k in ("size", "checkedin", "checkedout", "overflow")
        if callable(getattr(pool, k, None))
    }

    # Redis reachability + round-trip latency. "disabled" when no REDIS_URL, so a
    # single-instance deploy shows exactly why fanout is off without erroring.
    redis_stat: dict = {"enabled": bool(os.getenv("REDIS_URL"))}
    if redis_stat["enabled"]:
        try:
            from app.connect.shared.redis import get_redis
            r = await get_redis()
            if r is None:
                redis_stat["ok"] = False
                redis_stat["error"] = "client unavailable (redis pkg missing?)"
            else:
                t0 = _time.perf_counter()
                await r.ping()
                redis_stat["ok"] = True
                redis_stat["ping_ms"] = round((_time.perf_counter() - t0) * 1000, 2)
        except Exception as exc:  # noqa: BLE001
            redis_stat["ok"] = False
            redis_stat["error"] = str(exc)[:120]

    meet = meet_manager.stats()
    return {
        "db_pool": db_pool,
        # active_meetings = rooms currently holding ≥1 socket ON THIS INSTANCE.
        "active_meetings": meet["rooms"],
        "meetings": meet,
        "chat": chat_manager.stats(),
        "redis": redis_stat,
        "ws_fanout": {
            "meet": meet_manager.fanout_enabled(),
            "chat": chat_manager.fanout_enabled(),
        },
    }


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(chat.router)
app.include_router(meetings.router)
app.include_router(recordings.router)
app.include_router(organizations.router)
app.include_router(notifications.router)
app.include_router(invites.router)
app.include_router(dashboard.router)
app.include_router(ai.router)
app.include_router(intelligence.router)
app.include_router(intelligence.actions_router)
app.include_router(admin.router)
app.include_router(calls.router)
app.include_router(chat_ws.router)
app.include_router(meeting_ws.router)
app.include_router(webhooks.router)
app.include_router(support.router)
app.include_router(settings_api.router)
app.include_router(sema_guide_router)

# Zoiko Connect v3 — new bounded services mounted alongside legacy routers.
# Strangler-fig: legacy paths keep working; new features consume /api/connect/*.
app.include_router(connect_router)

# Serve uploaded files
_upload_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(_upload_dir, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=_upload_dir), name="uploads")

# Serve recording files
_rec_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "recordings")
os.makedirs(_rec_dir, exist_ok=True)
app.mount("/api/recordings/files", StaticFiles(directory=_rec_dir), name="recordings")

# Serve built frontend (single-service deploy). The Vite build output is copied
# into the image at /app/dist by the Dockerfile; locally, drop the build at
# server/dist/ to mirror the same layout.
_dist_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dist")
if os.path.isdir(_dist_dir):
    _assets_dir = os.path.join(_dist_dir, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/assets", _ImmutableStaticFiles(directory=_assets_dir), name="assets")

    _index_html = os.path.join(_dist_dir, "index.html")
    # Read the built SPA shell once; metadata is rewritten per-request in memory
    # (cheap string ops) so link-preview crawlers get meeting-specific tags.
    try:
        with open(_index_html, encoding="utf-8") as fh:
            _index_html_src = fh.read()
    except OSError:
        _index_html_src = ""

    # Long-lived, immutable cache for the branded social card and app icons —
    # these are stable assets; crawlers and browsers should not revalidate them.
    _LONG_CACHE_FILES = {
        "og-image.png",
        "og-image.svg",
        "favicon.ico",
        "favicon.svg",
        "favicon-32.png",
        "favicon-64.png",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
    }

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        # Don't swallow unknown API/WS routes — let them 404 as JSON so the
        # client sees a real error instead of an HTML page it can't parse.
        if full_path.startswith(("api/", "ws/")):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        # Serve real static files that Vite copies from public/ into the dist
        # root (emoji PNGs under /emoji, MediaPipe wasm+model under /mediapipe,
        # favicon, robots.txt, …). Only /assets was mounted above, so without
        # this every such request fell through to the SPA shell and the browser
        # got index.html where it expected a PNG/wasm — hence broken emoji and
        # virtual-background fetches in the single-service deploy.
        if full_path:
            candidate = os.path.normpath(os.path.join(_dist_dir, full_path))
            # Guard against path traversal (../) escaping the dist root.
            if candidate.startswith(_dist_dir + os.sep) and os.path.isfile(candidate):
                # FileResponse adds ETag + Last-Modified automatically; stamp a
                # 1y immutable cache on the OG image and favicons (spec).
                headers = None
                if os.path.basename(candidate) in _LONG_CACHE_FILES:
                    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
                return FileResponse(candidate, headers=headers)
        # SPA shell: inject meeting-specific Open Graph metadata so shared
        # meeting links unfurl correctly on crawlers that never run JS.
        if _index_html_src:
            base_url = settings.frontend_url.rstrip("/")
            html_doc = render_index(_index_html_src, full_path, base_url)
            return HTMLResponse(html_doc, headers={"Cache-Control": "no-cache"})
        return FileResponse(_index_html)
else:
    log.warning("frontend dist not found at %s; SPA routes will 404", _dist_dir)


if __name__ == "__main__":
    # Local dev entrypoint: `python -m app.main`. Defaults to 8001 because the
    # client (client/.env.local VITE_API_BASE + Vite proxy in vite.config.js)
    # and docker-compose's host mapping (8001:8080) all expect the API on 8001.
    # Running manual uvicorn on any other port → the browser gets "Failed to
    # fetch". Containers set PORT=8080 explicitly, so this respects that too.
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8001")),
        reload=True,
    )
