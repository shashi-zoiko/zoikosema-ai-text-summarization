"""DLP MVP — outbound preflight scanning (Phase 3 slice 6).

Spec §4.1 (`dlp_verdict` autonomy input) / §10.2 (outbound leakage). This is
the first real consumer of Policy Engine's `dlp_verdict` input, which Phase
2 slice 1 explicitly stubbed as always-pass ("no feature exists yet to
produce a real verdict" — see policy_engine/service.py's
`_UNIMPLEMENTED_INPUTS`). Rule-based pattern matching only (SSNs, credit
card numbers, common secret-key formats, a keyword list) — NOT an ML
classifier; spec's own MVP framing and Build/Integrate/Defer table don't
mandate a trained model, and building one now with no labeled data would
be premature. A structured, extensible rule engine a later slice can swap
for a real ML/vendor DLP product without changing callers — `scan()`'s
signature is the seam.

Scoped to mail sends only (spec scopes DLP to mail; calendar's own
confidentiality mechanism, Phase 2 slice 7, is a different control) — do
not wire this into calendar event creation.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

Verdict = Literal["pass", "warn", "fail"]

# Configurable keyword list — MVP: a module constant, not yet a per-tenant
# setting (no config storage/UI exists for one). Promote to a real
# per-tenant table if a real caller needs to customize this; every tenant
# shares this list today.
DEFAULT_SENSITIVE_KEYWORDS = (
    "do not forward",
    "internal only",
    "confidential — do not distribute",
)

_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_CARD_CANDIDATE_RE = re.compile(r"(?:\d[ -]?){13,19}")
_SECRET_KEY_PREFIXES = (
    "sk_live_", "sk_test_", "AKIA", "ghp_", "gho_", "ghu_", "ghs_", "ghr_",
    "xoxb-", "xoxp-", "AIza",
    "-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----",
)


def _luhn_valid(digits: str) -> bool:
    total = 0
    for i, d in enumerate(digits[::-1]):
        n = int(d)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def _contains_credit_card(text: str) -> bool:
    for match in _CARD_CANDIDATE_RE.finditer(text):
        digits = re.sub(r"[ -]", "", match.group())
        if 13 <= len(digits) <= 19 and _luhn_valid(digits):
            return True
    return False


def _contains_secret_key(text: str) -> bool:
    return any(prefix in text for prefix in _SECRET_KEY_PREFIXES)


def _matched_keyword(text: str) -> str | None:
    lowered = text.lower()
    for kw in DEFAULT_SENSITIVE_KEYWORDS:
        if kw.lower() in lowered:
            return kw
    return None


@dataclass(frozen=True)
class DlpVerdict:
    verdict: Verdict
    # Rule NAMES only, never the matched substring itself — a verdict is
    # logged (audit metadata, error details) and must not become a second
    # place the sensitive data it caught leaks into.
    matched_rules: list[str] = field(default_factory=list)


def scan(*, body_text: str, attachments: list[dict[str, Any]] | None = None) -> DlpVerdict:
    """Rule-based scan of outbound mail body text.

    `attachments` is accepted for call-shape parity with the spec's stated
    signature (`check_outbound_dlp(..., attachments=None)`) but not yet
    scanned — attachment content scanning (e.g. an SSN embedded in a PDF)
    needs a real content-extraction pipeline this MVP doesn't have. A real,
    disclosed gap, not a silent one.
    """
    matched: list[str] = []

    if _SSN_RE.search(body_text):
        matched.append("ssn_pattern")
    if _contains_credit_card(body_text):
        matched.append("credit_card_pattern")
    if _contains_secret_key(body_text):
        matched.append("secret_key_pattern")

    if matched:
        return DlpVerdict(verdict="fail", matched_rules=matched)

    if _matched_keyword(body_text) is not None:
        return DlpVerdict(verdict="warn", matched_rules=["sensitive_keyword"])

    return DlpVerdict(verdict="pass", matched_rules=[])
