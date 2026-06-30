from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PasswordResetOTP(Base):
    """A single password-reset attempt for one email.

    Holds a HASHED 4-digit OTP (never the plaintext), keyed by the lowercased
    email rather than a user FK so the request endpoint can run identically
    whether or not an account exists (no enumeration via timing or shape).

    Lifecycle:
      forgot-password → insert a fresh row, invalidate older rows for the email
      verify-otp      → compare against otp_hash; on success set verified=True
                        and stamp a one-time reset_token_hash returned to the
                        client; reset-password requires that token back.
      reset-password  → consume the row (used_at) so the OTP and reset token
                        cannot be replayed.

    `attempts` counts failed verifications; once it hits the cap the row is
    dead and the user must request a new code.
    """

    __tablename__ = "password_reset_otps"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    otp_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Set only after a correct OTP — a one-time bearer the reset step must echo
    # back so knowing the email alone is not enough to change the password.
    reset_token_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
