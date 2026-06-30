from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.email import send_password_reset_email
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_otp,
    generate_reset_token,
    hash_otp,
    hash_password,
    verify_otp,
    verify_password,
    blacklist_token,
    validate_password_strength,
)
from app.models.password_reset import PasswordResetOTP
from app.models.user import User
from app.schemas.user import TokenOut, UserCreate, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Generic, enumeration-safe reply for the request step: identical whether or
# not an account exists for the email.
_FORGOT_GENERIC = "If an account exists for this email, a verification code has been sent."

AVATAR_COLORS = ["#5b8def", "#f27167", "#47b881", "#d97706", "#8b5cf6", "#ec4899", "#0ea5e9"]


def _pick_color(email: str) -> str:
    return AVATAR_COLORS[hash(email) % len(AVATAR_COLORS)]


class RefreshIn(BaseModel):
    refresh_token: str


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class ProfileUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, db: Session = Depends(get_db)):
    # Validate password strength
    pw_err = validate_password_strength(data.password)
    if pw_err:
        raise HTTPException(status_code=400, detail=pw_err)

    existing = db.scalar(select(User).where(User.email == data.email.lower()))
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=data.email.lower(),
        name=data.name.strip(),
        password_hash=hash_password(data.password),
        avatar_color=_pick_color(data.email.lower()),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    access = create_access_token(subject=user.id)
    refresh = create_refresh_token(subject=user.id)
    return TokenOut(
        access_token=access,
        refresh_token=refresh,
        user=UserOut.model_validate(user),
    )


@router.post("/login", response_model=TokenOut)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == form.username.lower()))
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    access = create_access_token(subject=user.id)
    refresh = create_refresh_token(subject=user.id)
    return TokenOut(
        access_token=access,
        refresh_token=refresh,
        user=UserOut.model_validate(user),
    )


@router.post("/refresh", response_model=TokenOut)
def refresh_token(data: RefreshIn, db: Session = Depends(get_db)):
    user_id = decode_token(data.refresh_token, expected_type="refresh")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    user = db.get(User, int(user_id))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # Blacklist old refresh token (single-use rotation)
    blacklist_token(data.refresh_token)
    access = create_access_token(subject=user.id)
    refresh = create_refresh_token(subject=user.id)
    return TokenOut(
        access_token=access,
        refresh_token=refresh,
        user=UserOut.model_validate(user),
    )


@router.post("/logout", status_code=204)
def logout(authorization: str = Header(default="")):
    """Blacklist the current access token so it can't be reused."""
    token = authorization.replace("Bearer ", "").strip()
    if token:
        blacklist_token(token)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", status_code=200)
def change_password(
    data: PasswordChangeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=403, detail="Current password is incorrect")
    pw_err = validate_password_strength(data.new_password)
    if pw_err:
        raise HTTPException(status_code=400, detail=pw_err)
    user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"detail": "Password changed successfully"}


@router.patch("/profile", response_model=UserOut)
def update_profile(
    data: ProfileUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data.name is not None:
        user.name = data.name.strip()
    db.commit()
    db.refresh(user)
    return user


@router.delete("/account", status_code=204)
def delete_account(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    authorization: str = Header(default=""),
):
    """Permanently delete the current user's account."""
    token = authorization.replace("Bearer ", "").strip()
    if token:
        blacklist_token(token)
    db.delete(user)
    db.commit()


# ── Password reset (OTP) ────────────────────────────────────────────────────


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class VerifyOtpIn(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=4, max_length=8)


class ResetPasswordIn(BaseModel):
    email: EmailStr
    reset_token: str
    new_password: str = Field(min_length=8, max_length=128)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(dt: datetime | None) -> datetime | None:
    """Normalize naive timestamps (some DB drivers drop tzinfo) to UTC-aware."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@router.post("/forgot-password", status_code=200)
def forgot_password(data: ForgotPasswordIn, db: Session = Depends(get_db)):
    """Issue a 4-digit OTP for a password reset and email it via Resend.

    Always returns the same generic response so an attacker cannot tell whether
    an account exists. An OTP is only generated/sent when the email maps to a
    real, non-guest account and the per-email hourly cap hasn't been hit.
    """
    settings = get_settings()
    email = data.email.lower().strip()
    now = _now()

    # Opportunistic cleanup: drop this email's stale/expired rows.
    for row in db.scalars(select(PasswordResetOTP).where(PasswordResetOTP.email == email)).all():
        if row.used_at is not None or (_as_aware(row.expires_at) and _as_aware(row.expires_at) < now):
            db.delete(row)
    db.flush()

    user = db.scalar(select(User).where(User.email == email))
    if not user or user.is_guest or not user.password_hash:
        db.commit()
        return {"detail": _FORGOT_GENERIC}

    # Per-email rate limit. Silently skip sending (still generic 200) so the
    # cap can't be used to probe which emails exist.
    window_start = now - timedelta(hours=1)
    recent = db.scalar(
        select(func.count())
        .select_from(PasswordResetOTP)
        .where(PasswordResetOTP.email == email, PasswordResetOTP.created_at >= window_start)
    )
    if (recent or 0) >= settings.otp_requests_per_hour:
        db.commit()
        return {"detail": _FORGOT_GENERIC}

    # Invalidate any earlier live codes for this email — one active OTP at a time.
    for row in db.scalars(
        select(PasswordResetOTP).where(
            PasswordResetOTP.email == email, PasswordResetOTP.used_at.is_(None)
        )
    ).all():
        row.used_at = now

    otp = generate_otp(4)
    record = PasswordResetOTP(
        email=email,
        otp_hash=hash_otp(otp),
        expires_at=now + timedelta(minutes=settings.otp_expiry_minutes),
    )
    db.add(record)
    db.commit()

    send_password_reset_email(user.email, user.name, otp, settings.otp_expiry_minutes)
    return {"detail": _FORGOT_GENERIC}


@router.post("/verify-otp", status_code=200)
def verify_reset_otp(data: VerifyOtpIn, db: Session = Depends(get_db)):
    """Validate an OTP. On success returns a one-time reset_token for step 3."""
    settings = get_settings()
    email = data.email.lower().strip()
    now = _now()

    record = db.scalar(
        select(PasswordResetOTP)
        .where(PasswordResetOTP.email == email, PasswordResetOTP.used_at.is_(None))
        .order_by(PasswordResetOTP.created_at.desc())
    )
    if record is None:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code.")
    if _as_aware(record.expires_at) and _as_aware(record.expires_at) < now:
        record.used_at = now
        db.commit()
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new one.")
    if record.attempts >= settings.otp_max_attempts:
        record.used_at = now
        db.commit()
        raise HTTPException(status_code=400, detail="Too many attempts. Please request a new code.")

    if not verify_otp(data.otp.strip(), record.otp_hash):
        record.attempts += 1
        exhausted = record.attempts >= settings.otp_max_attempts
        if exhausted:
            record.used_at = now
        db.commit()
        if exhausted:
            raise HTTPException(status_code=400, detail="Too many attempts. Please request a new code.")
        remaining = settings.otp_max_attempts - record.attempts
        raise HTTPException(
            status_code=400,
            detail=f"Invalid verification code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.",
        )

    # Correct OTP → mint a one-time reset token and give the user a fresh window
    # to type the new password.
    reset_token = generate_reset_token()
    record.verified = True
    record.verified_at = now
    record.reset_token_hash = hash_otp(reset_token)
    record.expires_at = now + timedelta(minutes=settings.otp_expiry_minutes)
    db.commit()
    return {"reset_token": reset_token, "detail": "Verification successful."}


@router.post("/reset-password", status_code=200)
def reset_password(data: ResetPasswordIn, db: Session = Depends(get_db)):
    """Set a new password given a verified OTP's one-time reset token."""
    email = data.email.lower().strip()
    now = _now()

    pw_err = validate_password_strength(data.new_password)
    if pw_err:
        raise HTTPException(status_code=400, detail=pw_err)

    record = db.scalar(
        select(PasswordResetOTP)
        .where(
            PasswordResetOTP.email == email,
            PasswordResetOTP.verified.is_(True),
            PasswordResetOTP.used_at.is_(None),
            PasswordResetOTP.reset_token_hash.is_not(None),
        )
        .order_by(PasswordResetOTP.created_at.desc())
    )
    invalid = HTTPException(
        status_code=400, detail="Your reset session is invalid or has expired. Please start over."
    )
    if record is None:
        raise invalid
    if _as_aware(record.expires_at) and _as_aware(record.expires_at) < now:
        record.used_at = now
        db.commit()
        raise invalid
    if not verify_otp(data.reset_token, record.reset_token_hash):
        raise invalid

    user = db.scalar(select(User).where(User.email == email))
    if not user or not user.password_hash:
        record.used_at = now
        db.commit()
        raise invalid

    user.password_hash = hash_password(data.new_password)
    # Consume this record and any other outstanding codes for the email so the
    # OTP and reset token cannot be replayed.
    for row in db.scalars(
        select(PasswordResetOTP).where(
            PasswordResetOTP.email == email, PasswordResetOTP.used_at.is_(None)
        )
    ).all():
        row.used_at = now
    db.commit()
    return {"detail": "Password updated successfully."}
