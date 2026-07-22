"""Unit tests for the legacy-meeting audit bridge (ZS-MTG-IMP-04).

Pure/mocked — no DB. Verifies the two guarantees that make it safe to retrofit
onto the critical admission/role paths:
  1. It emits the right audit event (opaque ids + metadata, own commit).
  2. It NEVER raises — any failure is swallowed and rolled back.
"""
import app.audit_meeting as am


class FakeUser:
    id = 42


class FakeTenant:
    tenant_id = "org:7"


class RecordingDB:
    def __init__(self, fail=False):
        self.committed = False
        self.rolled_back = False
        self._fail = fail

    def commit(self):
        if self._fail:
            raise RuntimeError("db down")
        self.committed = True

    def rollback(self):
        self.rolled_back = True


def test_emits_expected_event(monkeypatch):
    captured = {}

    def fake_log(db, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(am, "resolve_tenant", lambda db, user: FakeTenant())
    monkeypatch.setattr(am.audit, "log", fake_log)

    db = RecordingDB()
    am.audit_meeting_action(
        db, user=FakeUser(), event_type=am.ADMIT, meeting_id=101,
        metadata={"target_user_id": 5},
    )

    assert db.committed is True
    assert captured["type"] == "meeting.admission.admit"
    assert captured["tenant_id"] == "org:7"
    assert captured["resource_type"] == "meeting"
    assert captured["resource_id"] == "101"
    assert captured["actor_user_id"] == 42
    assert captured["metadata"] == {"target_user_id": 5}
    # Opaque-only: no name/email/message keys ever forwarded.
    for banned in ("name", "email", "message", "avatar"):
        assert banned not in captured["metadata"]


def test_never_raises_and_rolls_back_on_failure(monkeypatch):
    monkeypatch.setattr(am, "resolve_tenant", lambda db, user: FakeTenant())

    def boom(db, **kwargs):
        raise RuntimeError("audit table missing")

    monkeypatch.setattr(am.audit, "log", boom)

    db = RecordingDB()
    # Must not raise even though audit.log blows up.
    am.audit_meeting_action(db, user=FakeUser(), event_type=am.DENY, meeting_id=1, metadata={})
    assert db.rolled_back is True


def test_tenant_resolution_failure_is_swallowed(monkeypatch):
    def boom(db, user):
        raise RuntimeError("no tenant")

    monkeypatch.setattr(am, "resolve_tenant", boom)
    db = RecordingDB()
    # A tenant-resolution failure must not break the calling privileged action.
    am.audit_meeting_action(db, user=FakeUser(), event_type=am.ROLE_CHANGE, meeting_id=9, metadata={"role": "co_host"})
    # Nothing committed; no exception propagated.
    assert db.committed is False
