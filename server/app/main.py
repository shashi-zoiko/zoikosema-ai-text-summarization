import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import engine, init_db
from app.core.middleware import RateLimitMiddleware, SecurityHeadersMiddleware
from app.core.recording_cleanup import recording_cleanup_loop
from app.api import auth, users, chat, meetings, recordings, organizations, notifications, invites, dashboard, ai, admin, calls, intelligence
from app.websocket import chat as chat_ws, signaling as meeting_ws
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
    init_task = asyncio.create_task(_init_db_background())
    cleanup_task = asyncio.create_task(recording_cleanup_loop())
    try:
        yield
    finally:
        for t in (init_task, cleanup_task):
            t.cancel()
        for t in (init_task, cleanup_task):
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
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware, max_requests=10, window=60)


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
app.include_router(admin.router)
app.include_router(calls.router)
app.include_router(chat_ws.router)
app.include_router(meeting_ws.router)

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
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    _index_html = os.path.join(_dist_dir, "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        # Don't swallow unknown API/WS routes — let them 404 as JSON so the
        # client sees a real error instead of an HTML page it can't parse.
        if full_path.startswith(("api/", "ws/")):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        return FileResponse(_index_html)
else:
    log.warning("frontend dist not found at %s; SPA routes will 404", _dist_dir)
