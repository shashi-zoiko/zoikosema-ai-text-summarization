"""Admin delete-user cascade.

Runs standalone (no pytest needed):

    server/venv/Scripts/python.exe tests/test_admin_delete_user.py

Guards the reported "Delete User does nothing" bug: a bare delete of a user who
had hosted a meeting / sent chat hit a RESTRICT foreign key and 500'd, so the
row stayed. The endpoint now unwinds dependents first, and refuses (400) when
the user still owns an organization.
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

# SQLite ignores ON DELETE unless foreign-key enforcement is switched on. Turn it
# on for every connection so this test actually exercises the FK behaviour the
# fix relies on (meetings.id CASCADE + the RESTRICT users.id FKs we unwind).
from sqlalchemy import event                               # noqa: E402


@event.listens_for(_test_engine, "connect")
def _fk_pragma(conn, _):
    conn.execute("PRAGMA foreign_keys=ON")


from fastapi.testclient import TestClient                  # noqa: E402
from app.core.database import Base, SessionLocal           # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.models.user import User                           # noqa: E402
from app.models.meeting import Meeting                     # noqa: E402
from app.models.chat import Channel, ChannelMember, Message  # noqa: E402
from app.models.organization import Organization           # noqa: E402
from app.main import app                                   # noqa: E402

Base.metadata.create_all(bind=_test_engine)
client = TestClient(app)

_uid = [0]


def _make_user(is_admin=False) -> User:
    db = SessionLocal()
    try:
        _uid[0] += 1
        u = User(email=f"u{_uid[0]}@example.com", name=f"U{_uid[0]}",
                 password_hash=hash_password("x"), is_admin=is_admin)
        db.add(u)
        db.commit()
        db.refresh(u)
        return u
    finally:
        db.close()


# Burn user id 1 (legacy bootstrap admin) so real subjects are id > 1.
_make_user(is_admin=False)


def _auth(u):
    return {"Authorization": f"Bearer {create_access_token(subject=str(u.id))}"}


def _seed_content(owner_id: int, other_id: int):
    """Give `owner_id` a hosted meeting and a chat message shared with `other_id`."""
    db = SessionLocal()
    try:
        m = Meeting(code=f"aaa-bbbb-{owner_id:03d}", title="Owned meeting", host_id=owner_id)
        db.add(m)
        ch = Channel(name="team", created_by=owner_id)
        db.add(ch)
        db.flush()
        db.add(ChannelMember(channel_id=ch.id, user_id=owner_id))
        db.add(ChannelMember(channel_id=ch.id, user_id=other_id))
        db.add(Message(channel_id=ch.id, sender_id=owner_id, body="hi"))
        db.commit()
        return ch.id
    finally:
        db.close()


def test_delete_user_with_content_succeeds():
    admin = _make_user(is_admin=True)
    victim = _make_user()
    bystander = _make_user()
    channel_id = _seed_content(victim.id, bystander.id)

    r = client.delete(f"/api/admin/users/{victim.id}", headers=_auth(admin))
    assert r.status_code == 204, f"expected 204, got {r.status_code}: {r.text}"

    db = SessionLocal()
    try:
        assert db.get(User, victim.id) is None, "user row should be gone"
        # Their hosted meeting is cascaded away...
        assert db.scalar(
            Meeting.__table__.select().where(Meeting.host_id == victim.id)
        ) is None
        # ...but the shared channel survives, reassigned to the acting admin.
        ch = db.get(Channel, channel_id)
        assert ch is not None, "shared channel should survive"
        assert ch.created_by == admin.id, "channel should be reassigned to admin"
    finally:
        db.close()
    print("  [OK] deleting a user with a hosted meeting + chat -> 204, channel survives")


def test_delete_user_owning_org_blocked():
    admin = _make_user(is_admin=True)
    owner = _make_user()
    db = SessionLocal()
    try:
        db.add(Organization(name="Acme", slug=f"acme-{owner.id}", owner_id=owner.id))
        db.commit()
    finally:
        db.close()

    r = client.delete(f"/api/admin/users/{owner.id}", headers=_auth(admin))
    assert r.status_code == 400, f"expected 400 guard, got {r.status_code}: {r.text}"
    assert "ownership" in r.text.lower()
    # The user must still exist after a refused delete.
    db = SessionLocal()
    try:
        assert db.get(User, owner.id) is not None
    finally:
        db.close()
    print("  [OK] deleting an org owner -> 400 (guarded), user preserved")


def test_delete_self_blocked():
    admin = _make_user(is_admin=True)
    r = client.delete(f"/api/admin/users/{admin.id}", headers=_auth(admin))
    assert r.status_code == 400, r.text
    print("  [OK] admin deleting own account -> 400")


def main():
    tests = [
        test_delete_user_with_content_succeeds,
        test_delete_user_owning_org_blocked,
        test_delete_self_blocked,
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
