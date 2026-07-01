"""Generate .ics (iCalendar) files for meeting invites."""
from datetime import datetime, timedelta, timezone
import uuid

from app.core.config import get_settings


def generate_ics(
    title: str,
    meeting_code: str,
    join_url: str,
    scheduled_at: datetime,
    duration_minutes: int = 60,
    organizer_name: str = "ZoikoSema",
    organizer_email: str | None = None,
    attendee_email: str | None = None,
    description: str | None = None,
) -> bytes:
    """Generate a .ics calendar event for a meeting.
    Returns UTF-8 encoded bytes suitable for email attachment or download."""

    # The ORGANIZER must be a real, deliverable address: because this is a
    # METHOD:REQUEST invite, mail clients send the attendee's RSVP back to it.
    # A non-existent placeholder (the old default) made every RSVP hard-bounce.
    # Callers pass the meeting host's email; otherwise fall back to the
    # configured, domain-verified sending identity.
    organizer_email = organizer_email or get_settings().mail_from_email
    uid_domain = organizer_email.split("@", 1)[-1] if "@" in organizer_email else "zoikosema.com"
    uid = f"{uuid.uuid4()}@{uid_domain}"
    now = datetime.now(timezone.utc)

    start = scheduled_at if scheduled_at.tzinfo else scheduled_at.replace(tzinfo=timezone.utc)
    end = start + timedelta(minutes=duration_minutes)

    def fmt(dt: datetime) -> str:
        return dt.strftime("%Y%m%dT%H%M%SZ")

    desc = description or f"Join the meeting: {join_url}\\nMeeting code: {meeting_code}"

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ZoikoSema//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{fmt(now)}",
        f"DTSTART:{fmt(start)}",
        f"DTEND:{fmt(end)}",
        f"SUMMARY:{_escape(title)}",
        f"DESCRIPTION:{_escape(desc)}",
        f"URL:{join_url}",
        f"ORGANIZER;CN={_escape(organizer_name)}:mailto:{organizer_email}",
        "STATUS:CONFIRMED",
        # 15-minute reminder
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        f"DESCRIPTION:Meeting \"{title}\" starts in 15 minutes",
        "END:VALARM",
    ]

    if attendee_email:
        lines.append(f"ATTENDEE;RSVP=TRUE;CN={attendee_email}:mailto:{attendee_email}")

    lines += [
        "END:VEVENT",
        "END:VCALENDAR",
    ]

    return "\r\n".join(lines).encode("utf-8")


def _escape(text: str) -> str:
    """Escape special characters for iCalendar text values."""
    return text.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")
