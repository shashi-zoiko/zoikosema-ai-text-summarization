"""DST/timezone/RRULE correctness corpus for app/connect/calendar_service/recurrence.py.

Runs standalone (no pytest needed), same convention as test_admin_access.py:

    server/venv/Scripts/python.exe tests/test_recurrence.py

Pure module under test — no DB, no app import, no bootstrapping needed.
2026 US DST transition dates (America/New_York) used below were computed
from zoneinfo directly, not assumed from the "Nth Sunday" rule by hand:
spring-forward lands between 2026-03-07 and 2026-03-08; fall-back between
2026-10-31 and 2026-11-01.
"""
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.connect.calendar_service.recurrence import expand_rrule  # noqa: E402

NY = ZoneInfo("America/New_York")
UTC = timezone.utc


def test_spring_forward_keeps_local_wall_clock_time():
    dtstart = datetime(2026, 3, 5, 9, 0, tzinfo=NY)
    occs = expand_rrule(
        "FREQ=DAILY;COUNT=6", dtstart,
        datetime(2026, 1, 1, tzinfo=NY), datetime(2027, 1, 1, tzinfo=NY),
    )
    assert len(occs) == 6, occs
    assert all(o.hour == 9 for o in occs), "wall-clock hour must stay 9am local across the DST boundary"
    utc_hours = [o.astimezone(UTC).hour for o in occs]
    assert utc_hours == [14, 14, 14, 13, 13, 13], utc_hours
    print("  [OK] spring-forward: local 9am held constant, UTC hour shifts 14->13 at the transition")


def test_fall_back_no_duplicate_occurrence():
    dtstart = datetime(2026, 10, 29, 9, 0, tzinfo=NY)
    occs = expand_rrule(
        "FREQ=DAILY;COUNT=6", dtstart,
        datetime(2026, 1, 1, tzinfo=NY), datetime(2027, 1, 1, tzinfo=NY),
    )
    # The risk fall-back tests for: a naive implementation double-counting
    # the repeated wall-clock hour, or dateutil's DST handling producing an
    # extra/missing occurrence right at the boundary.
    assert len(occs) == 6, occs
    utc_hours = [o.astimezone(UTC).hour for o in occs]
    assert utc_hours == [13, 13, 13, 14, 14, 14], utc_hours
    print("  [OK] fall-back: exactly 6 occurrences (no duplicate), UTC hour shifts 13->14 at the transition")


def test_count_terminates_exact_number():
    dtstart = datetime(2026, 1, 5, 10, 0, tzinfo=NY)  # a Monday
    occs = expand_rrule(
        "FREQ=WEEKLY;COUNT=4", dtstart,
        datetime(2020, 1, 1, tzinfo=NY), datetime(2030, 1, 1, tzinfo=NY),  # deliberately huge window
    )
    assert len(occs) == 4, occs
    print("  [OK] COUNT=4 yields exactly 4 occurrences even with a far wider query window")


def test_until_terminates_at_boundary():
    dtstart = datetime(2026, 1, 1, 10, 0, tzinfo=NY)
    until = datetime(2026, 1, 22, 10, 0, tzinfo=NY)
    occs = expand_rrule(
        f"FREQ=DAILY;UNTIL={until.astimezone(UTC).strftime('%Y%m%dT%H%M%SZ')}", dtstart,
        datetime(2026, 1, 1, tzinfo=NY), datetime(2026, 2, 1, tzinfo=NY),
    )
    assert occs[-1] <= until, (occs[-1], until)
    assert all(o <= until for o in occs)
    print(f"  [OK] UNTIL correctly bounds the series ({len(occs)} occurrences, last <= UNTIL)")


def test_exdate_removes_specific_occurrence():
    dtstart = datetime(2026, 6, 1, 10, 0, tzinfo=NY)
    excluded = datetime(2026, 6, 3, 10, 0, tzinfo=NY)
    occs = expand_rrule(
        "FREQ=DAILY;COUNT=5", dtstart,
        datetime(2026, 6, 1, tzinfo=NY), datetime(2026, 6, 10, tzinfo=NY),
        exdates=[excluded],
    )
    assert len(occs) == 4, occs
    assert excluded not in occs, occs
    print("  [OK] EXDATE removes exactly the specified occurrence, series otherwise intact")


def test_rdate_adds_extra_occurrence():
    dtstart = datetime(2026, 6, 1, 10, 0, tzinfo=NY)  # weekly series
    extra = datetime(2026, 6, 17, 15, 0, tzinfo=NY)  # an unrelated one-off addition
    occs = expand_rrule(
        "FREQ=WEEKLY;COUNT=2", dtstart,
        datetime(2026, 6, 1, tzinfo=NY), datetime(2026, 7, 1, tzinfo=NY),
        rdates=[extra],
    )
    assert len(occs) == 3, occs
    assert extra in occs, occs
    print("  [OK] RDATE adds the extra one-off occurrence alongside the base rule")


def test_naive_utc_expansion_diverges_from_iana_across_dst():
    """Documents *why* native_events.py must expand in the event's own IANA
    zone rather than a bare UTC dtstart: the same "9am daily" rule produces
    different (and for the naive case, wrong) real-world instants once a
    DST boundary is crossed."""
    iana_occs = expand_rrule(
        "FREQ=DAILY;COUNT=6", datetime(2026, 3, 5, 9, 0, tzinfo=NY),
        datetime(2026, 1, 1, tzinfo=NY), datetime(2027, 1, 1, tzinfo=NY),
    )
    naive_utc_occs = expand_rrule(
        "FREQ=DAILY;COUNT=6", datetime(2026, 3, 5, 14, 0, tzinfo=UTC),  # naive equivalent of day-1 9am EST
        datetime(2026, 1, 1, tzinfo=UTC), datetime(2027, 1, 1, tzinfo=UTC),
    )
    iana_as_utc = [o.astimezone(UTC) for o in iana_occs]
    assert iana_as_utc != naive_utc_occs, "expected the IANA-aware and naive-UTC expansions to diverge across the DST boundary"
    assert iana_as_utc[-1] != naive_utc_occs[-1]
    print("  [OK] confirmed naive-UTC expansion silently drifts by an hour after DST — this is exactly why IANA-zone dtstart is mandatory")


def main():
    tests = [
        test_spring_forward_keeps_local_wall_clock_time,
        test_fall_back_no_duplicate_occurrence,
        test_count_terminates_exact_number,
        test_until_terminates_at_boundary,
        test_exdate_removes_specific_occurrence,
        test_rdate_adds_extra_occurrence,
        test_naive_utc_expansion_diverges_from_iana_across_dst,
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
