"""Isolated-algorithm test battery for slots_from_busy — the merge/gap-
finding core shared by suggest_available_slots (single subject) and
suggest_group_available_slots (Phase 2 slice 6: multi-attendee, multi-
resource). Same convention as test_recurrence.py: standalone, no pytest,
no DB — this is exactly the kind of pure-algorithm test CONTEXT.md §8
established as the precedent for catching bugs in this file before they
ever reach a real query (that section's own clamp-to-window bug was
caught this way).

Run standalone:

    server/venv/Scripts/python.exe tests/test_availability_merge.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.connect.calendar_service.availability import slots_from_busy  # noqa: E402

DAY_START = datetime(2026, 9, 1, 9, tzinfo=timezone.utc)
DAY_END = datetime(2026, 9, 1, 18, tzinfo=timezone.utc)


def _t(hour, minute=0):
    return DAY_START.replace(hour=hour, minute=minute)


def test_no_busy_yields_one_full_day_slot():
    slots = slots_from_busy(DAY_START, DAY_END, 30, [])
    assert len(slots) == 1
    assert slots[0].start_at == DAY_START and slots[0].end_at == DAY_END
    print("  [OK] empty busy list -> one slot spanning the whole day")


def test_fully_booked_day_yields_no_slots():
    slots = slots_from_busy(DAY_START, DAY_END, 30, [(DAY_START, DAY_END)])
    assert slots == [], slots
    print("  [OK] a single busy interval covering the whole day -> no free slots")


def test_two_non_overlapping_subjects_merge_correctly():
    # Attendee A busy 9-10, attendee B (a different subject entirely) busy
    # 14-15 — the merge must exclude BOTH, treating every subject's busy
    # time identically regardless of which subject it came from.
    busy = [(_t(9), _t(10)), (_t(14), _t(15))]
    slots = slots_from_busy(DAY_START, DAY_END, 60, busy)
    assert len(slots) == 2, slots
    assert slots[0].start_at == _t(10) and slots[0].end_at == _t(14)
    assert slots[1].start_at == _t(15) and slots[1].end_at == DAY_END
    print("  [OK] two different subjects' non-overlapping busy times both correctly excluded")


def test_overlapping_intervals_from_different_subjects_merge_into_one_gap():
    # Attendee A busy 9-11, attendee B busy 10-12 (overlapping) — must merge
    # into a single 9-12 busy block, not be treated as two separate gaps
    # that incorrectly leave 10-11 "free."
    busy = [(_t(9), _t(11)), (_t(10), _t(12))]
    slots = slots_from_busy(DAY_START, DAY_END, 30, busy)
    assert len(slots) == 1
    assert slots[0].start_at == _t(12) and slots[0].end_at == DAY_END
    print("  [OK] overlapping busy intervals from different subjects merge into one block, no phantom gap")


def test_resource_conflict_shaped_like_any_other_busy_interval():
    # A "resource booking" is just another (start, end) tuple to this
    # function — mixing a person's busy time with a resource's booking must
    # produce the same correct exclusion as two people.
    person_busy = (_t(9), _t(10))
    resource_booked = (_t(9, 30), _t(11))
    slots = slots_from_busy(DAY_START, DAY_END, 60, [person_busy, resource_booked])
    assert len(slots) == 1
    assert slots[0].start_at == _t(11) and slots[0].end_at == DAY_END
    print("  [OK] a resource booking merges with person busy time using the identical algorithm")


def test_busy_interval_extending_past_day_end_is_clamped():
    # Regression corpus entry for the original CONTEXT.md §8 bug: an
    # unclamped interval starting after day_end (here, ending well after
    # it) must not produce a slot whose bounds fall outside the day window.
    busy = [(_t(17), DAY_END + timedelta(hours=5))]
    slots = slots_from_busy(DAY_START, DAY_END, 30, busy)
    assert len(slots) == 1
    assert slots[0].start_at == DAY_START and slots[0].end_at == _t(17)
    assert slots[0].end_at <= DAY_END
    print("  [OK] a busy interval extending past day_end is clamped, no out-of-window slot")


def test_three_subject_conflict_leaves_only_the_common_gap():
    # Three subjects (e.g. two attendees + one resource): free time must be
    # the intersection of everyone's availability, not the union.
    busy = [(_t(9), _t(12)), (_t(11), _t(14)), (_t(13), _t(16))]
    slots = slots_from_busy(DAY_START, DAY_END, 30, busy)
    assert len(slots) == 1
    assert slots[0].start_at == _t(16) and slots[0].end_at == DAY_END
    print("  [OK] three overlapping subjects' busy time correctly merges to leave only the shared free window")


def test_duration_longer_than_any_gap_yields_no_slots():
    busy = [(_t(9, 30), _t(10)), (_t(10, 30), _t(11))]
    slots = slots_from_busy(DAY_START, DAY_END, 600, busy)  # 10-hour meeting, longer than the whole day
    assert slots == [], slots
    print("  [OK] a duration longer than any available gap correctly yields no slots")


def main():
    tests = [
        test_no_busy_yields_one_full_day_slot,
        test_fully_booked_day_yields_no_slots,
        test_two_non_overlapping_subjects_merge_correctly,
        test_overlapping_intervals_from_different_subjects_merge_into_one_gap,
        test_resource_conflict_shaped_like_any_other_busy_interval,
        test_busy_interval_extending_past_day_end_is_clamped,
        test_three_subject_conflict_leaves_only_the_common_gap,
        test_duration_longer_than_any_gap_yields_no_slots,
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
