"""Email service for sending meeting invites and notifications."""
import base64
import json
import logging
import smtplib
import urllib.error
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

from app.core.config import get_settings

log = logging.getLogger(__name__)

_RESEND_ENDPOINT = "https://api.resend.com/emails"


def _send_via_resend(
    to: str,
    subject: str,
    html_body: str,
    attachments: list[tuple[str, bytes, str]] | None = None,
) -> bool:
    """POST an email to the Resend API using only the stdlib (no extra deps).

    Returns True on a 2xx, False otherwise. Never raises — the caller treats a
    False as "couldn't send" and degrades gracefully.
    """
    s = get_settings()
    payload: dict = {
        "from": f"{s.smtp_from_name} <{s.mail_from_email}>",
        "to": [to],
        "subject": subject,
        "html": html_body,
    }
    if attachments:
        payload["attachments"] = [
            {"filename": filename, "content": base64.b64encode(data).decode("ascii")}
            for filename, data, _mime in attachments
        ]

    req = urllib.request.Request(
        _RESEND_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {s.resend_api_key}",
            "Content-Type": "application/json",
            # Resend sits behind Cloudflare, which 403s the default
            # "Python-urllib/x" agent (error 1010 — banned browser signature).
            # A non-default User-Agent clears that block.
            "User-Agent": "ZoikoSema/1.0 (+https://zoikosema.com)",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:300]
        log.error("Resend API error sending to %s: %s %s", to, exc.code, body)
        return False
    except Exception:
        log.exception("Resend request failed sending to %s", to)
        return False


def _smtp_connection():
    """Open an SMTP connection using settings."""
    s = get_settings()
    if s.smtp_use_tls:
        server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15)
        server.starttls()
    else:
        server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15)
    server.login(s.smtp_user, s.smtp_password)
    return server


def send_email(to: str, subject: str, html_body: str, attachments: list[tuple[str, bytes, str]] | None = None) -> bool:
    """Send an email. attachments is a list of (filename, data, mime_type).
    Returns True on success, False on failure (never raises).

    Resend is preferred when an API key is configured; SMTP is the fallback.
    """
    s = get_settings()
    if s.resend_enabled:
        return _send_via_resend(to, subject, html_body, attachments)
    if not s.smtp_enabled:
        log.warning("No email provider configured (Resend/SMTP) — skipping email to %s", to)
        return False

    msg = MIMEMultipart()
    msg["From"] = f"{s.smtp_from_name} <{s.smtp_from_email}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))

    if attachments:
        for filename, data, mime_type in attachments:
            part = MIMEBase(*mime_type.split("/", 1))
            part.set_payload(data)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
            msg.attach(part)

    try:
        server = _smtp_connection()
        server.sendmail(s.smtp_from_email, to, msg.as_string())
        server.quit()
        return True
    except Exception:
        log.exception("Failed to send email to %s", to)
        return False


def _meeting_email_html(
    *,
    hero: str,
    heading: str,
    subheading: str,
    card_html: str,
    button_url: str | None = None,
    button_label: str | None = None,
    button_bg: str = "linear-gradient(135deg,#1f9d5a 0%,#12793f 100%)",
) -> str:
    """Shared ZoikoSema shell for all meeting emails.

    Everything lives inside one white rounded card centered on the page (same
    structure as the password-reset email) so the mail reads as a compact card
    instead of a full-bleed canvas. Table-based + fully inline styles so it
    renders consistently across Gmail, Outlook, and Apple Mail. The wordmark
    and the illustrated hero art (`hero` is one of invite/reminder/cancelled)
    are pulled from the publicly-hosted brand assets — email clients block
    SVG / strip base64, so hosted PNG is the only reliable option.
    """
    s = get_settings()
    logo_url = s.brand_email_logo_url
    hero_url = f"{s.brand_email_asset_base_url}/email-hero-{hero}.png"

    button_block = ""
    if button_url and button_label:
        button_block = f"""
            <tr><td align="center" style="padding:20px 0 2px;">
              <a href="{button_url}" style="display:inline-block;background:{button_bg};color:#ffffff;text-decoration:none;padding:13px 44px;border-radius:12px;font-weight:700;font-size:15px;box-shadow:0 12px 26px -12px rgba(16,120,70,0.6);">{button_label}</a>
            </td></tr>"""

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f3;">
  <div style="background:#f1f5f3;padding:28px 16px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
      <tr><td>
        <div style="background:#ffffff;border-radius:22px;border:1px solid #e3ece7;box-shadow:0 20px 50px -30px rgba(15,60,40,0.4);padding:26px 30px 24px;">
          <!-- Header: ZoikoSema wordmark logo -->
          <div style="text-align:center;padding:2px 0 4px;">
            <img src="{logo_url}" alt="ZoikoSema" width="160" style="display:inline-block;width:160px;max-width:55%;height:auto;border:0;outline:none;text-decoration:none;" />
          </div>
          <!-- Illustrated hero -->
          <div style="text-align:center;padding:10px 0 0;">
            <img src="{hero_url}" alt="" width="180" style="display:inline-block;width:180px;max-width:55%;height:auto;border:0;outline:none;" />
          </div>
          <!-- Copy -->
          <div style="text-align:center;padding:0 10px;">
            <h1 style="margin:14px 0 6px;font-size:25px;line-height:1.2;color:#0f3d28;font-weight:800;letter-spacing:-0.01em;">{heading}</h1>
            <p style="margin:0 0 20px;font-size:14.5px;line-height:1.5;color:#5a6b62;">{subheading}</p>
          </div>
          <!-- Detail card -->
          {card_html}
          <!-- CTA -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            {button_block}
          </table>
          <!-- Footer -->
          <div style="padding:16px 0 2px;text-align:center;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:#8ba296;">ZoikoSema &mdash; Secure video meetings for everyone</p>
          </div>
        </div>
      </td></tr>
    </table>
  </div>
</body>
</html>"""


def _meeting_detail_card(
    *,
    title: str,
    icon_emoji: str = "📅",
    code: str | None = None,
    meta_label: str | None = None,
    meta_value: str | None = None,
    strike: bool = False,
) -> str:
    """The inner white info card (icon chip + meeting details)."""
    title_style = "font-size:16px;font-weight:700;color:#0f3d28;margin:0;"
    if strike:
        title_style = "font-size:16px;font-weight:700;color:#94a3b8;text-decoration:line-through;margin:0;"

    code_line = ""
    if code:
        code_line = (
            f'<div style="margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;'
            f'font-size:13px;font-weight:600;color:#178a52;">{code}</div>'
        )
    meta_line = ""
    if meta_label or meta_value:
        meta_line = (
            f'<div style="margin-top:8px;font-size:12px;color:#7b8a82;">{meta_label or ""}</div>'
            f'<div style="margin-top:2px;font-size:14px;font-weight:700;color:#1f2d27;">{meta_value or ""}</div>'
        )

    return f"""
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fbf9;border:1px solid #e0ede6;border-radius:14px;">
              <tr>
                <td style="padding:16px;vertical-align:top;width:56px;">
                  <div style="width:44px;height:44px;line-height:44px;text-align:center;border-radius:12px;background:#e3f3ea;font-size:21px;">{icon_emoji}</div>
                </td>
                <td style="padding:14px 16px 14px 4px;vertical-align:middle;">
                  <div style="{title_style}">{title}</div>
                  {code_line}
                  {meta_line}
                </td>
              </tr>
            </table>"""


def _format_duration(duration_minutes: int) -> str:
    """"1 hour" / "90 min" / "2 hours" — matches the mockup's wording,
    derived only from real duration_minutes, never guessed."""
    if duration_minutes % 60 == 0:
        hours = duration_minutes // 60
        return f"{hours} hour" if hours == 1 else f"{hours} hours"
    return f"{duration_minutes} min"


def _localize(dt, tz_name: str | None):
    """Convert a real tz-aware datetime into the meeting's configured
    timezone (if any) before display — otherwise the date/time panel would
    show it in whatever zone it happened to be stored/passed in (e.g. UTC),
    not the timezone the organizer actually scheduled it for.

    Returns (localized_dt, short_zone_label_or_None). Falls back to the
    original dt and the raw IANA name if the zone can't be resolved.
    """
    if not tz_name:
        return dt, None
    try:
        from zoneinfo import ZoneInfo
        localized = dt.astimezone(ZoneInfo(tz_name))
        return localized, localized.tzname() or tz_name
    except Exception:
        return dt, tz_name


def _invite_detail_card(
    *,
    meeting_code: str,
    scheduled_at_dt=None,
    scheduled_at: str | None = None,
    duration_minutes: int | None = None,
    timezone: str | None = None,
    organizer_name: str,
    location: str | None,
    description: str | None,
) -> str:
    """Invite-only detail card: a navy date panel (only when we have a real
    scheduled datetime) beside a stacked list of every other piece of data
    that's actually available. Each row is omitted outright (not shown
    blank) when its value is missing, per the redesign's backend-only scope.
    """
    date_panel = ""
    time_row = None
    if scheduled_at_dt is not None:
        local_dt, tz = _localize(scheduled_at_dt, timezone)
        start_str = local_dt.strftime("%I:%M %p").lstrip("0")
        if duration_minutes:
            from datetime import timedelta
            end_str = (local_dt + timedelta(minutes=duration_minutes)).strftime("%I:%M %p").lstrip("0")
            time_value = f"{start_str} – {end_str}"
        else:
            time_value = start_str
        if tz:
            time_value = f"{time_value} {tz}"
        time_row = ("\U0001F550", "Time", time_value)

        weekday = local_dt.strftime("%A").upper()
        month_day = local_dt.strftime("%b %d").upper()
        year = local_dt.strftime("%Y")
        date_panel = f"""
              <td width="118" style="background:#242f8f;border-radius:14px 0 0 14px;padding:20px 14px;vertical-align:middle;text-align:center;">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;color:#aab6f5;">{weekday}</div>
                <div style="margin-top:6px;font-size:21px;font-weight:800;color:#ffffff;line-height:1.15;">{month_day}</div>
                <div style="margin-top:2px;font-size:13px;font-weight:600;color:#c7d0f8;">{year}</div>
              </td>"""
    elif scheduled_at:
        # Fallback used only when a caller has no real datetime object, just a
        # pre-formatted string — keeps this function backward-compatible.
        time_row = ("\U0001F550", "When", f"{scheduled_at} ({timezone})" if timezone else scheduled_at)

    rows = []
    if time_row:
        rows.append(time_row)
    if duration_minutes:
        rows.append(("⏱", "Duration", _format_duration(duration_minutes)))
    rows.append(("\U0001F464", "Organizer", organizer_name))
    if location:
        rows.append(("\U0001F4CD", "Location", location))
    rows.append(("#", "Meeting ID", meeting_code))
    if description:
        rows.append(("\U0001F4DD", "Description", description))

    row_html = "".join(
        f"""
              <tr>
                <td style="padding:8px 0;border-top:1px solid #e4e9f7;width:26px;vertical-align:top;font-size:13px;">{icon}</td>
                <td style="padding:8px 0;border-top:1px solid #e4e9f7;vertical-align:top;">
                  <span style="font-size:11px;font-weight:700;color:#5c6a94;text-transform:uppercase;letter-spacing:0.04em;">{label}:</span>
                  <span style="margin-left:4px;font-size:13.5px;font-weight:600;color:#1a2452;">{value}</span>
                </td>
              </tr>"""
        for icon, label, value in rows
    )
    row_html = row_html.replace("border-top:1px solid #e4e9f7;", "border-top:none;", 1)

    info_column = f"""
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                {row_html}
              </table>"""

    if date_panel:
        return f"""
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e1e6f7;border-radius:14px;">
              <tr>
                {date_panel}
                <td style="background:#f6f8fd;border-radius:0 14px 14px 0;padding:14px 18px;vertical-align:middle;">
                  {info_column}
                </td>
              </tr>
            </table>"""

    return f"""
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fd;border:1px solid #e1e6f7;border-radius:14px;padding:2px 18px;">
              {info_column}
            </table>"""


def _invite_email_html(
    *,
    heading: str,
    subheading: str,
    card_html: str,
    join_url: str,
    ics_download_url: str | None,
) -> str:
    """ZoikoSema-blue invite email shell — separate from ``_meeting_email_html``
    (which reminder/cancelled/rsvp keep using unmodified) so this redesign
    can't change how those other emails render.

    Join Meeting is the primary CTA (solid blue); Add to Calendar (only
    rendered when a download URL is available) is secondary and sits beside
    it in a two-column table row that collapses to full-width stacked
    buttons on narrow clients via the media query below.
    """
    s = get_settings()
    logo_url = s.brand_email_invite_logo_url

    add_to_calendar_cell = ""
    join_cell_width = "100%"
    if ics_download_url:
        join_cell_width = "50%"
        add_to_calendar_cell = f"""
              <td class="btn-cell" width="50%" align="center" style="padding:0 0 0 8px;">
                <a href="{ics_download_url}" style="display:block;background:#ffffff;color:#242f8f;text-decoration:none;padding:11px 0;border:1.5px solid #242f8f;border-radius:10px;font-weight:700;font-size:14px;">Add to Calendar</a>
              </td>"""

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    @media (max-width:480px) {{
      .btn-cell {{ display:block !important; width:100% !important; padding:0 0 10px !important; }}
    }}
  </style>
</head>
<body style="margin:0;padding:0;background:#eef1f8;">
  <div style="background:#eef1f8;padding:28px 16px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
      <tr><td>
        <div style="background:#ffffff;border-radius:18px;border:1px solid #e2e7f5;box-shadow:0 20px 50px -30px rgba(13,45,110,0.3);overflow:hidden;">
          <!-- Header: left-aligned wordmark + heading, flat white (matches mockup, no colored band) -->
          <div style="padding:26px 26px 4px;text-align:left;">
            <img src="{logo_url}" alt="ZoikoSema" width="170" style="display:inline-block;width:170px;max-width:60%;height:auto;border:0;outline:none;text-decoration:none;" />
          </div>
          <div style="padding:14px 26px 0;text-align:left;">
            <h1 style="margin:0 0 4px;font-size:22px;line-height:1.3;color:#101a3d;font-weight:800;letter-spacing:-0.01em;">{heading}</h1>
            <p style="margin:0;font-size:14px;line-height:1.5;color:#5c6a94;">{subheading}</p>
          </div>
          <!-- Detail card -->
          <div style="padding:18px 26px 4px;">
            {card_html}
          </div>
          <!-- CTAs -->
          <div style="padding:18px 26px 6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td class="btn-cell" width="{join_cell_width}" align="center" style="padding:0;">
                  <a href="{join_url}" style="display:block;background:#242f8f;color:#ffffff;text-decoration:none;padding:12px 0;border-radius:10px;font-weight:700;font-size:15px;">Join Meeting</a>
                </td>{add_to_calendar_cell}
              </tr>
            </table>
          </div>
          <!-- RSVP explainer -->
          <div style="margin:6px 26px 0;padding:14px 16px;background:#f6f8fd;border:1px solid #e1e6f7;border-radius:12px;">
            <p style="margin:0;font-size:12.5px;line-height:1.6;color:#4a5b7a;">Need to respond? Just open the calendar invite attached to this email — Accept, Decline, or Tentative right from your calendar app.</p>
          </div>
          <!-- Footer -->
          <div style="padding:18px 0 22px;text-align:center;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:#8b96b8;">Powered by ZoikoSema</p>
          </div>
        </div>
      </td></tr>
    </table>
  </div>
</body>
</html>"""


def send_meeting_invite_email(
    to_email: str,
    inviter_name: str,
    meeting_title: str,
    meeting_code: str,
    join_url: str | None,
    scheduled_at: str | None = None,
    ics_data: bytes | None = None,
    organizer_email: str | None = None,
    description: str | None = None,
    location: str | None = None,
    duration_minutes: int | None = None,
    timezone: str | None = None,
    ics_download_url: str | None = None,
    scheduled_at_dt=None,
) -> bool:
    """Send a meeting invite email with optional .ics attachment.

    ``organizer_email``, ``description``, ``location``, ``duration_minutes``,
    ``timezone``, ``ics_download_url``, and ``scheduled_at_dt`` are optional
    and additive — every existing caller that doesn't pass them keeps getting
    the same rows it did before (organizer_email is accepted for future
    use/consistency with other send_* signatures but isn't rendered
    separately since organizer_name already appears in the card).
    ``scheduled_at_dt`` (a real tz-aware datetime, not a fake one) drives the
    navy date-split panel; when absent, the card falls back to a single
    "When" row built from the ``scheduled_at`` string, same as before.
    """
    card = _invite_detail_card(
        meeting_code=meeting_code,
        scheduled_at_dt=scheduled_at_dt,
        scheduled_at=scheduled_at,
        duration_minutes=duration_minutes,
        timezone=timezone,
        organizer_name=inviter_name,
        location=location,
        description=description,
    )
    html = _invite_email_html(
        heading=meeting_title,
        subheading="Join your ZoikoSema meeting",
        card_html=card,
        join_url=join_url,
        ics_download_url=ics_download_url,
    )

    attachments = []
    if ics_data:
        attachments.append(("meeting.ics", ics_data, "text/calendar"))

    return send_email(to_email, f"Meeting invite: {meeting_title}", html, attachments)


def send_meeting_reminder_email(
    to_email: str,
    meeting_title: str,
    meeting_code: str,
    join_url: str,
    scheduled_at: str,
    minutes_until: int,
) -> bool:
    """Send a meeting reminder email."""
    plural = "s" if minutes_until != 1 else ""
    card = _meeting_detail_card(
        title=meeting_title,
        icon_emoji="⏰",
        code=meeting_code,
        meta_label="Scheduled for:",
        meta_value=scheduled_at,
    )
    html = _meeting_email_html(
        hero="reminder",
        heading=f"Starting in {minutes_until} minute{plural}",
        subheading="Your ZoikoSema meeting is about to begin.",
        card_html=card,
        button_url=join_url,
        button_label="Join Meeting",
    )
    return send_email(to_email, f"Reminder: {meeting_title} in {minutes_until}min", html)


def send_meeting_cancelled_email(
    to_email: str,
    organizer_name: str,
    meeting_title: str,
    scheduled_at: str | None = None,
    ics_data: bytes | None = None,
) -> bool:
    """Notify an invitee that a scheduled meeting has been cancelled.

    ``ics_data`` (a METHOD:CANCEL object matching the original invite's UID)
    lets a real calendar client auto-remove the event, not just show an email.
    """
    card = _meeting_detail_card(
        title=meeting_title,
        icon_emoji="🚫",
        meta_label="Was scheduled for:" if scheduled_at else None,
        meta_value=scheduled_at if scheduled_at else None,
        strike=True,
    )
    html = _meeting_email_html(
        hero="cancelled",
        heading="Meeting cancelled",
        subheading=f"{organizer_name} cancelled this meeting",
        card_html=card,
    )
    attachments = [("cancellation.ics", ics_data, "text/calendar")] if ics_data else []
    return send_email(to_email, f"Cancelled: {meeting_title}", html, attachments)


def send_meeting_rsvp_email(
    to_email: str,
    invitee_label: str,
    meeting_title: str,
    accepted: bool,
    ics_data: bytes | None = None,
) -> bool:
    """Notify the organizer that an invitee responded to a meeting invite.

    ``ics_data`` is a METHOD:REPLY object echoing the invitee's PARTSTAT back
    to the organizer's calendar client (RFC 5546 iTIP RSVP round-trip).
    """
    verb = "accepted" if accepted else "declined"
    card = _meeting_detail_card(
        title=meeting_title,
        icon_emoji="✅" if accepted else "❌",
        meta_label="Response:",
        meta_value=f"{invitee_label} {verb}",
    )
    # No dedicated "rsvp" hero asset is hosted yet — reuse invite/cancelled,
    # the closest existing art for a positive vs. negative response.
    html = _meeting_email_html(
        hero="invite" if accepted else "cancelled",
        heading=f"Invite {verb}",
        subheading=f"{invitee_label} {verb} your invite to this meeting",
        card_html=card,
    )
    attachments = [("reply.ics", ics_data, "text/calendar")] if ics_data else []
    return send_email(to_email, f"{invitee_label} {verb}: {meeting_title}", html, attachments)


def send_password_reset_email(to_email: str, user_name: str, otp_code: str, expiry_minutes: int = 10) -> bool:
    """Send the password-reset verification code via a branded HTML email."""
    s = get_settings()
    safe_name = (user_name or "there").strip() or "there"
    logo_url = s.brand_email_logo_url
    # Render each digit in its own rounded chip for a clean, scannable code.
    digit_boxes = "".join(
        f'<td style="padding:0 5px;">'
        f'<div style="width:54px;height:62px;line-height:62px;text-align:center;'
        f'background:#f6faf8;border:1.5px solid #d6e6df;border-radius:14px;'
        f'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:30px;'
        f'font-weight:700;color:#0f172a;">{d}</div></td>'
        for d in otp_code
    )

    html = f"""\
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#eef2f5;">
  <div style="background:#eef2f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;">
      <tr><td>
        <div style="background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e6ecf0;box-shadow:0 20px 50px -28px rgba(15,23,42,0.35);">
          <!-- Header: white with the real ZoikoSema wordmark + green accent rule -->
          <div style="padding:30px 32px 22px;text-align:center;border-bottom:1px solid #f0f3f6;">
            <img src="{logo_url}" alt="ZoikoSema" width="190"
                 style="display:inline-block;width:190px;max-width:62%;height:auto;border:0;outline:none;text-decoration:none;" />
            <div style="height:4px;width:54px;margin:18px auto 0;border-radius:999px;background:linear-gradient(90deg,#1f7a54,#34d399);"></div>
          </div>
          <!-- Body -->
          <div style="padding:30px 32px 8px;">
            <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">Reset your password</h1>
            <p style="margin:0 0 22px;font-size:14.5px;line-height:1.65;color:#475569;">
              Hello {safe_name},<br />
              We received a request to reset your ZoikoSema password. Enter the verification code below to continue.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 18px;">
              <tr>{digit_boxes}</tr>
            </table>
            <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#64748b;text-align:center;">
              This code expires in <strong style="color:#15936b;">{expiry_minutes} minutes</strong>.
            </p>
            <div style="background:#f6faf8;border:1px solid #e2ece7;border-radius:12px;padding:14px 16px;">
              <p style="margin:0;font-size:12.5px;line-height:1.6;color:#64748b;">
                Didn't request this? You can safely ignore this email — your password won't change.
              </p>
            </div>
          </div>
          <!-- Footer -->
          <div style="padding:22px 32px 26px;text-align:center;">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
              Regards,<br /><strong style="color:#64748b;">The ZoikoSema Team</strong>
            </p>
          </div>
        </div>
        <p style="margin:16px 0 0;text-align:center;font-size:11px;color:#aab4bf;">
          &copy; ZoikoSema &middot; This is an automated message, please do not reply.
        </p>
      </td></tr>
    </table>
  </div>
</body>
</html>"""
    return send_email(to_email, "Zoiko Sema Password Reset Verification", html)
