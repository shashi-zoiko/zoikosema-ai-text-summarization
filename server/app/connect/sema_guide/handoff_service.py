import logging
import time
import uuid
from enum import Enum

log = logging.getLogger(__name__)


class HandoffState(Enum):
    IDLE = "idle"
    REQUESTED = "requested"
    QUEUED = "queued"
    CONNECTING = "connecting"
    ASSIGNED = "human_assigned"
    FAILED = "failed"


class HandoffSession:
    id: str
    user_id: int
    state: HandoffState
    requested_at: float
    assigned_at: float | None
    specialist_name: str | None
    context: dict
    estimated_wait_seconds: int

    def __init__(self, user_id: int, context: dict | None = None):
        self.id = uuid.uuid4().hex[:12]
        self.user_id = user_id
        self.state = HandoffState.QUEUED
        self.requested_at = time.time()
        self.assigned_at = None
        self.specialist_name = None
        self.context = context or {}
        self.estimated_wait_seconds = 120


_sessions: dict[str, HandoffSession] = {}


def request_handoff(user_id: int, context: dict | None = None) -> HandoffSession:
    session = HandoffSession(user_id, context)
    _sessions[session.id] = session
    log.info("Handoff requested for user %s (session %s)", user_id, session.id)
    return session


def get_session(session_id: str) -> HandoffSession | None:
    return _sessions.get(session_id)


def get_active_session(user_id: int) -> HandoffSession | None:
    for s in _sessions.values():
        if s.user_id == user_id and s.state in (HandoffState.QUEUED, HandoffState.CONNECTING, HandoffState.ASSIGNED):
            return s
    return None
