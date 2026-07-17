import logging
import re

log = logging.getLogger(__name__)

BLOCKED_PATTERNS = [
    re.compile(r"(password|passcode|pin|secret\s*key|api\s*key|credential|private\s*key)", re.IGNORECASE),
]


def validate_response(text: str, context: dict) -> tuple[bool, str | None]:
    if not text:
        return False, "Empty response"

    for pattern in BLOCKED_PATTERNS:
        if pattern.search(text):
            return False, "Response may contain sensitive information"

    if context.get("requires_source") and not context.get("has_sources"):
        return False, "Factual claim made without source citation"

    return True, None
