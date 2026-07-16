"""Tests for the 'meeting started' activity log (Team activity feed fix).

Runs WITHOUT pytest — execute directly:

    server/venv/Scripts/python.exe tests/test_meeting_started_activity.py

Background: the Home page's "Team activity" list reads the notifications feed
(GET /api/notifications). Live meetings never showed up there because no
`meeting_started` notification was ever created — the feed only carried
invites/cancellations/reminders, so it looked frozen on stale entries.

The fix logs a `meeting_started` notification for the host the first time the
host joins (i.e. when the meeting actually goes live). These tests pin that
behaviour and its boundaries:

  * host's first join   -> exactly one meeting_started notification
  * host reconnect      -> no duplicate
  * create-a-link only  -> no notification until the host joins
  * a participant join   -> does not fabricate a host meeting_started
"""

import os
import sys

os.environ.setdefault("DATABASE_URL", "")  # force the sqlite fallback path
os.environ.setdefault("MEDIA_PROVIDER", "mesh")
os.environ.setdefault("JWT_SECRET", "test-secret-key-not-for-prod")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine                      # noqa: E402
from sqlalchemy.orm import sessionmaker                    # noqa: E402
from sqlalchemy.pool import StaticPool                     # noqa: E402

import app.core.database as dbmod                          # noqa: E402

_test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
dbmod.engine = _test_engine
dbmod.SessionLocal = sessionmaker(bind=_test_engine, autoflush=False, autocommit=False)

from fastapi.testclient import TestClient                  # noqa: E402
from app.core.database import Base, SessionLocal           # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.models.user import User                           # noqa: E402
from app.models.organization import NOTIF_MEETING_STARTED  # noqa: E402
from app.main import app                                   # noqa: E402

Base.metadata.create_all(bind=_test_engine)

client = TestClient(app)

_uid = [0]


def _make_user(name: str) -> tuple[int, str]:
    db = SessionLocal()
    try:
        _uid[0] += 1
        u = User(email=f"{name}{_uid[0]}@t.test", name=name, password_hash=hash_password("x"))
        db.add(u)
        db.commit()
        db.refresh(u)
        return u.id, create_access_token(subject=str(u.id))
    finally:
        db.close()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_meeting(host_token: str, **body) -> str:
    payload = {"title": "Instant meeting", "waiting_room_enabled": False}
    payload.update(body)
    r = client.post("/api/meetings", json=payload, headers=_auth(host_token))
    assert r.status_code == 201, r.text
    return r.json()["code"]


def _started_notifs(token: str) -> list[dict]:
    r = client.get("/api/notifications", headers=_auth(token))
    assert r.status_code == 200, r.text
    return [n for n in r.json() if n["type"] == NOTIF_MEETING_STARTED]


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_host_first_join_logs_started():
    _, host_tok = _make_user("host")
    # No notification purely from creating the meeting (create-a-link case).
    code = _create_meeting(host_tok)
    assert _started_notifs(host_tok) == [], "creating a meeting must not log 'started'"

    # Host joins -> meeting goes live -> exactly one meeting_started entry.
    r = client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(host_tok))
    assert r.status_code == 200, r.text
    started = _started_notifs(host_tok)
    assert len(started) == 1, started
    assert code in (started[0]["data"] or "")
    assert "Instant meeting" in started[0]["title"]
    print("  [OK] host first join logs exactly one meeting_started")


def test_host_reconnect_no_duplicate():
    _, host_tok = _make_user("host")
    code = _create_meeting(host_tok)
    for _ in range(3):
        client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(host_tok))
    started = _started_notifs(host_tok)
    assert len(started) == 1, f"reconnect must not duplicate: {started}"
    print("  [OK] host reconnect does not duplicate the activity entry")


def test_participant_join_does_not_log_for_host():
    host_id, host_tok = _make_user("host2")
    _, guest_user_tok = _make_user("member")
    code = _create_meeting(host_tok)
    # A non-host participant joins first; that alone must not create the host's
    # meeting_started (only the host's own join does).
    r = client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(guest_user_tok))
    assert r.status_code == 200, r.text
    assert _started_notifs(host_tok) == [], "participant join must not log host's meeting_started"
    # And the joining participant gets no meeting_started of their own.
    assert _started_notifs(guest_user_tok) == []
    print("  [OK] a participant's join does not fabricate a host meeting_started")


def main():
    tests = [
        test_host_first_join_logs_started,
        test_host_reconnect_no_duplicate,
        test_participant_join_does_not_log_for_host,
    ]
    failures = 0
    for t in tests:
        try:
            t()
        except Exception as e:  # noqa: BLE001
            failures += 1
            import traceback
            print(f"  [FAIL] {t.__name__}: {e!r}")
            traceback.print_exc()
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
