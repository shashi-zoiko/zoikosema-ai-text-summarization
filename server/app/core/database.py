from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url, pool_pre_ping=True)
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

