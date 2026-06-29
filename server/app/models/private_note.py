from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PrivateNote(Base):
    """A single participant's PRIVATE notebook for one meeting.

    This is deliberately per-(meeting, user) and never shared: the notes,
    drawing, sticky notes, and canvas viewport belong only to the user who
    wrote them. There is no broadcast / WS relay for this data — it is
    persisted and fetched solely through the authenticated REST private-notes
    API, scoped server-side to the JWT's user_id. One row per user per meeting
    (enforced by the unique constraint).
    """

    __tablename__ = "meeting_private_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), index=True
    )
    # ondelete=CASCADE so a deleted user (e.g. an expired guest reclaimed by
    # guest_cleanup) takes their private notebook with them at the DB level.
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # TipTap rich-text document.
    notes_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Personal drawing canvas: { "strokes": [...] }.
    drawing_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # Reserved for Phase 2 (personal sticky notes): [...].
    sticky_notes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Canvas viewport / pan-zoom state: { "viewport": {scale, x, y} }.
    canvas_state: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    meeting: Mapped["Meeting"] = relationship()  # noqa: F821
    user: Mapped["User"] = relationship()  # noqa: F821

    __table_args__ = (
        UniqueConstraint("meeting_id", "user_id", name="uq_private_note_meeting_user"),
    )
