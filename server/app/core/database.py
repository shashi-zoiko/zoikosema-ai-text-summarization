import logging

from sqlalchemy import bindparam, create_engine, inspect, text
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
_engine_kwargs: dict = {"pool_pre_ping": True, "connect_args": _connect_args}
if _db_url.startswith(("postgresql", "postgres")):
    # connect_timeout caps psycopg2 TCP wait so a misrouted host (e.g. the
    # IPv6-only direct Supabase host on Cloud Run) fails fast instead of
    # hanging past the port-bind deadline.
    _connect_args["connect_timeout"] = 10
    # Default pool (size=5, overflow=10) starved under WebSocket load — each
    # active chat tab used to hold one connection for its lifetime. Even after
    # switching to short-lived sessions, the chat list + bulk loaders fan out
    # ~6 concurrent queries on a busy request, so 5 isn't enough headroom.
    # pool_recycle keeps the Supabase Session Pooler from killing idle conns
    # under us (it disconnects after ~30 min of inactivity). pool_size /
    # max_overflow come from settings (DB_POOL_SIZE / DB_MAX_OVERFLOW) so a
    # large-meeting event can raise them from deploy env without a code change.
    _engine_kwargs.update(
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_recycle=1800,
    )

try:
    engine = create_engine(_db_url, **_engine_kwargs)
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
    except Exception:
        # A request that raises mid-transaction must roll back before the
        # connection returns to the pool — otherwise the next request checks
        # out a connection with an invalid transaction and fails with
        # PendingRollbackError ("every join 500s"). FastAPI re-raises the
        # endpoint's exception here at the yield point, so this catches it.
        db.rollback()
        raise
    finally:
        db.close()


# (index_name, table, ddl) — additive indexes applied at startup. The index
# name is also the CREATE INDEX IF NOT EXISTS guard, so re-runs are no-ops.
# Put hot chat / meeting query paths here; query planner-confirmed wins only,
# not "might-need-someday" indexes.
_ADDITIVE_INDEXES: list[tuple[str, str, str]] = [
    # /api/channels list_my_channels: "last message per channel" subquery
    # plans as `messages WHERE channel_id IN (…) AND deleted_at IS NULL` and
    # the same scan drives unread counts. Without this composite, PG falls
    # back to a Bitmap Heap Scan on the single-column channel_id index then
    # filters deleted_at row-by-row. The partial-NULL index lets PG read the
    # last-id-per-channel in one index range scan per channel.
    ("ix_messages_channel_id_id_active", "messages",
     "CREATE INDEX IF NOT EXISTS ix_messages_channel_id_id_active "
     "ON messages (channel_id, id DESC) WHERE deleted_at IS NULL"),
    # /api/channels/{id}/messages: `ORDER BY id DESC LIMIT N` on a channel.
    # The same composite covers this — listed separately so the comment
    # stays focused on the query path it optimizes.
    ("ix_messages_channel_id_id", "messages",
     "CREATE INDEX IF NOT EXISTS ix_messages_channel_id_id "
     "ON messages (channel_id, id DESC)"),
    # End-to-end send idempotency: a retried POST (lost response, flaky network)
    # carries the same client_id and must not create a second row. Partial so the
    # mountain of historical client_id-NULL rows neither collide nor bloat the
    # index. post_message catches the IntegrityError this raises and returns the
    # original row. Plain (non-CONCURRENT) build briefly locks writes — fine at
    # current table size; revisit with CREATE UNIQUE INDEX CONCURRENTLY if the
    # messages table grows large before this first ships.
    ("ux_messages_sender_client_id", "messages",
     "CREATE UNIQUE INDEX IF NOT EXISTS ux_messages_sender_client_id "
     "ON messages (channel_id, sender_id, client_id) WHERE client_id IS NOT NULL"),
    # ChannelMember membership lookups happen on every WS connect AND every
    # message send (`_persist_message` re-validates membership). The two
    # existing single-column indexes can't satisfy the AND on (channel_id,
    # user_id) without bitmap intersection. Non-UNIQUE on purpose: while the
    # app only ever inserts one row per pair, we don't want a startup
    # migration to fail on historical duplicates the way /join did.
    ("ix_channel_members_channel_user", "channel_members",
     "CREATE INDEX IF NOT EXISTS ix_channel_members_channel_user "
     "ON channel_members (channel_id, user_id)"),
    # MessageReadReceipt: same shape — one row per (channel, user), hit on
    # mark_read and the unread-counts query for the channel list.
    ("ix_read_receipts_channel_user", "message_read_receipts",
     "CREATE INDEX IF NOT EXISTS ix_read_receipts_channel_user "
     "ON message_read_receipts (channel_id, user_id)"),
    # MessageReaction.toggle: the existence-check selects on (message_id,
    # user_id, emoji). Composite lets PG hit the index directly instead of
    # bitmap-AND-ing the message_id index against a filter.
    ("ix_reactions_msg_user_emoji", "message_reactions",
     "CREATE INDEX IF NOT EXISTS ix_reactions_msg_user_emoji "
     "ON message_reactions (message_id, user_id, emoji)"),
    # MeetingParticipant lookups in /join, /media-token, and the signaling
    # WS all filter on (meeting_id, user_id). Same story as above — without
    # a composite, the two single-column indexes have to be combined.
    ("ix_meeting_participants_meeting_user", "meeting_participants",
     "CREATE INDEX IF NOT EXISTS ix_meeting_participants_meeting_user "
     "ON meeting_participants (meeting_id, user_id)"),
]


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
    # Client-supplied idempotency key for chat sends (see Message.client_id).
    ("messages", "client_id", "VARCHAR(64)"),
    ("channel_members", "is_muted", "BOOLEAN DEFAULT FALSE NOT NULL"),
    # Meeting password
    ("meetings", "password_hash", "VARCHAR(255)"),
    # Per-meeting permissions (host/co-host always exempt)
    ("meetings", "chat_enabled", "BOOLEAN DEFAULT TRUE NOT NULL"),
    ("meetings", "screenshare_enabled", "BOOLEAN DEFAULT TRUE NOT NULL"),
    # Meeting-wide visual theme id (host/co-host controlled, shared by all).
    ("meetings", "theme", "VARCHAR(24) DEFAULT 'forest' NOT NULL"),
    # LiveKit room handle (lazy-allocated on first join token request)
    ("meetings", "media_room_ref", "VARCHAR(128)"),
    # Per-meeting media plane selector ('mesh' | 'livekit')
    ("meetings", "media_provider", "VARCHAR(16) DEFAULT 'mesh' NOT NULL"),
    # LiveKit Egress handle on recordings
    ("meeting_recordings", "egress_id", "VARCHAR(64)"),
    # Guest (anonymous) join support. is_guest flags ephemeral accounts created
    # by the public /guest-token endpoint; guest_expires_at bounds their TTL so
    # the cleanup loop can purge crashed sessions. guests_enabled is the host's
    # per-meeting kill-switch (default TRUE so existing links accept guests).
    ("users", "is_guest", "BOOLEAN DEFAULT FALSE NOT NULL"),
    ("users", "guest_expires_at", "TIMESTAMP WITH TIME ZONE"),
    # Platform admin flag — gates /api/admin/*. See _sync_admin_flags() below.
    ("users", "is_admin", "BOOLEAN DEFAULT FALSE NOT NULL"),
    ("users", "avatar_url", "VARCHAR(500)"),
    ("users", "job_title", "VARCHAR(120)"),
    ("users", "pronouns", "VARCHAR(40)"),
    ("users", "bio", "VARCHAR(300)"),
    ("users", "show_photo_in_meetings", "BOOLEAN DEFAULT TRUE NOT NULL"),
    ("users", "show_photo_on_dashboard", "BOOLEAN DEFAULT TRUE NOT NULL"),
    ("meetings", "guests_enabled", "BOOLEAN DEFAULT TRUE NOT NULL"),
    # Tracks whether the "starts in 5 minutes" reminder email has gone out for
    # a given invitee (see meeting_reminders.py) so the loop never sends twice.
    ("meeting_invites", "reminder_sent", "BOOLEAN DEFAULT FALSE NOT NULL"),
    # Host-cancelled scheduled meetings (drives the "cancelled" status).
    ("meetings", "cancelled_at", "TIMESTAMP WITH TIME ZONE"),
    # Saved transcript file URL for transcript-based intelligence regeneration.
    ("meeting_intelligence", "transcript_file_url", "VARCHAR(500)"),
    # Meet Summarizer room-wide on/off (host/co-host controlled, broadcast to
    # everyone — see signaling.py's "set-summarizer" handler).
    ("meetings", "summarizer_on", "BOOLEAN DEFAULT FALSE NOT NULL"),
    # Billing plan for AI gateway rate limiting and feature gating
    ("users", "plan", "VARCHAR(32) DEFAULT 'free' NOT NULL"),
    # Saved "raw conversation log" file URL — the (possibly narrower) slice
    # shown on the summary page, separate from transcript_file_url which
    # always feeds the AI summary itself. See models/meeting.py for why.
    ("meeting_intelligence", "raw_conversation_file_url", "VARCHAR(500)"),
]

# (table, column) pairs whose NOT NULL constraint must be dropped so guest rows
# (email/password-less) can be inserted into pre-existing tables. Idempotent —
# checked against information_schema before issuing the ALTER.
_DROP_NOT_NULL: list[tuple[str, str]] = [
    ("users", "email"),
    ("users", "password_hash"),
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
        # Relax NOT NULL on columns that guest rows leave empty. Only meaningful
        # on Postgres; SQLite (test/in-memory) ignores DROP NOT NULL but also
        # never enforced it via this path, so guard on the dialect.
        if engine.dialect.name == "postgresql":
            for table, column in _DROP_NOT_NULL:
                if table not in existing_tables:
                    continue
                nullable = {c["name"]: c["nullable"] for c in insp.get_columns(table)}
                if column in nullable and not nullable[column]:
                    conn.execute(
                        text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL")
                    )
        # Deduplicate meeting_participants, then enforce UNIQUE(meeting_id,
        # user_id). Without the constraint, concurrent first-joins silently
        # inserted duplicate rows and the IntegrityError recovery in join_meeting
        # could never fire. Keep the highest id per pair — the row every read
        # already treats as canonical (all use `order_by(id desc).first()`) — and
        # drop the rest. Idempotent: the DELETE no-ops once deduped and the index
        # uses IF NOT EXISTS. Postgres only (SQLite test DBs get it via create_all).
        if "meeting_participants" in existing_tables and engine.dialect.name == "postgresql":
            deduped = conn.execute(text(
                "DELETE FROM meeting_participants a "
                "USING meeting_participants b "
                "WHERE a.meeting_id = b.meeting_id AND a.user_id = b.user_id "
                "AND a.id < b.id"
            ))
            if deduped.rowcount:
                log.warning(
                    "deduped %s duplicate meeting_participants row(s) before adding "
                    "UNIQUE(meeting_id, user_id)", deduped.rowcount,
                )
            try:
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_participants_meeting_user "
                    "ON meeting_participants (meeting_id, user_id)"
                ))
            except Exception:
                log.exception("unique meeting_participants index could not be created")

        # Indexes ship after columns because some of them reference columns we
        # may have just added (e.g. messages.deleted_at). All DDL uses
        # `CREATE INDEX IF NOT EXISTS` so re-runs are no-ops.
        for _index_name, table, ddl in _ADDITIVE_INDEXES:
            if table not in existing_tables:
                continue
            try:
                conn.execute(text(ddl))
            except Exception:
                # An existing same-named index with a different definition
                # would error here; we log via the calling startup handler
                # and continue so a single bad index can't take the app down.
                log.exception("additive index failed: %s", _index_name)


def _sync_admin_flags() -> None:
    """Grant users.is_admin to every account whose email is listed in the
    ADMIN_EMAILS setting. Idempotent and runs after the is_admin column exists.
    Emails not present in the DB are simply ignored."""
    emails = get_settings().admin_email_list
    if not emails:
        return
    try:
        stmt = (
            text("UPDATE users SET is_admin = TRUE WHERE lower(email) IN :emails")
            .bindparams(bindparam("emails", expanding=True))
        )
        with engine.begin() as conn:
            conn.execute(stmt, {"emails": emails})
    except Exception:
        # Never let admin-seeding take startup down; log and continue.
        log.exception("admin flag sync failed")


def init_db() -> None:
    from app import models  # noqa: F401  ensure models are imported
    Base.metadata.create_all(bind=engine)
    _apply_additive_migrations()
    _sync_admin_flags()

