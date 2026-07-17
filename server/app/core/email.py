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


def send_meeting_invite_email(
    to_email: str,
    inviter_name: str,
    meeting_title: str,
    meeting_code: str,
    join_url: str | None,
    scheduled_at: str | None = None,
    ics_data: bytes | None = None,
) -> bool:
    """Send a meeting invite email with optional .ics attachment."""
    card = _meeting_detail_card(
        title=meeting_title,
        icon_emoji="📅",
        code=meeting_code,
        meta_label="Scheduled for:" if scheduled_at else None,
        meta_value=scheduled_at if scheduled_at else None,
    )
    html = _meeting_email_html(
        hero="invite",
        heading="You&rsquo;re invited to a meeting",
        subheading=f"{inviter_name} invited you to join",
        card_html=card,
        button_url=join_url,
        button_label="Join Meeting",
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
