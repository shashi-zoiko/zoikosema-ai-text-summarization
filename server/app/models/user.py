from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nullable for guest users — anonymous meeting joiners have no email/password.
    # Postgres allows many NULLs under a UNIQUE index, so real accounts stay unique
    # while guests coexist with email=NULL. See app/core/guest.py + the guest-token
    # endpoint in app/api/meetings.py.
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_color: Mapped[str] = mapped_column(String(16), default="#5b8def")
    # Uploaded profile photo, served from /api/uploads/. NULL → fall back to
    # coloured initials (avatar_color). Set via POST /api/auth/avatar.
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Extra profile fields shown on the dashboard / people panels.
    job_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    pronouns: Mapped[str | None] = mapped_column(String(40), nullable=True)
    bio: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Per-surface photo visibility. When off, that surface falls back to
    # coloured initials even if a photo is set.
    show_photo_in_meetings: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    show_photo_on_dashboard: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Billing plan for AI gateway rate limiting and feature gating
    plan: Mapped[str] = mapped_column(String(32), default="free", nullable=False)
    # Platform admin flag — gates the /api/admin/* dashboard endpoints. Replaces
    # the old hardcoded "admin == user id 1" assumption. Granted via the
    # ADMIN_EMAILS setting (synced on startup) or by promoting a user directly.
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Guest (anonymous) account flags. is_guest rows are ephemeral: created at
    # meeting join, purged when the meeting ends or guest_expires_at passes
    # (see app/core/guest_cleanup.py). get_current_user rejects guest tokens, so
    # a guest row can never authenticate against account-only endpoints.
    is_guest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    guest_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
