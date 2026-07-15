"""RFC 5545 recurrence expansion — pure functions, no DB/framework imports.

Delegates the actual RRULE/EXDATE/RDATE semantics to python-dateutil's
`rruleset` rather than re-implementing RFC 5545 (FREQ/INTERVAL/BYDAY/COUNT
vs UNTIL/DST edge cases) by hand — that parser is a mature, widely-used
correctness surface; hand-rolling it would trade a few hundred lines of
library code most people never look at for a bespoke one only this repo
would ever maintain, with the DST bugs to prove it.

DST correctness requires the caller to pass a tz-AWARE `dtstart` in the
event's own IANA zone (via `zoneinfo.ZoneInfo`), not a UTC instant — "every
weekday at 9am America/New_York" must stay 9am local across a DST
transition, which only holds if dateutil is stepping the rule in that zone.
Native events store UTC instants + a separate IANA name; native_events.py
does the UTC <-> local conversion around calls into this module so this
file itself stays timezone-mechanics-free.
"""
from __future__ import annotations

from datetime import datetime

from dateutil.rrule import rruleset, rrulestr


def expand_rrule(
    rrule_str: str,
    dtstart: datetime,
    range_start: datetime,
    range_end: datetime,
    *,
    exdates: list[datetime] | None = None,
    rdates: list[datetime] | None = None,
) -> list[datetime]:
    """Occurrence start-instants within [range_start, range_end], inclusive.

    All of dtstart/range_start/range_end/exdates/rdates must share the same
    tzinfo-awareness (all naive or all aware in the same zone) — dateutil
    compares them directly and raises TypeError on a naive/aware mismatch,
    which is the right failure mode here (silently coercing one side would
    hide exactly the kind of DST bug this module exists to avoid).
    """
    parsed = rrulestr(rrule_str, dtstart=dtstart)

    if not exdates and not rdates:
        # rrulestr can itself return an rruleset if rrule_str embeds
        # multiple RRULE/EXDATE/RDATE lines — .between() exists on both
        # rrule and rruleset, so no branch needed here.
        return list(parsed.between(range_start, range_end, inc=True))

    if isinstance(parsed, rruleset):
        rs = parsed
    else:
        rs = rruleset()
        rs.rrule(parsed)
    for ex in exdates or []:
        rs.exdate(ex)
    for rd in rdates or []:
        rs.rdate(rd)
    return list(rs.between(range_start, range_end, inc=True))
