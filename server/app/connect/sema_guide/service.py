import logging
import time
import uuid

from app.core.config import get_settings
from app.connect.sema_guide.models import GuideChatResponse, Source, ActionPreview
from app.connect.sema_guide.prompt_registry import build_system_prompt
from app.connect.sema_guide.context_orchestrator import build_context
from app.connect.sema_guide.guardrails import check_input, check_output
from app.connect.sema_guide.response_validator import validate_response
from app.connect.sema_guide.ai_gateway import gateway
from app.connect.sema_guide.observability import record_span, RequestSpan

log = logging.getLogger(__name__)


def _get_client():
    """Return a Groq client (official SDK — same one core/ai.py's transcript
    summarizer uses, already a real dependency, unlike the openai package).

    Sema Guide has no Anthropic code path left (Groq-only since the
    guardrails rework), so this doesn't gate on `settings.ai_provider` —
    that flag is shared with other AI features (see core/ai.py) and
    defaults to "anthropic", which would silently disable Sema Guide on
    any deployment that doesn't also flip the global default. Presence of
    a usable key is the only real precondition here.
    """
    settings = get_settings()
    try:
        import groq
    except ImportError:
        log.warning("groq package not installed — Sema Guide AI disabled")
        return None
    key = settings.ai_api_key or settings.groq_api_key
    if not key:
        return None
    return groq.Groq(api_key=key)


def chat(
    message: str,
    conversation: list[dict],
    user_id: int = 0,
    user_name: str = "User",
    user_role: str = "member",
    user_plan: str = "free",
    surface: str | None = None,
    page_route: str | None = None,
) -> GuideChatResponse:
    MAX_MESSAGE_LENGTH = 500
    if len(message) > MAX_MESSAGE_LENGTH:
        return GuideChatResponse(
            response=f"Message too long ({len(message)} chars). Please keep messages under {MAX_MESSAGE_LENGTH} characters.",
            verified=False,
        )

    gd = gateway.check_request(
        user_id=user_id,
        feature="sema_guide_chat",
        plan=user_plan,
    )
    if not gd.allowed:
        return GuideChatResponse(
            response=f"I'm currently unavailable ({gd.reason}). Please try again shortly.",
            verified=False,
        )

    client = _get_client()
    if not client:
        return GuideChatResponse(
            response="Sema Guide is not configured. Please set AI_API_KEY (or GROQ_API_KEY) in the server environment.",
            verified=False,
        )

    request_id = uuid.uuid4().hex[:16]
    started_at = time.time()
    settings = get_settings()

    span = RequestSpan(
        request_id=request_id,
        tenant_id=None,
        user_id=user_id,
        feature="sema_guide_chat",
        started_at=started_at,
    )

    system = build_system_prompt(user_name=user_name, user_role=user_role, user_plan=user_plan)

    if surface or page_route:
        system += f"\n\nCurrent context — surface: {surface or 'unknown'}, page: {page_route or 'unknown'}"

    user_context = {
        "user_name": user_name,
        "user_role": user_role,
        "user_plan": user_plan,
        "surface": surface,
        "page_route": page_route,
    }

    gr = check_input(message)
    if not gr.allowed:
        return GuideChatResponse(
            response=gr.reason or "Message blocked.",
            verified=False,
        )

    ctx = build_context(message, user_context, max_tokens=gd.cost_ceiling or 2000)

    if ctx.context_text:
        system += f"\n\nRelevant knowledge context:\n{ctx.context_text}"

    system += "\n\nWhen providing answers, cite your sources using the labels from the knowledge context above."

    messages = list(conversation)
    messages.append({"role": "user", "content": message})

    try:
        groq_messages = [{"role": "system", "content": system}] + messages
        response = client.chat.completions.create(
            model=settings.ai_model,
            max_tokens=gd.cost_ceiling or 2048,
            messages=groq_messages,
        )
        text = response.choices[0].message.content if response.choices else ""

        ogr = check_output(text)
        if not ogr.allowed:
            text = "I'm unable to provide that response. Please ask a product-related question."

        is_valid, validation_error = validate_response(text, {
            "requires_source": bool(ctx.sources),
            "has_sources": len(ctx.sources) > 0,
        })

        seen = set()
        unique_sources = []
        for s in ctx.sources:
            key = s.get("title") or s.get("label", "")
            if key not in seen:
                seen.add(key)
                unique_sources.append(Source(
                    label=s["label"],
                    url=s.get("url"),
                    title=s.get("title", ""),
                ))

        sources = unique_sources

        span.success = is_valid
        span.duration_ms = round((time.time() - started_at) * 1000, 1)
        record_span(span)

        return GuideChatResponse(
            response=text,
            verified=is_valid,
            sources=sources,
        )
    except Exception as e:
        log.exception("Sema Guide chat error")
        span.success = False
        span.error = str(e)
        span.duration_ms = round((time.time() - started_at) * 1000, 1)
        record_span(span)

        return GuideChatResponse(
            response=f"Sorry, I encountered an error: {str(e)}",
            verified=False,
        )
