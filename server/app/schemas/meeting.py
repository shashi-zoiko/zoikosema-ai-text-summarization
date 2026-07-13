from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class MeetingCreate(BaseModel):
    title: str = Field(default="Instant meeting", max_length=200)
    scheduled_at: datetime | None = None
    timezone_name: str | None = Field(default=None, max_length=64)
    waiting_room_enabled: bool = True
    password: str | None = Field(default=None, max_length=128)


class MeetingUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    scheduled_at: datetime | None = None
    timezone_name: str | None = Field(default=None, max_length=64)
    waiting_room_enabled: bool | None = None
    locked: bool | None = None
    chat_enabled: bool | None = None
    screenshare_enabled: bool | None = None
    guests_enabled: bool | None = None


class MeetingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    title: str
    host_id: int
    is_active: bool
    scheduled_at: datetime | None = None
    timezone_name: str | None = None
    waiting_room_enabled: bool = True
    locked: bool = False
    chat_enabled: bool = True
    screenshare_enabled: bool = True
    guests_enabled: bool = True
    password_protected: bool = False
    media_provider: str = "mesh"   # "mesh" | "livekit"
    status: str = "live"           # "scheduled" | "live" | "ended" | "cancelled"
    waiting_count: int = 0         # live pending-in-waiting-room count (single-meeting GET only)
    created_at: datetime
    ended_at: datetime | None = None
    cancelled_at: datetime | None = None


class ParticipantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    role: str
    status: str
    joined_at: datetime
    left_at: datetime | None = None


class MeetingRoster(BaseModel):
    """Richer view used by the in-meeting host panel — adds user names/colors so
    the client doesn't have to cross-reference another endpoint."""

    meeting: MeetingOut
    participants: list[dict]


class JoinMeetingIn(BaseModel):
    code: str
    password: str | None = None


class ParticipantActionIn(BaseModel):
    user_id: int


# ── Recording schemas ──────────────────────────────────────────────────────

class RecordingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    meeting_id: int
    user_id: int
    file_url: str | None = None
    file_name: str
    file_size: int | None = None
    duration: int | None = None
    includes_chat: bool = False
    chat_log_url: str | None = None
    status: str
    share_token: str | None = None
    created_at: datetime
    meeting_code: str | None = None
    meeting_title: str | None = None
    recorder_name: str | None = None


class RecordingShareOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    file_url: str | None = None
    file_name: str
    file_size: int | None = None
    duration: int | None = None
    includes_chat: bool = False
    chat_log_url: str | None = None
    status: str
    created_at: datetime
    meeting_title: str | None = None
    recorder_name: str | None = None


# ── Private notes (per-participant notebook) ───────────────────────────────

class PrivateNotesUpdate(BaseModel):
    """Partial update of the caller's own notebook. Every field is optional so
    autosave can PATCH just the tab the user touched; omitted fields are left
    unchanged. user_id is NEVER accepted here — it comes from the JWT."""

    notes_json: dict | None = None
    drawing_json: dict | None = None
    sticky_notes: list | None = None
    canvas_state: dict | None = None


class PrivateNotesOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    notes_json: dict | None = None
    drawing_json: dict | None = None
    sticky_notes: list | None = None
    canvas_state: dict | None = None
    updated_at: datetime | None = None


# ── Meeting intelligence ───────────────────────────────────────────────────

class IntelligenceGenerateIn(BaseModel):
    # Optional inline chat log (oldest-first). If omitted the server falls back
    # to the latest recording's chat_log file for this meeting.
    chat_log: list[dict] | None = None
    # Optional roster snapshot for richer speaker analytics.
    participants: list[dict] | None = None
    # Force a fresh generation even if a recent ready record exists.
    force: bool = False
    # Post-meeting SPOKEN transcript (from the in-meeting caption pipeline,
    # never the text chat log) — {time, name, body}-shaped, oldest-first, same
    # as `chat_log`. When present, generation branches to Groq
    # (core/ai.groq_summarize_transcript) instead of Claude, and the result is
    # stored with source=INTEL_SOURCE_TRANSCRIPT. Host/admin-only — see
    # generate_intelligence().
    transcript: list[dict] | None = None
    # Target language for the summary output (e.g. "english", "spanish",
    # "hindi", "french", "german", "chinese", "japanese"). Defaults to english.
    language: str = "english"


class IntelligenceEditIn(BaseModel):
    """Host/admin edit of a transcript-sourced summary's fields — see
    edit_intelligence() in api/intelligence.py. Only fields the caller
    actually sends get overwritten."""
    title: str | None = None
    summary: str | None = None
    key_takeaways: list[dict] | None = None


class MeetingIntelligenceOut(BaseModel):
    # `model_used` field clashes with pydantic v2's reserved `model_` prefix
    # for namespace methods. Disabling the warning since renaming the column
    # would break the existing UI contract.
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: int
    meeting_id: int
    recording_id: int | None = None
    requested_by_id: int | None = None
    status: str
    source: str
    model_used: str | None = None
    tldr: str | None = None
    payload: dict | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None = None
    error_message: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
    meeting_code: str | None = None
    meeting_title: str | None = None
