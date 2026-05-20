from datetime import datetime, timezone

from sqlalchemy import String, DateTime, ForeignKey, Boolean, Integer, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


# Participant roles
ROLE_HOST = "host"
ROLE_COHOST = "co_host"
ROLE_PARTICIPANT = "participant"

# Participant lifecycle status (server-side truth for waiting room + reconnects)
STATUS_PENDING = "pending"       # in waiting room, awaiting admission
STATUS_ADMITTED = "admitted"     # admitted, currently connected
STATUS_DISCONNECTED = "disconnected"  # admitted but WS dropped (eligible for resume)
STATUS_DENIED = "denied"         # host denied entry
STATUS_KICKED = "kicked"         # removed by host
STATUS_LEFT = "left"             # left voluntarily


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), default="Instant meeting")
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # scheduling
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # IANA tz name (e.g. "Asia/Kolkata"); kept so clients can re-render in the host's timezone
    timezone_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # host controls
    waiting_room_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    # Per-meeting permissions enforced server-side. Host + co-host bypass.
    chat_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    screenshare_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Meeting password (bcrypt hash, nullable = no password)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    participants: Mapped[list["MeetingParticipant"]] = relationship(
        back_populates="meeting", cascade="all, delete-orphan"
    )


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(24), default=ROLE_PARTICIPANT)
    status: Mapped[str] = mapped_column(String(24), default=STATUS_PENDING)
    # Ephemeral peer id used by the signaling layer; survives short WS drops so reconnects
    # can resume without re-negotiating the whole mesh.
    peer_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    meeting: Mapped[Meeting] = relationship(back_populates="participants")


# Recording status constants
REC_STATUS_RECORDING = "recording"
REC_STATUS_UPLOADING = "uploading"
REC_STATUS_READY = "ready"
REC_STATUS_FAILED = "failed"


class MeetingRecording(Base):
    __tablename__ = "meeting_recordings"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    file_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), default="recording.webm")
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds
    includes_chat: Mapped[bool] = mapped_column(Boolean, default=False)
    chat_log_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default=REC_STATUS_RECORDING)
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    meeting: Mapped[Meeting] = relationship()
    user: Mapped["User"] = relationship()


# ── Meeting Intelligence (structured AI summary) ───────────────────────────

# Lifecycle of a generated intelligence record.
INTEL_STATUS_PENDING = "pending"      # row exists, generation not started
INTEL_STATUS_GENERATING = "generating"
INTEL_STATUS_READY = "ready"
INTEL_STATUS_FAILED = "failed"

# Where the source text came from. We currently feed chat transcripts; the
# `transcript` and `hybrid` values are reserved so future audio-derived
# transcripts can populate the same table without a schema change.
INTEL_SOURCE_CHAT = "chat"
INTEL_SOURCE_TRANSCRIPT = "transcript"
INTEL_SOURCE_HYBRID = "hybrid"


class MeetingIntelligence(Base):
    """Structured AI insights for a meeting.

    A meeting can have multiple intelligence rows over time (each `generate`
    inserts a new one); clients always read the most recent `ready` row.
    """

    __tablename__ = "meeting_intelligence"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), index=True
    )
    # Optional link to the recording whose chat log seeded this run.
    recording_id: Mapped[int | None] = mapped_column(
        ForeignKey("meeting_recordings.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # User who triggered generation (host or any participant w/ access).
    requested_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    status: Mapped[str] = mapped_column(String(24), default=INTEL_STATUS_PENDING)
    source: Mapped[str] = mapped_column(String(24), default=INTEL_SOURCE_CHAT)
    model_used: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Short headline summary; duplicated out of `payload` for cheap list views.
    tldr: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Full structured analysis. Schema is described in core/ai.py;
    # treated as opaque JSON at the DB layer so new keys don't need migrations.
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Token + latency telemetry the UI can show.
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    meeting: Mapped[Meeting] = relationship()
