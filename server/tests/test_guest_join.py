"""End-to-end tests for anonymous Guest Join.

Runs WITHOUT pytest (pytest isn't installed in the venv) — execute directly:

    server/venv/Scripts/python.exe tests/test_guest_join.py

Spins up the real FastAPI app against an in-memory SQLite DB (StaticPool so the
single connection is shared across the TestClient threads) and drives the guest
flow through the public REST + WebSocket surface.

Covered:
  * guest token issuance + claims (type=guest, sanitized name)
  * display-name validation (too short / too long / HTML / zero-width unicode)
  * guests_enabled=false -> 403, locked -> 403, wrong password -> 403
  * waiting-room: guest /join -> pending -> host admit -> WS 'admitted' push
  * waiting-room off -> guest admitted directly
  * dependency split: guest token ACCEPTED by participant endpoints,
    REJECTED (401) by account-only endpoints + host actions
  * roster marks the guest row is_guest=true
  * rate limit: 21st guest-token from one IP -> 429
  * reconnect: the same guest token re-joins (admitted/disconnected) cleanly
  * regression: authenticated join is unchanged (is_guest=false)
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
from app.core.security import (                            # noqa: E402
    create_access_token, decode_token, decode_token_any, hash_password,
)
from app.core.rate_limit import guest_join_limiter, invalid_room_limiter  # noqa: E402
from app.models.user import User                           # noqa: E402
from app.models.meeting import STATUS_PENDING, STATUS_ADMITTED  # noqa: E402
from app.main import app                                   # noqa: E402

Base.metadata.create_all(bind=_test_engine)

client = TestClient(app)

_uid = [0]


def _reset_limits():
    guest_join_limiter._hits.clear()
    invalid_room_limiter._hits.clear()


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
    payload = {"title": "T", "waiting_room_enabled": True}
    payload.update(body)
    r = client.post("/api/meetings", json=payload, headers=_auth(host_token))
    assert r.status_code == 201, r.text
    return r.json()["code"]


def _guest_token(code: str, display_name="Guest User", password=None, headers=None):
    body = {"display_name": display_name}
    if password is not None:
        body["password"] = password
    return client.post(f"/api/meetings/{code}/guest-token", json=body, headers=headers or {})


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_guest_token_issued():
    _reset_limits()
    _, host_tok = _make_user("host")
    code = _create_meeting(host_tok)
    r = _guest_token(code, "Ashraf")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["is_guest"] is True
    assert body["name"] == "Ashraf"
    assert body["waiting_room_enabled"] is True
    # Token decodes as a guest token, and is REJECTED as an access token.
    sub, ttype = decode_token_any(body["access_token"])
    assert ttype == "guest" and str(sub) == str(body["user_id"])
    assert decode_token(body["access_token"]) is None
    print("  [OK] guest token issued with type=guest, rejected as access")


def test_name_validation():
    _reset_limits()
    _, host_tok = _make_user("host")
    code = _create_meeting(host_tok)
    # too short
    assert _guest_token(code, "a").status_code == 422
    # too long
    assert _guest_token(code, "x" * 60).status_code == 422
    # HTML stripped (no angle brackets survive)
    r = _guest_token(code, "<b>Bob</b>")
    assert r.status_code == 201 and "<" not in r.json()["name"] and ">" not in r.json()["name"]
    # zero-width unicode collapsed
    r = _guest_token(code, "A​B​C")
    assert r.status_code == 201 and r.json()["name"] == "ABC"
    print("  [OK] name validation: short/long rejected, HTML + zero-width stripped")


def test_guests_disabled_blocks():
    _reset_limits()
    _, host_tok = _make_user("host")
    code = _create_meeting(host_tok)
    assert client.patch(f"/api/meetings/{code}", json={"guests_enabled": False}, headers=_auth(host_tok)).status_code == 200
    assert _guest_token(code, "Nope").status_code == 403
    print("  [OK] guests_enabled=false -> 403")


def test_locked_blocks():
    _reset_limits()
    _, host_tok = _make_user("host")
    code = _create_meeting(host_tok)
    assert client.patch(f"/api/meetings/{code}", json={"locked": True}, headers=_auth(host_tok)).status_code == 200
    assert _guest_token(code, "Nope").status_code == 403
    print("  [OK] locked meeting -> 403 for guests")


def test_password_enforced():
    _reset_limits()
    _, host_tok = _make_user("host")
    code = _create_meeting(host_tok, password="s3cret!")
    assert _guest_token(code, "Bob").status_code == 403           # missing
    assert _guest_token(code, "Bob", password="wrong").status_code == 403
    assert _guest_token(code, "Bob", password="s3cret!").status_code == 201
    print("  [OK] meeting password enforced for guests")


def test_guest_waiting_then_admit():
    _reset_limits()
    host_id, host_tok = _make_user("host")
    code = _create_meeting(host_tok)  # waiting room ON
    g = _guest_token(code, "Wanda").json()
    gtok = g["access_token"]
    # Guest joins -> pending
    r = client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(gtok))
    assert r.status_code == 200 and r.json()["status"] == STATUS_PENDING, r.text
    # Guest holds the waiting WS; host admits -> 'admitted' push
    with client.websocket_connect(f"/ws/meetings/{code}?token={gtok}") as gws:
        assert gws.receive_json()["type"] == "waiting-room-hold"
        ar = client.post(f"/api/meetings/{code}/admit", json={"user_id": g["user_id"]}, headers=_auth(host_tok))
        assert ar.status_code == 200, ar.text
        assert gws.receive_json()["type"] == "admitted"
    print("  [OK] guest waiting-room admit pushes 'admitted'")


def test_guest_direct_admit_when_waiting_off():
    _reset_limits()
    _, host_tok = _make_user("host")
    code = _create_meeting(host_tok, waiting_room_enabled=False)
    gtok = _guest_token(code, "Direct").json()["access_token"]
    r = client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(gtok))
    assert r.status_code == 200 and r.json()["status"] == STATUS_ADMITTED, r.text
    print("  [OK] waiting room off -> guest admitted directly")


def test_dependency_split_and_roster_flag():
    _reset_limits()
    host_id, host_tok = _make_user("host")
    code = _create_meeting(host_tok, waiting_room_enabled=False)
    g = _guest_token(code, "Roster Guest").json()
    gtok = g["access_token"]
    client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(gtok))

    # Participant endpoint accepts the guest token …
    rp = client.get(f"/api/meetings/{code}/participants", headers=_auth(gtok))
    assert rp.status_code == 200, rp.text
    me = [p for p in rp.json()["participants"] if p["user_id"] == g["user_id"]]
    assert me and me[0]["is_guest"] is True, rp.text

    # … but the account-only meeting endpoint rejects it (401), as do host actions.
    assert client.get(f"/api/meetings/{code}", headers=_auth(gtok)).status_code == 401
    assert client.post(f"/api/meetings/{code}/end", headers=_auth(gtok)).status_code == 401
    assert client.post("/api/meetings", json={"title": "x"}, headers=_auth(gtok)).status_code == 401
    print("  [OK] guest token accepted by participant endpoints, rejected by account-only ones")


def test_unjoined_guest_cannot_get_media_token():
    _reset_limits()
    _, host_tok = _make_user("host")
    code = _create_meeting(host_tok, waiting_room_enabled=False)
    gtok = _guest_token(code, "NoJoin").json()["access_token"]
    # No /join first. With MEDIA_PROVIDER=mesh the endpoint 503s before membership,
    # so we only assert it is NOT a 200 (no token leaks to an unjoined guest).
    r = client.post(f"/api/meetings/{code}/media-token", headers=_auth(gtok))
    assert r.status_code in (403, 503), r.text
    print("  [OK] unjoined guest gets no media token")


def test_rate_limit():
    _reset_limits()
    _, host_tok = _make_user("host")
    code = _create_meeting(host_tok, waiting_room_enabled=False)
    xff = {"X-Forwarded-For": "203.0.113.50"}
    ok = 0
    for _ in range(20):
        if _guest_token(code, "RL", headers=xff).status_code == 201:
            ok += 1
    assert ok == 20, ok
    assert _guest_token(code, "RL", headers=xff).status_code == 429
    print("  [OK] 21st guest-token from one IP -> 429")


def test_reconnect_reuses_token():
    _reset_limits()
    _, host_tok = _make_user("host")
    code = _create_meeting(host_tok, waiting_room_enabled=False)
    gtok = _guest_token(code, "Recon").json()["access_token"]
    r1 = client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(gtok))
    r2 = client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(gtok))
    assert r1.status_code == 200 and r2.status_code == 200
    assert r2.json()["status"] == STATUS_ADMITTED
    print("  [OK] same guest token re-joins cleanly (reconnect)")


def test_authenticated_flow_unchanged():
    _reset_limits()
    _, host_tok = _make_user("host")
    uid, utok = _make_user("realuser")
    code = _create_meeting(host_tok, waiting_room_enabled=False)
    r = client.post(f"/api/meetings/{code}/join", json={"code": code}, headers=_auth(utok))
    assert r.status_code == 200 and r.json()["status"] == STATUS_ADMITTED
    roster = client.get(f"/api/meetings/{code}/participants", headers=_auth(host_tok)).json()
    me = [p for p in roster["participants"] if p["user_id"] == uid][0]
    assert me["is_guest"] is False
    print("  [OK] authenticated join unchanged (is_guest=false)")


def main():
    tests = [
        test_guest_token_issued,
        test_name_validation,
        test_guests_disabled_blocks,
        test_locked_blocks,
        test_password_enforced,
        test_guest_waiting_then_admit,
        test_guest_direct_admit_when_waiting_off,
        test_dependency_split_and_roster_flag,
        test_unjoined_guest_cannot_get_media_token,
        test_rate_limit,
        test_reconnect_reuses_token,
        test_authenticated_flow_unchanged,
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
