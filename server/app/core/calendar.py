"""Generate .ics (iCalendar) files for meeting invites."""
from datetime import datetime, timedelta, timezone

from app.core.config import get_settings


def generate_ics(
    title: str,
    meeting_code: str,
    join_url: str | None,
    scheduled_at: datetime,
    duration_minutes: int = 60,
    organizer_name: str = "ZoikoSema",
    organizer_email: str | None = None,
    attendee_email: str | None = None,
    description: str | None = None,
    method: str = "REQUEST",
    sequence: int = 0,
    partstat: str | None = None,
    rrule: str | None = None,
) -> bytes:
    """Generate a .ics (iTIP) calendar object for a meeting.

    ``method`` selects the iTIP method (RFC 5546): "REQUEST" (invite/update),
    "CANCEL" (meeting cancelled), or "REPLY" (attendee RSVP echoed back to the
    organizer). ``partstat`` ("ACCEPTED"/"DECLINED") is only meaningful for
    METHOD:REPLY. Returns UTF-8 encoded bytes suitable for email attachment.

    UID is deterministic (derived from meeting_code, not random) so REQUEST,
    CANCEL, and REPLY objects for the same meeting all reference the same
    calendar entry — required for a receiving client to correlate them.
    ``sequence`` should be non-decreasing across an event's revisions per
    RFC 5546; this codebase has no reschedule-in-place flow yet (only
    create/cancel), so callers pass a fixed 0 (initial) or 1 (cancel) rather
    than tracking a persisted counter — revisit if/when in-place reschedule
    ships.
    """

    # The ORGANIZER must be a real, deliverable address: because this is a
    # METHOD:REQUEST invite, mail clients send the attendee's RSVP back to it.
    # A non-existent placeholder (the old default) made every RSVP hard-bounce.
    # Callers pass the meeting host's email; otherwise fall back to the
    # configured, domain-verified sending identity.
    organizer_email = organizer_email or get_settings().mail_from_email
    uid_domain = organizer_email.split("@", 1)[-1] if "@" in organizer_email else "zoikosema.com"
    uid = f"{meeting_code}@{uid_domain}"
    now = datetime.now(timezone.utc)

    start = scheduled_at if scheduled_at.tzinfo else scheduled_at.replace(tzinfo=timezone.utc)
    end = start + timedelta(minutes=duration_minutes)

    def fmt(dt: datetime) -> str:
        return dt.strftime("%Y%m%dT%H%M%SZ")

    default_desc = f"Join the meeting: {join_url}\\nMeeting code: {meeting_code}" if join_url else f"Meeting code: {meeting_code}"
    desc = description or default_desc
    status = "CANCELLED" if method == "CANCEL" else "CONFIRMED"

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ZoikoSema//EN",
        "CALSCALE:GREGORIAN",
        f"METHOD:{method}",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"SEQUENCE:{sequence}",
        f"DTSTAMP:{fmt(now)}",
        f"DTSTART:{fmt(start)}",
        f"DTEND:{fmt(end)}",
        f"SUMMARY:{_escape(title)}",
        f"DESCRIPTION:{_escape(desc)}",
        f"ORGANIZER;CN={_escape(organizer_name)}:mailto:{organizer_email}",
        f"STATUS:{status}",
    ]
    if join_url:
        lines.append(f"URL:{join_url}")
    if rrule:
        # Bare value, no leading "RRULE:" in the stored/passed string — this
        # mirrors how native_events.py stores it (a plain "FREQ=...;..."
        # value, same convention dateutil.rrule.rrulestr accepts directly).
        lines.append(f"RRULE:{rrule}")

    # A reminder alarm only makes sense on the original invite — a cancel or
    # an attendee's reply shouldn't schedule a new one on the receiving side.
    if method == "REQUEST":
        lines += [
            "BEGIN:VALARM",
            "TRIGGER:-PT15M",
            "ACTION:DISPLAY",
            f"DESCRIPTION:Meeting \"{title}\" starts in 15 minutes",
            "END:VALARM",
        ]

    if attendee_email:
        if method == "REPLY" and partstat:
            lines.append(f"ATTENDEE;PARTSTAT={partstat};CN={attendee_email}:mailto:{attendee_email}")
        else:
            lines.append(f"ATTENDEE;RSVP=TRUE;CN={attendee_email}:mailto:{attendee_email}")

    lines += [
        "END:VEVENT",
        "END:VCALENDAR",
    ]

    return "\r\n".join(lines).encode("utf-8")


def _escape(text: str) -> str:
    """Escape special characters for iCalendar text values."""
    return text.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")
