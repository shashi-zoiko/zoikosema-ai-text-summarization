import logging

log = logging.getLogger(__name__)

_MEETING_ISOLATION: dict[str, dict] = {}


def is_meeting_context(context: dict | None) -> bool:
    if not context:
        return False
    return bool(context.get("meeting_code") or context.get("in_meeting"))


def apply_meeting_isolation(user_id: int, meeting_code: str, enabled: bool = True) -> None:
    key = f"{user_id}:{meeting_code}"
    if enabled:
        _MEETING_ISOLATION[key] = {
            "user_id": user_id,
            "meeting_code": meeting_code,
            "confidential": True,
        }
        log.info("Confidential Mode enabled for user %s in meeting %s", user_id, meeting_code)
    else:
        _MEETING_ISOLATION.pop(key, None)


def is_confidential(user_id: int, meeting_code: str) -> bool:
    key = f"{user_id}:{meeting_code}"
    entry = _MEETING_ISOLATION.get(key)
    return bool(entry and entry.get("confidential"))


def get_permitted_context(user_id: int, meeting_code: str) -> dict:
    if is_confidential(user_id, meeting_code):
        return {
            "meeting_code": meeting_code,
            "confidential": True,
            "access": "shell_only",
            "note": "Confidential Mode — meeting content is inaccessible",
        }
    return {
        "meeting_code": meeting_code,
        "confidential": False,
        "access": "full",
    }
