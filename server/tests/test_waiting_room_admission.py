"""End-to-end tests for waiting-room admission.

Runs WITHOUT pytest (pytest isn't installed in the venv) — execute directly:

    server/venv/Scripts/python.exe tests/test_waiting_room_admission.py

It spins up the real FastAPI app against an in-memory SQLite DB (StaticPool so
the single connection is shared across the TestClient's threads), then drives
the admission flow through the public REST + WebSocket surface.

Covered (Phase 9 success criteria):
  * single-user admission delivers an 'admitted' push in < 1 s, no client ping
  * idempotent re-admit (double-click) does not error
  * Admit Everyone (batch endpoint) admits N waiters in ONE request
  * deny delivers a 'denied' push
  * a backgrounded client (sends NO keepalive ping) is still admitted promptly
    — the regression that caused "stuck in waiting room"
  * 20+ concurrent waiters all admitted via admit-all
"""

import os
import sys
import time

# ── Wire an isolated in-memory DB BEFORE the app modules bind SessionLocal ──
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

# Import the rest AFTER patching so every `from app.core.database import …`
# binds to the test engine/session.
from fastapi.testclient import TestClient                  # noqa: E402
from app.core.database import Base, SessionLocal           # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.models.user import User                           # noqa: E402
from app.models.meeting import (                           # noqa: E402
    MeetingParticipant, STATUS_PENDING, STATUS_ADMITTED,
)
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


def _create_meeting(host_token: str) -> str:
    r = client.post("/api/meetings", json={"title": "T", "waiting_room_enabled": True}, headers=_auth(host_token))
    assert r.status_code == 201, r.text
    return r.json()["code"]


# ── Test cases ──────────────────────────────────────────────────────────────

def test_single_admission_pushes_instantly():
    host_id, host_tok = _make_user("host")
    guest_id, guest_tok = _make_user("guest")
    code = _create_meeting(host_tok)

    # Guest joins → pending (waiting room on)
    r = client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(guest_tok))
    assert r.json()["status"] == STATUS_PENDING

    # Guest holds open the waiting WS (NO keepalive ping is sent — proving the
    # admission no longer depends on the client pinging).
    with client.websocket_connect(f"/ws/meetings/{code}?token={guest_tok}") as gws:
        assert gws.receive_json()["type"] == "waiting-room-hold"

        t0 = time.time()
        # Host admits over REST.
        r = client.post(f"/api/meetings/{code}/admit", json={"user_id": guest_id}, headers=_auth(host_tok))
        assert r.status_code == 200, r.text

        msg = gws.receive_json()
        dt = time.time() - t0
        assert msg["type"] == "admitted", msg
        assert dt < 1.0, f"admission took {dt:.3f}s (target < 1s)"
    print(f"  [OK] single admission pushed in {dt*1000:.0f}ms (no client ping)")


def test_admit_is_idempotent():
    host_id, host_tok = _make_user("host")
    guest_id, guest_tok = _make_user("guest")
    code = _create_meeting(host_tok)
    client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(guest_tok))

    r1 = client.post(f"/api/meetings/{code}/admit", json={"user_id": guest_id}, headers=_auth(host_tok))
    r2 = client.post(f"/api/meetings/{code}/admit", json={"user_id": guest_id}, headers=_auth(host_tok))
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    assert r2.json()["status"] == STATUS_ADMITTED
    print("  [OK] double-click admit is idempotent (200, not 404)")


def test_admit_all_batch():
    host_id, host_tok = _make_user("host")
    code = _create_meeting(host_tok)
    guests = []
    for i in range(20):
        gid, gtok = _make_user(f"g{i}")
        client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(gtok))
        guests.append(gid)

    r = client.post(f"/api/meetings/{code}/admit-all", headers=_auth(host_tok))
    assert r.status_code == 200, r.text
    assert sorted(r.json()["admitted"]) == sorted(guests), r.json()

    db = SessionLocal()
    try:
        pending = db.query(MeetingParticipant).filter(
            MeetingParticipant.status == STATUS_PENDING,
        ).count()
        assert pending == 0, f"{pending} still pending after admit-all"
    finally:
        db.close()
    print("  [OK] admit-all admitted 20 waiters in ONE request, 0 left pending")


def test_deny_pushes():
    host_id, host_tok = _make_user("host")
    guest_id, guest_tok = _make_user("guest")
    code = _create_meeting(host_tok)
    client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(guest_tok))

    with client.websocket_connect(f"/ws/meetings/{code}?token={guest_tok}") as gws:
        assert gws.receive_json()["type"] == "waiting-room-hold"
        r = client.post(f"/api/meetings/{code}/deny", json={"user_id": guest_id}, headers=_auth(host_tok))
        assert r.status_code == 200, r.text
        assert gws.receive_json()["type"] == "denied"
    print("  [OK] deny pushes 'denied' to the waiting client")


def test_non_host_cannot_admit():
    host_id, host_tok = _make_user("host")
    g1, g1_tok = _make_user("g1")
    g2, g2_tok = _make_user("g2")
    code = _create_meeting(host_tok)
    client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(g1_tok))
    client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(g2_tok))
    r = client.post(f"/api/meetings/{code}/admit", json={"user_id": g1}, headers=_auth(g2_tok))
    assert r.status_code == 403, r.text
    print("  [OK] non-host admit is rejected (403)")


def main():
    tests = [
        test_single_admission_pushes_instantly,
        test_admit_is_idempotent,
        test_admit_all_batch,
        test_deny_pushes,
        test_non_host_cannot_admit,
    ]
    failures = 0
    for t in tests:
        try:
            t()
        except Exception as e:  # noqa: BLE001
            failures += 1
            print(f"  [FAIL] {t.__name__}: {e!r}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
