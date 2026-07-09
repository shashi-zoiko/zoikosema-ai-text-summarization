"""Admin surface access control.

Runs standalone (no pytest needed):

    server/venv/Scripts/python.exe tests/test_admin_access.py

Guards the P0 tenant-privacy fix: /api/admin/* is admin-only (403 for members,
zero data) and unchanged for admins.
"""

import os
import sys

os.environ.setdefault("DATABASE_URL", "")
os.environ.setdefault("MEDIA_PROVIDER", "mesh")
os.environ.setdefault("JWT_SECRET", "test-secret-key-not-for-prod")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine                      # noqa: E402
from sqlalchemy.orm import sessionmaker                    # noqa: E402
from sqlalchemy.pool import StaticPool                     # noqa: E402

import app.core.database as dbmod                          # noqa: E402

_test_engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
dbmod.engine = _test_engine
dbmod.SessionLocal = sessionmaker(bind=_test_engine, autoflush=False, autocommit=False)

from fastapi.testclient import TestClient                  # noqa: E402
from app.core.database import Base, SessionLocal           # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.models.user import User                           # noqa: E402
from app.main import app                                   # noqa: E402

Base.metadata.create_all(bind=_test_engine)
client = TestClient(app)

_uid = [0]

ADMIN_ENDPOINTS = ["/api/admin/stats", "/api/admin/users", "/api/admin/meetings", "/api/admin/activity"]


def _make_user(is_admin: bool) -> str:
    # NOTE: user id 1 is a legacy bootstrap admin (LEGACY_ADMIN_USER_IDS), so a
    # filler occupies it first (see module bottom) — real members are id > 1.
    db = SessionLocal()
    try:
        _uid[0] += 1
        u = User(email=f"u{_uid[0]}@example.com", name="U", password_hash=hash_password("x"), is_admin=is_admin)
        db.add(u)
        db.commit()
        db.refresh(u)
        return create_access_token(subject=str(u.id))
    finally:
        db.close()


# Burn user id 1 (the single-owner bootstrap admin) so tested members are id > 1.
_make_user(is_admin=False)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_member_blocked_from_every_admin_endpoint():
    tok = _make_user(is_admin=False)
    for ep in ADMIN_ENDPOINTS:
        r = client.get(ep, headers=_auth(tok))
        assert r.status_code == 403, f"{ep} returned {r.status_code}, expected 403"
        # Forbidden means zero data — no user list / stats leak in the body.
        assert "email" not in r.text.lower(), f"{ep} leaked data on 403: {r.text[:200]}"
    print("  [OK] member -> 403 (zero data) on every admin endpoint")


def test_unauthenticated_blocked():
    r = client.get("/api/admin/users")
    assert r.status_code == 401, r.status_code
    print("  [OK] no token -> 401")


def test_admin_allowed():
    tok = _make_user(is_admin=True)
    r = client.get("/api/admin/users", headers=_auth(tok))
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
    assert client.get("/api/admin/stats", headers=_auth(tok)).status_code == 200
    print("  [OK] admin -> 200 with data")


def test_is_admin_exposed_to_client():
    # /me must surface is_admin so the frontend can gate the nav + /admin route.
    tok = _make_user(is_admin=True)
    body = client.get("/api/auth/me", headers=_auth(tok)).json()
    assert body.get("is_admin") is True, body
    member = client.get("/api/auth/me", headers=_auth(_make_user(is_admin=False))).json()
    assert member.get("is_admin") is False, member
    print("  [OK] /me exposes is_admin (true for admin, false for member)")


def main():
    tests = [
        test_member_blocked_from_every_admin_endpoint,
        test_unauthenticated_blocked,
        test_admin_allowed,
        test_is_admin_exposed_to_client,
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
