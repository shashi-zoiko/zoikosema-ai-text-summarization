from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg2://zoiko:zoiko_dev@localhost:5432/zoiko"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # SMTP email settings (optional — invites/reminders disabled when not set)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_email: str = "noreply@zoikomeet.com"
    smtp_from_name: str = "ZoikoSema"
    smtp_use_tls: bool = True

    # Frontend base URL for invite links
    frontend_url: str = "http://localhost:5173"

    # AI chatbot (Anthropic Claude)
    anthropic_api_key: str = ""
    ai_model: str = "claude-sonnet-4-20250514"

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

    # Redis (control-plane fanout + idempotency cache)
    redis_url: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_user)


@lru_cache
def get_settings() -> Settings:
    return Settings()
