"""Guest (anonymous) join helpers: display-name sanitization + avatar color.

The server NEVER trusts a client-supplied guest name. `sanitize_display_name`
is the single chokepoint that every guest name passes through before it touches
the DB or any render surface (participant tiles, chat, waiting room, LiveKit
metadata). It strips control / invisible / bidi-override unicode and HTML markup
so a guest can't spoof another participant, inject script into a render context,
or break layout with zero-width runs.
"""

import hashlib
import re
import unicodedata

# Validation bounds (kept in sync with the client validateDisplayName util).
MIN_NAME_LEN = 2
MAX_NAME_LEN = 50

# Zero-width, bidi-control, and other invisible/format characters that must be
# stripped: they render as nothing but can spoof names ("Admin" + ZWSP) or flip
# text direction. We drop everything in unicode category "Cf" (format) plus the
# explicit zero-width set, and all "Cc" (control) chars.
_INVISIBLE = {
    "​", "‌", "‍", "‎", "‏",  # ZW space/joiners + LRM/RLM
    "‪", "‫", "‬", "‭", "‮",  # bidi embeddings/overrides
    "⁠", "﻿",                                  # word-joiner / BOM
}

# Collapse any run of unicode whitespace to a single ASCII space.
_WS_RUN = re.compile(r"\s+")


class DisplayNameError(ValueError):
    """Raised when a guest display name cannot be made valid."""


def sanitize_display_name(raw: str | None) -> str:
    """Clean and validate a guest display name.

    Steps: NFC-normalize → drop control/format/invisible chars → strip HTML
    angle brackets → collapse whitespace → trim → enforce 2..50 chars.

    Raises DisplayNameError (→ HTTP 422) when the result is too short/long so
    the client gets actionable feedback rather than a silently-mangled name.
    """
    if raw is None:
        raise DisplayNameError("Display name is required")

    # Normalize first so composed/decomposed forms compare and count consistently.
    text = unicodedata.normalize("NFC", str(raw))

    # Drop control (Cc) and format (Cf) characters plus the explicit invisible set.
    cleaned_chars = []
    for ch in text:
        if ch in _INVISIBLE:
            continue
        cat = unicodedata.category(ch)
        if cat in ("Cc", "Cf"):
            continue
        cleaned_chars.append(ch)
    text = "".join(cleaned_chars)

    # Remove HTML angle brackets outright — kills `<script>`, `<img onerror>`,
    # and stray tags. SQL injection is already impossible (ORM-parameterized),
    # but stripping markup hardens every HTML render path defensively.
    text = text.replace("<", "").replace(">", "")

    # Collapse whitespace runs and trim leading/trailing space.
    text = _WS_RUN.sub(" ", text).strip()

    if len(text) < MIN_NAME_LEN:
        raise DisplayNameError(
            f"Display name must be at least {MIN_NAME_LEN} characters"
        )
    if len(text) > MAX_NAME_LEN:
        # Hard cap rather than silently truncating, so the user notices.
        raise DisplayNameError(
            f"Display name must be at most {MAX_NAME_LEN} characters"
        )
    return text


# A distinct palette for guest avatars (warm slate/amber tones) so guests read
# as visibly different from member avatars (#5b8def blue family) even before the
# "(Guest)" badge renders. Deterministic per name so the same guest keeps a
# stable color across a session.
_GUEST_COLORS = [
    "#b45309",  # amber-700
    "#9a3412",  # orange-800
    "#78716c",  # stone-500
    "#a16207",  # yellow-700
    "#57534e",  # stone-600
    "#92400e",  # amber-800
]


def guest_avatar_color(seed: str) -> str:
    """Pick a stable guest avatar color from the guest palette."""
    h = hashlib.sha256((seed or "guest").encode("utf-8")).hexdigest()
    return _GUEST_COLORS[int(h[:8], 16) % len(_GUEST_COLORS)]
