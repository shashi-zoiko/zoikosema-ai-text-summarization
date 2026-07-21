from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent.parent / ".env",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg2://zoiko:zoiko_dev@localhost:5432/zoiko"
    # SQLAlchemy connection-pool sizing (Postgres only). Sized for a single
    # large meeting (50-100) whose attendees can all submit /join + /media-token
    # in the same few seconds at a scheduled start — that burst is the only
    # thing that now touches the pool at scale, since admitted WebSockets hold
    # ZERO connections while idle (see signaling.py's per-loop db.rollback()).
    # Total connections per instance = db_pool_size + db_max_overflow. Safe on
    # the Supabase transaction pooler (:6543), which multiplexes; do NOT push
    # high on the session pooler (:5432, 15-client cap). Overridable via
    # DB_POOL_SIZE / DB_MAX_OVERFLOW so it can be tuned from deploy env.
    db_pool_size: int = 40
    db_max_overflow: int = 20

    # Guest joins allowed per client IP per hour. Sized so a 50-100 person
    # meeting whose attendees share one corporate NAT (single egress IP) can
    # all join — the old 20 returned 429 to every guest past the 20th, which
    # looked like "can't join after ~15". Still blunts scripted room-flooding
    # (a bot from one IP is capped here, and combined with the per-meeting
    # guests_enabled kill-switch). Overridable via GUEST_JOIN_MAX_PER_HOUR.
    guest_join_max_per_hour: int = 250
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"

    # Comma-separated list of emails granted platform-admin access to the
    # /api/admin/* dashboard. Synced to users.is_admin on startup and also
    # checked live on each admin request, so adding an email here (+ restart)
    # is enough to grant access without touching the database.
    admin_emails: str = ""
    access_token_expire_minutes: int = 60 * 24 * 7
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # SMTP email settings (optional — invites/reminders disabled when not set)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    # Must be a real, existing domain — this address is used as the .ics
    # ORGANIZER, so attendee RSVPs are delivered here. The old zoikomeet.com
    # placeholder does not resolve (NXDOMAIN) and hard-bounced every RSVP.
    smtp_from_email: str = "noreply@zoikosema.com"
    smtp_from_name: str = "ZoikoSema"
    smtp_use_tls: bool = True
    # Set to True to use SMTP_SSL (port 465). When False (default), uses
    # STARTTLS on smtp_port. Auto-detected: port 465 forces SSL regardless.
    smtp_use_ssl: bool = False

    # Resend transactional email (preferred over SMTP when configured). The
    # API key is provided via env / GitHub / GCP secret as RESEND_API_KEY.
    # resend_from_email must be on a Resend-verified domain; when blank we fall
    # back to smtp_from_email (e.g. support@zoikosema.com).
    resend_api_key: str = ""
    resend_from_email: str = ""

    # Password-reset OTP policy
    otp_expiry_minutes: int = 10
    otp_max_attempts: int = 5
    otp_requests_per_hour: int = 5

    # Absolute, publicly-reachable URL of the ZoikoSema wordmark used in
    # transactional emails. Must be hosted (email clients block SVG / strip
    # base64), so this points at the prod static asset by default; override
    # with BRAND_EMAIL_LOGO_URL if the logo lives elsewhere.
    brand_email_logo_url: str = "https://meet.zoikosema.com/email-logo.png"

    # Absolute, publicly-reachable URL of the transparent-background ZoikoSema
    # wordmark used only by the redesigned invite email — kept separate from
    # brand_email_logo_url so reminder/cancelled/rsvp/password-reset emails are
    # unaffected. Override with BRAND_EMAIL_INVITE_LOGO_URL.
    brand_email_invite_logo_url: str = "https://meet.zoikosema.com/email-logo-invite.png"

    # Absolute, publicly-reachable URL of the square ZoikoSema app icon (favicon)
    # shown as the brand mark in transactional email headers. Same hosting
    # constraint as the wordmark above; override with BRAND_EMAIL_ICON_URL.
    brand_email_icon_url: str = "https://meet.zoikosema.com/icon-192.png"

    # Base URL for the hosted meeting-email hero illustrations
    # (email-hero-{invite,reminder,cancelled}.png in client/public/). Same host
    # as the assets above by default; override with BRAND_EMAIL_ASSET_BASE_URL.
    brand_email_asset_base_url: str = "https://meet.zoikosema.com"

    # Support ticket email — where user handoff requests are sent
    support_email: str = "support@zoikosema.com"

    # Frontend base URL for invite links
    frontend_url: str = "http://localhost:5173"

    # AI chatbot (Anthropic Claude)
    anthropic_api_key: str = ""
    ai_model: str = "claude-sonnet-4-20250514"

    # Post-meeting transcript summarizer — separate vendor from the
    # Anthropic-based chat/intelligence features above, used specifically for
    # turning the spoken-conversation transcript into {title, summary,
    # key_takeaways} once a meeting ends. `ai_provider`/`ai_api_key` are the
    # generic names the deploy env actually sets (AI_PROVIDER/AI_API_KEY);
    # `groq_api_key`/`groq_model` are vendor-specific fallbacks so this still
    # works if someone configures it that way instead. See
    # core/ai._get_groq_client() / groq_summarize_transcript() for how these
    # are combined.
    ai_provider: str = "anthropic"   # "anthropic" | "groq"
    ai_api_key: str = ""
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # Recording retention — recordings older than this are auto-deleted.
    # Set to 0 to disable the cleanup loop entirely.
    recording_retention_days: int = 30
    recording_cleanup_interval_seconds: int = 3600

    # Media plane (LiveKit)
    media_provider: str = "null"          # "livekit" | "null"
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    livekit_ws_url: str = ""               # e.g. ws://livekit:7880 (server-side, container DNS)
    livekit_public_ws_url: str = ""        # e.g. ws://localhost:7880 (browser-visible)
    # 6 hours. The browser mints this JWT once at join; the LiveKit SDK reuses
    # it for the lifetime of the session, including hard reconnects after a long
    # network outage. A short TTL (the old 15 min) meant a reconnect part-way
    # through a normal meeting could fail auth, since the client never re-mints.
    # 6h comfortably outlasts any real meeting while still bounding token replay.
    livekit_token_ttl_seconds: int = 21600

    # End-to-end encryption. All meetings are E2E-encrypted: audio/video frames
    # (LiveKit insertable-stream E2EE), in-call chat, and live captions are all
    # encrypted with a per-meeting key the SFU/app-server relays but cannot read.
    # The key is derived deterministically from this secret + the meeting code so
    # every participant (incl. guests) derives the SAME key without the plaintext
    # key ever crossing the wire. Falls back to jwt_secret when unset so local
    # dev works out of the box; set a dedicated E2EE_SECRET in prod.
    #
    # NOTE: this is server-derived, so the crypto is real (frames are opaque to
    # the SFU) but not "zero-knowledge" — the server COULD derive the key. To go
    # zero-knowledge later, swap this for a host passphrase shared out-of-band;
    # only the key-source changes, not the call sites.
    e2ee_secret: str = ""

    # Redis (control-plane fanout + idempotency cache)
    redis_url: str = ""

    # Sema Calendar & Mail — provider connection token vault (Phase 1 minimal
    # form, see architecture/SEMA_CALENDAR_MAIL_CONTEXT.md open question #3).
    # Fernet key (Fernet.generate_key()); empty in dev disables encrypt/decrypt
    # by raising, so a missing key fails loudly instead of storing plaintext.
    token_vault_key: str = ""

    # Google Calendar OAuth app (distinct from the login-OAuth app, if any —
    # this one requests Calendar API scopes, not identity scopes).
    google_calendar_client_id: str = ""
    google_calendar_client_secret: str = ""
    google_calendar_redirect_uri: str = ""

    # Microsoft Graph (Outlook Calendar) OAuth app registration.
    microsoft_calendar_client_id: str = ""
    microsoft_calendar_client_secret: str = ""
    microsoft_calendar_redirect_uri: str = ""
    # "common" accepts both personal Microsoft accounts and any Azure AD
    # tenant; override to a specific tenant GUID to restrict to one org.
    microsoft_calendar_tenant: str = "common"

    # Gmail OAuth app (Phase 3 slice 1) — a SEPARATE Google Cloud OAuth app
    # from google_calendar_*. Gmail restricted scopes (gmail.readonly, later
    # gmail.send) are their own Google verification/CASA review track
    # (spec §7.3); reusing the Calendar app's client id would conflate two
    # independent scope-review processes.
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    gmail_redirect_uri: str = ""

    # Microsoft Graph (Outlook Mail) OAuth app registration (Phase 3 slice 3)
    # — a SEPARATE Azure AD app registration from microsoft_calendar_*, same
    # reasoning as Gmail's separate app: Mail.Read is a materially different
    # permission grant than Calendars.Read and gets its own admin-consent/
    # review track.
    microsoft_mail_client_id: str = ""
    microsoft_mail_client_secret: str = ""
    microsoft_mail_redirect_uri: str = ""
    microsoft_mail_tenant: str = "common"

    # ZoikoTime workforce-truth availability signal (spec §6.1) — read-only
    # visibility only per Phase 1 phasing, hard enforcement is Phase 2+. Off
    # by default: no real data source exists yet in this repo (that's
    # plans/zoikotime-workforce-signal-integration.md's scope, a separate
    # cross-repo plan/webhook). Same flag name that plan already commits to,
    # so both sides gate on the identical setting once it lands.
    zoikotime_integration_enabled: bool = False

    # Upgrades the ZoikoTime signal from "visible" to "enforced" (spec §6.1:
    # "Constraint phases: read-only visibility Phase 1; hard enforcement
    # Phase 2+"). A plain global flag, not a Policy Engine category, is the
    # right size for this today: Policy Engine only models a per-category
    # autonomy ceiling, and there's no real WorkforceSignal data yet for a
    # tenant-versioned policy dimension to be worth the schema change — a
    # bare on/off knob is all this flag currently needs to do. Revisit if/
    # when real enforcement needs to vary per tenant. Meaningless unless
    # zoikotime_integration_enabled is also True.
    zoikotime_hard_enforcement_enabled: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def admin_email_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_user)

    @property
    def resend_enabled(self) -> bool:
        return bool(self.resend_api_key)

    @property
    def mail_from_email(self) -> str:
        """Sender address for outbound mail (Resend preferred, SMTP fallback)."""
        return self.resend_from_email or self.smtp_from_email


@lru_cache
def get_settings() -> Settings:
    return Settings()
