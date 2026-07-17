import logging
import re

log = logging.getLogger(__name__)

INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior|the\s+above)\s+(instructions|rules|prompts|directives)", re.I),
    re.compile(r"(you\s+are\s+(now|free)|act\s+as|pretend\s+to\s+be)\s+.*(dan|jailbreak|unfiltered|ungoverned)", re.I),
    re.compile(r"(bypass|circumvent|override)\s+(your\s+)?(safety|guardrails|restrictions|limits|rules)", re.I),
    re.compile(r"output\s+(raw\s+)?(json|markdown|code|text)\s+without\s+(any\s+)?(formatting|filtering)", re.I),
]

DISALLOWED_TOPICS = [
    re.compile(r"(hack|crack|exploit|breach|intrude)\s+(into|the\s+)?", re.I),
    re.compile(r"steal|theft|rob|scam|fraud", re.I),
    re.compile(r"(phish|social.engineer|spoof)\w*", re.I),
    re.compile(r"(malware|ransomware|trojan|keylogger|backdoor|rootkit)", re.I),
    re.compile(r"(sql|command|code)\s*(injection|exploit)", re.I),
    re.compile(r"dump\s+(database|credentials|passwords|tables)", re.I),
    re.compile(r"(ddos|dos)\s+(attack|amplification)", re.I),
    re.compile(r"crack\s+(password|hash|credential|auth)", re.I),
    re.compile(r"(find|get|fetch|extract)\s+(all\s+)?(users?|emails?|passwords?|admins?)", re.I),
    re.compile(r"list\s+(all\s+)?(users|admins|customers|accounts)", re.I),
    re.compile(r"(source\s+code|codebase|repository)\s+(of|for|dump|give)", re.I),
    re.compile(r"(internal|private)\s+(api|endpoint|url|ip|network)", re.I),
    re.compile(r"(env|environment)\s*(variable|file)", re.I),
]

CREDENTIAL_PATTERNS = [
    re.compile(r"(-----BEGIN\s+(RSA|OPENSSH|EC|PGP)\s+PRIVATE\s+KEY-----)", re.I),
    re.compile(r"(sk[-_][a-zA-Z0-9]{20,}|pk[-_][a-zA-Z0-9]{20,})"),
    re.compile(r"(ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]{36,}"),
    re.compile(r"(AKIA[0-9A-Z]{16})"),
    re.compile(r"(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})"),
]

OUTPUT_DISALLOWED = [
    re.compile(r"(-----BEGIN\s+(RSA|OPENSSH|EC|PGP)\s+PRIVATE\s+KEY-----)", re.I),
    re.compile(r"(sk[-_][a-zA-Z0-9]{20,}|pk[-_][a-zA-Z0-9]{20,})"),
    re.compile(r"(ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]{36,}"),
    re.compile(r"(AKIA[0-9A-Z]{16})"),
    re.compile(r"(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})"),
    re.compile(r"(password|passcode|secret\s*key|api\s*key|credential|private\s*key)\s*(is|:|=)", re.I),
    re.compile(r"(DATABASE_URL|JWT_SECRET|ANTHROPIC_API_KEY|AI_API_KEY|LIVEKIT_API_KEY|LIVEKIT_API_SECRET)", re.I),
    re.compile(r"(docker-compose|Dockerfile|docker-compose\.(yml|yaml))\s*(content|code|config)", re.I),
    re.compile(r"(server/app/\S+|client/src/\S+)\s+(code|file|implementation|class|function)", re.I),
    re.compile(r"here['\u2019]s\s+(the\s+)?(code|implementation|full|source)", re.I),
]


class GuardrailResult:
    def __init__(self, allowed: bool, reason: str | None = None):
        self.allowed = allowed
        self.reason = reason


def check_input(message: str) -> GuardrailResult:
    if not message:
        return GuardrailResult(allowed=False, reason="Empty message")

    for pattern in INJECTION_PATTERNS:
        if pattern.search(message):
            log.warning("Input guardrail blocked prompt injection: %r", message[:80])
            return GuardrailResult(
                allowed=False,
                reason="Your message was flagged as a policy violation. Please ask a product-related question.",
            )

    for pattern in DISALLOWED_TOPICS:
        if pattern.search(message):
            log.warning("Input guardrail blocked disallowed topic: %r", message[:80])
            return GuardrailResult(
                allowed=False,
                reason="I can only help with Zoiko Sema product questions. Please ask about using the app.",
            )

    for pattern in CREDENTIAL_PATTERNS:
        if pattern.search(message):
            log.warning("Input guardrail blocked message containing credentials: %r", message[:80])
            return GuardrailResult(
                allowed=False,
                reason="Your message appears to contain credential-like content. Please remove it and try again.",
            )

    return GuardrailResult(allowed=True)


def check_output(text: str) -> GuardrailResult:
    if not text:
        return GuardrailResult(allowed=False, reason="Empty response")

    for pattern in OUTPUT_DISALLOWED:
        if pattern.search(text):
            log.warning("Output guardrail blocked response containing sensitive content")
            return GuardrailResult(
                allowed=False,
                reason="Response blocked by content safety policy.",
            )

    return GuardrailResult(allowed=True)
