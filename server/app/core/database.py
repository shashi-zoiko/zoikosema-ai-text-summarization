import logging

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import ArgumentError
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

from app.core.config import get_settings

log = logging.getLogger(__name__)

settings = get_settings()

# Empty / malformed DATABASE_URL must not crash module import — Cloud Run kills
# the container before uvicorn binds the port, so a bad env var would mean
# CrashLoopBackOff instead of a clean 503 from /api/health/ready.
# We fall back to an unreachable sentinel SQLite URL so create_engine succeeds;
# any real DB call will then fail loudly at request time.
_FALLBACK_URL = "sqlite:///:memory:"
_db_url = (settings.database_url or "").strip() or _FALLBACK_URL

_connect_args: dict = {}
if _db_url.startswith(("postgresql", "postgres")):
    # connect_timeout caps psycopg2 TCP wait so a misrouted host (e.g. the
    # IPv6-only direct Supabase host on Cloud Run) fails fast instead of
    # hanging past the port-bind deadline.
    _connect_args["connect_timeout"] = 10

try:
    engine = create_engine(_db_url, pool_pre_ping=True, connect_args=_connect_args)
except ArgumentError:
    log.exception(
        "DATABASE_URL could not be parsed (value=%r); falling back to in-memory "
        "SQLite so the process can boot. Readiness probe will report DB unhealthy.",
        _db_url,
    )
    engine = create_engine(_FALLBACK_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# (table, column, pg_ddl) — additive columns applied at startup so older DBs
# pick up new nullable / defaulted columns without a full migration tool.
_ADDITIVE_COLUMNS: list[tuple[str, str, str]] = [
    ("meetings", "scheduled_at", "TIMESTAMP WITH TIME ZONE"),
    ("meetings", "timezone_name", "VARCHAR(64)"),
    ("meetings", "waiting_room_enabled", "BOOLEAN DEFAULT TRUE NOT NULL"),
    ("meetings", "locked", "BOOLEAN DEFAULT FALSE NOT NULL"),
    ("meeting_participants", "role", "VARCHAR(24) DEFAULT 'participant' NOT NULL"),
    ("meeting_participants", "status", "VARCHAR(24) DEFAULT 'admitted' NOT NULL"),
    ("meeting_participants", "peer_id", "VARCHAR(32)"),
    ("meeting_participants", "last_seen_at", "TIMESTAMP WITH TIME ZONE"),
    # Chat enhancements
    ("messages", "deleted_at", "TIMESTAMP WITH TIME ZONE"),
    ("messages", "reply_to_id", "INTEGER REFERENCES messages(id)"),
    ("messages", "file_url", "VARCHAR(500)"),
    ("messages", "file_name", "VARCHAR(255)"),
    ("messages", "file_type", "VARCHAR(100)"),
    ("messages", "file_size", "INTEGER"),
    ("channel_members", "is_muted", "BOOLEAN DEFAULT FALSE NOT NULL"),
    # Meeting password
    ("meetings", "password_hash", "VARCHAR(255)"),
    # Per-meeting permissions (host/co-host always exempt)
    ("meetings", "chat_enabled", "BOOLEAN DEFAULT TRUE NOT NULL"),
    ("meetings", "screenshare_enabled", "BOOLEAN DEFAULT TRUE NOT NULL"),
]


def _apply_additive_migrations() -> None:
    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, column, pg_ddl in _ADDITIVE_COLUMNS:
            if table not in existing_tables:
                continue
            cols = {c["name"] for c in insp.get_columns(table)}
            if column in cols:
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {pg_ddl}"))


def init_db() -> None:
    from app import models  # noqa: F401  ensure models are imported
    Base.metadata.create_all(bind=engine)
    _apply_additive_migrations()

