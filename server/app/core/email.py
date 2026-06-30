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


def send_meeting_invite_email(
    to_email: str,
    inviter_name: str,
    meeting_title: str,
    meeting_code: str,
    join_url: str,
    scheduled_at: str | None = None,
    ics_data: bytes | None = None,
) -> bool:
    """Send a meeting invite email with optional .ics attachment."""
    schedule_line = ""
    if scheduled_at:
        schedule_line = f'<p style="color:#888;font-size:14px;">Scheduled for: <strong>{scheduled_at}</strong></p>'

    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0d0f17;color:#e8e9ed;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#7c8cff,#ff7bd9);color:#fff;font-size:24px;font-weight:700;line-height:48px;">Z</div>
        </div>
        <h2 style="text-align:center;font-size:22px;margin:0 0 8px;">You're invited to a meeting</h2>
        <p style="text-align:center;color:#888;font-size:14px;margin:0 0 24px;">{inviter_name} invited you to join</p>
        <div style="background:#161825;border:1px solid #2a2d3e;border-radius:12px;padding:20px;margin-bottom:24px;">
            <h3 style="margin:0 0 8px;font-size:18px;">{meeting_title}</h3>
            <p style="color:#7c8cff;font-size:14px;font-family:monospace;margin:0 0 4px;">{meeting_code}</p>
            {schedule_line}
        </div>
        <div style="text-align:center;">
            <a href="{join_url}" style="display:inline-block;background:linear-gradient(135deg,#7c8cff,#ff7bd9);color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:15px;">Join Meeting</a>
        </div>
        <p style="text-align:center;color:#555;font-size:12px;margin-top:24px;">ZoikoSema &mdash; Secure video meetings for everyone</p>
    </div>
    """

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
    html = f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0d0f17;color:#e8e9ed;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#7c8cff,#ff7bd9);color:#fff;font-size:24px;font-weight:700;line-height:48px;">Z</div>
        </div>
        <h2 style="text-align:center;font-size:22px;margin:0 0 8px;">Meeting starting soon</h2>
        <p style="text-align:center;color:#fbbf24;font-size:14px;margin:0 0 24px;">Starting in {minutes_until} minute{'s' if minutes_until != 1 else ''}</p>
        <div style="background:#161825;border:1px solid #2a2d3e;border-radius:12px;padding:20px;margin-bottom:24px;">
            <h3 style="margin:0 0 8px;font-size:18px;">{meeting_title}</h3>
            <p style="color:#888;font-size:14px;margin:0;">{scheduled_at}</p>
        </div>
        <div style="text-align:center;">
            <a href="{join_url}" style="display:inline-block;background:linear-gradient(135deg,#7c8cff,#ff7bd9);color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:15px;">Join Meeting</a>
        </div>
    </div>
    """
    return send_email(to_email, f"Reminder: {meeting_title} in {minutes_until}min", html)


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
