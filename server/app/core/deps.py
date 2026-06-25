from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token, decode_token_any
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    """Resolve a signed-in (account) user. Rejects guest tokens.

    This is the gate on every account-only endpoint (dashboard, chat, org,
    host actions, …). Because it only accepts type "access", an anonymous
    guest token is rejected here with 401 regardless of role — guests can
    reach ONLY the endpoints that opt into get_current_participant.
    """
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    user_id = decode_token(token)
    if user_id is None:
        raise credentials_exc
    user = db.get(User, int(user_id))
    # A guest row must never authenticate as an account user even if it somehow
    # presented an "access"-typed token — defense in depth against token mix-ups.
    if user is None or user.is_guest:
        raise credentials_exc
    return user


def get_current_participant(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    """Resolve a meeting participant — a signed-in user OR an anonymous guest.

    Used only by the meeting join / media-token / roster / recording-state
    endpoints that guests legitimately need. Accepts both "access" and "guest"
    tokens; everything else stays on get_current_user and rejects guests.
    """
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    user_id, _token_type = decode_token_any(token)
    if user_id is None:
        raise credentials_exc
    user = db.get(User, int(user_id))
    if user is None:
        raise credentials_exc
    return user


def get_user_from_token(token: str, db: Session) -> User | None:
    """WS helper: resolve an account user from a token (rejects guests)."""
    user_id = decode_token(token)
    if user_id is None:
        return None
    user = db.get(User, int(user_id))
    if user is None or user.is_guest:
        return None
    return user


def get_participant_from_token(token: str, db: Session) -> User | None:
    """WS helper: resolve a participant (account user OR guest) from a token."""
    user_id, _token_type = decode_token_any(token)
    if user_id is None:
        return None
    return db.get(User, int(user_id))
