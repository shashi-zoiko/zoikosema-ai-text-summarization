"""Tests for the stale-meeting reaper (app/core/meeting_reaper.py).

Runs WITHOUT pytest — execute directly:

    server/venv/Scripts/python.exe tests/test_meeting_reaper.py

Background: an abandoned instant meeting never had its `is_active` flag cleared
(nobody clicks "End", the LiveKit room_finished webhook may not fire), so the
dashboard showed it "Live" for days and clicking it routed back into a dead room.
The reaper marks such meetings ended. These tests pin the exact boundary of what
gets reaped and — just as importantly — what does NOT (a genuinely live meeting,
a fresh room, a not-yet-started scheduled meeting).
"""

import os
import sys
from datetime import datetime, timedelta, timezone

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

from app.core.database import Base, SessionLocal           # noqa: E402
from app.core.security import hash_password                # noqa: E402
from app.models.user import User                           # noqa: E402
from app.models.meeting import (                           # noqa: E402
    Meeting,
    MeetingParticipant,
    STATUS_ADMITTED,
    STATUS_DISCONNECTED,
    STATUS_LEFT,
)
import app.core.meeting_reaper as reaper                   # noqa: E402

Base.metadata.create_all(bind=_test_engine)

_seq = [0]


def _now():
    return datetime.now(timezone.utc)


def _mk_host() -> int:
    db = SessionLocal()
    try:
        _seq[0] += 1
        u = User(email=f"h{_seq[0]}@t.test", name="Host", password_hash=hash_password("x"))
        db.add(u)
        db.commit()
        db.refresh(u)
        return u.id
    finally:
        db.close()


def _mk_meeting(host_id, *, is_active=True, created_ago_min=0, scheduled_at=None,
                cancelled=False) -> int:
    db = SessionLocal()
    try:
        _seq[0] += 1
        m = Meeting(
            code=f"code-{_seq[0]}",
            title="Instant meeting",
            host_id=host_id,
            is_active=is_active,
            scheduled_at=scheduled_at,
            cancelled_at=_now() if cancelled else None,
        )
        m.created_at = _now() - timedelta(minutes=created_ago_min)
        db.add(m)
        db.commit()
        db.refresh(m)
        return m.id
    finally:
        db.close()


def _add_participant(meeting_id, host_id, *, status, last_seen_ago_min=0):
    db = SessionLocal()
    try:
        p = MeetingParticipant(
            meeting_id=meeting_id,
            user_id=host_id,
            status=status,
            last_seen_at=_now() - timedelta(minutes=last_seen_ago_min),
        )
        db.add(p)
        db.commit()
    finally:
        db.close()


def _is_active(meeting_id) -> bool:
    db = SessionLocal()
    try:
        return db.get(Meeting, meeting_id).is_active
    finally:
        db.close()


def _ended_at(meeting_id):
    db = SessionLocal()
    try:
        return db.get(Meeting, meeting_id).ended_at
    finally:
        db.close()


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_abandoned_instant_meeting_is_reaped():
    """The core bug: everyone disconnected long ago, nobody clicked End."""
    host = _mk_host()
    mid = _mk_meeting(host, created_ago_min=6 * 60)
    _add_participant(mid, host, status=STATUS_DISCONNECTED, last_seen_ago_min=6 * 60)
    n = reaper.reap_stale_meetings()
    assert n == 1, n
    assert _is_active(mid) is False
    assert _ended_at(mid) is not None, "ended_at must be stamped when reaped"
    print("  [OK] abandoned instant meeting (no one connected, old) is reaped")


def test_live_meeting_is_never_reaped():
    """A participant is ADMITTED (connected) — must survive even if the room has
    been up for hours (last_seen_at stays at join time for a live connection)."""
    host = _mk_host()
    mid = _mk_meeting(host, created_ago_min=3 * 60)
    _add_participant(mid, host, status=STATUS_ADMITTED, last_seen_ago_min=3 * 60)
    n = reaper.reap_stale_meetings()
    assert _is_active(mid) is True, "a meeting with a connected participant must stay live"
    print("  [OK] live meeting with an ADMITTED participant is not reaped")


def test_fresh_empty_meeting_is_not_reaped():
    """Just created, nobody connected yet — inside the idle grace, keep it."""
    host = _mk_host()
    mid = _mk_meeting(host, created_ago_min=2)  # < REAP_IDLE_MINUTES
    n = reaper.reap_stale_meetings()
    assert _is_active(mid) is True, "a brand-new room must not be reaped before the grace window"
    print("  [OK] fresh empty meeting inside the grace window is not reaped")


def test_future_scheduled_meeting_is_not_reaped():
    """A scheduled meeting whose start time hasn't passed must be left alone."""
    host = _mk_host()
    mid = _mk_meeting(
        host,
        created_ago_min=6 * 60,
        scheduled_at=_now() + timedelta(hours=2),
    )
    n = reaper.reap_stale_meetings()
    assert _is_active(mid) is True, "an upcoming scheduled meeting must not be reaped"
    print("  [OK] future scheduled meeting is not reaped")


def test_recently_ended_scheduled_meeting_within_grace_is_not_reaped():
    """Scheduled start just passed and host hasn't joined yet — grace protects it."""
    host = _mk_host()
    mid = _mk_meeting(
        host,
        created_ago_min=6 * 60,
        scheduled_at=_now() - timedelta(minutes=30),  # < SCHEDULED_GRACE_HOURS past
    )
    n = reaper.reap_stale_meetings()
    assert _is_active(mid) is True, "scheduled meeting within start grace must not be reaped"
    print("  [OK] just-started scheduled meeting within grace is not reaped")


def test_left_participants_meeting_is_reaped():
    """Everyone clicked leave (STATUS_LEFT) a while ago — reap it."""
    host = _mk_host()
    mid = _mk_meeting(host, created_ago_min=2 * 60)
    _add_participant(mid, host, status=STATUS_LEFT, last_seen_ago_min=90)
    n = reaper.reap_stale_meetings()
    assert _is_active(mid) is False
    print("  [OK] meeting whose participants all left is reaped")


def test_crash_stuck_admitted_meeting_is_reaped_after_stuck_hours():
    """Backstop: a participant wedged in ADMITTED on a dead instance still gets
    reaped once activity is older than STUCK_HOURS."""
    host = _mk_host()
    mid = _mk_meeting(host, created_ago_min=30 * 60)  # 30h old
    _add_participant(
        mid, host, status=STATUS_ADMITTED,
        last_seen_ago_min=(reaper.STUCK_HOURS + 2) * 60,
    )
    n = reaper.reap_stale_meetings()
    assert _is_active(mid) is False, "an ancient stuck-ADMITTED meeting must be reaped by the backstop"
    print("  [OK] crash-stuck ADMITTED meeting is reaped by the STUCK_HOURS backstop")


def test_already_ended_meeting_is_left_alone():
    """Reaper only touches is_active meetings; it must not re-stamp an ended one."""
    host = _mk_host()
    db = SessionLocal()
    try:
        _seq[0] += 1
        m = Meeting(code=f"code-{_seq[0]}", title="t", host_id=host, is_active=False)
        m.created_at = _now() - timedelta(days=3)
        m.ended_at = _now() - timedelta(days=3)
        db.add(m)
        db.commit()
        mid = m.id
    finally:
        db.close()
    before = _ended_at(mid)  # read back as the DB stores it, so the compare is exact
    reaper.reap_stale_meetings()
    assert _is_active(mid) is False
    assert _ended_at(mid) == before, "an already-ended meeting's ended_at must not change"
    print("  [OK] already-ended meeting is left untouched")


def main():
    tests = [
        test_abandoned_instant_meeting_is_reaped,
        test_live_meeting_is_never_reaped,
        test_fresh_empty_meeting_is_not_reaped,
        test_future_scheduled_meeting_is_not_reaped,
        test_recently_ended_scheduled_meeting_within_grace_is_not_reaped,
        test_left_participants_meeting_is_reaped,
        test_crash_stuck_admitted_meeting_is_reaped_after_stuck_hours,
        test_already_ended_meeting_is_left_alone,
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
