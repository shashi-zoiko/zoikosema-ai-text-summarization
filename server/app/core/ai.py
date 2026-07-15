"""AI assistant service — chat/intelligence powered by Anthropic Claude,
post-meeting transcript summarization powered by Groq (see bottom of file)."""
import json
import logging
import re
import time
from datetime import datetime, timezone

from app.core.config import get_settings

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Zoiko, the AI assistant built into ZoikoSema — a real-time SaaS video conferencing and team chat platform.

Your capabilities:
- Answer questions about ZoikoSema features (meetings, chat, recordings, screen sharing, whiteboard, etc.)
- Help users create, join, and manage meetings
- Summarize meeting discussions from chat logs
- Generate meeting notes and action items
- Suggest meeting best practices (muting, camera usage, etc.)
- Assist hosts with participant management tips
- Provide real-time intelligent suggestions

Keep responses concise, professional, and helpful. Use markdown formatting when appropriate.
When asked to summarize or generate notes, structure them clearly with headings and bullet points.

Current date/time: {current_time}
User: {user_name} ({user_email})
"""


def _get_client():
    """Lazy-import anthropic to avoid startup crash if not installed."""
    try:
        import anthropic
        settings = get_settings()
        if not settings.anthropic_api_key:
            return None
        return anthropic.Anthropic(api_key=settings.anthropic_api_key)
    except ImportError:
        log.warning("anthropic package not installed — AI features disabled")
        return None


def ai_chat(
    messages: list[dict],
    user_name: str = "User",
    user_email: str = "",
    meeting_context: dict | None = None,
) -> str:
    """Send a conversation to the AI and return the response text.

    messages: list of {"role": "user"|"assistant", "content": "..."}
    meeting_context: optional dict with meeting_code, title, participants, chat_log
    """
    client = _get_client()
    if not client:
        return "AI assistant is not configured. Please set your `ANTHROPIC_API_KEY` in the server environment."

    settings = get_settings()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    system = SYSTEM_PROMPT.format(
        current_time=now,
        user_name=user_name,
        user_email=user_email,
    )

    if meeting_context:
        system += "\n\nCurrent meeting context:\n"
        if meeting_context.get("meeting_code"):
            system += f"- Meeting code: {meeting_context['meeting_code']}\n"
        if meeting_context.get("title"):
            system += f"- Title: {meeting_context['title']}\n"
        if meeting_context.get("participants"):
            system += f"- Participants: {', '.join(meeting_context['participants'])}\n"
        if meeting_context.get("chat_log"):
            system += f"\nRecent chat log:\n{meeting_context['chat_log']}\n"

    try:
        response = client.messages.create(
            model=settings.ai_model,
            max_tokens=1024,
            system=system,
            messages=messages,
        )
        return response.content[0].text
    except Exception as e:
        log.exception("AI chat error")
        return f"Sorry, I encountered an error: {str(e)}"


def ai_summarize(chat_log: list[dict], meeting_title: str = "Meeting") -> str:
    """Generate a meeting summary from chat messages."""
    if not chat_log:
        return "No chat messages to summarize."

    formatted = "\n".join(
        f"[{m.get('time', '')}] {m.get('name', 'Unknown')}: {m.get('body', '')}"
        for m in chat_log
    )

    messages = [{
        "role": "user",
        "content": (
            f"Please summarize this meeting chat log from \"{meeting_title}\".\n"
            f"Provide:\n"
            f"1. A brief summary (2-3 sentences)\n"
            f"2. Key discussion points\n"
            f"3. Action items (if any)\n"
            f"4. Decisions made (if any)\n\n"
            f"Chat log:\n{formatted}"
        ),
    }]

    return ai_chat(messages, user_name="System", user_email="system@zoikomeet.com")


def ai_suggest_replies(
    recent_messages: list[dict],
    my_name: str = "User",
    context: str | None = None,
) -> list[str]:
    """Return up to three short reply suggestions for the next message.
    recent_messages: list of {"name", "body"} ordered oldest -> newest.
    Falls back to an empty list if the AI client isn't configured."""
    client = _get_client()
    if not client or not recent_messages:
        return []

    settings = get_settings()
    convo = "\n".join(
        f"{m.get('name', 'Someone')}: {m.get('body', '')}"
        for m in recent_messages[-8:]
    )
    prompt = (
        f"You are helping {my_name} pick a quick reply to send next in a chat.\n"
        + (f"Channel context: {context}\n" if context else "")
        + "Read the last few messages and propose THREE short reply options "
        "(each <= 12 words, distinct in tone — e.g. acknowledge, clarify, decline). "
        "Return them as a JSON array of strings, no other text.\n\n"
        f"Conversation so far:\n{convo}"
    )
    try:
        response = client.messages.create(
            model=settings.ai_model,
            max_tokens=240,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        # Strip markdown fences if the model wraps the JSON
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:].strip()
        suggestions = json.loads(text)
        if isinstance(suggestions, list):
            return [str(s)[:140] for s in suggestions[:3]]
    except Exception:
        log.exception("ai_suggest_replies failed")
    return []


def ai_suggest_actions(
    participants: list[dict],
    chat_messages: list[dict],
    meeting_duration_minutes: int = 0,
) -> list[str]:
    """Generate smart suggestions for the host based on meeting state."""
    suggestions = []

    # Rule-based suggestions (no AI needed)
    muted_count = sum(1 for p in participants if not p.get("audio", True))
    total = len(participants)

    if total > 3 and muted_count < total * 0.5:
        suggestions.append("Consider asking participants to mute when not speaking to reduce background noise.")

    if meeting_duration_minutes > 60:
        suggestions.append("Meeting has been running for over an hour. Consider taking a short break.")

    if meeting_duration_minutes > 5 and len(chat_messages) == 0:
        suggestions.append("No chat activity yet. Encourage participants to use chat for questions.")

    hands_raised = [p.get("name", "Someone") for p in participants if p.get("hand")]
    if hands_raised:
        names = ", ".join(hands_raised[:3])
        suggestions.append(f"{names} {'has' if len(hands_raised) == 1 else 'have'} a hand raised.")

    inactive = [p for p in participants if not p.get("audio", True) and not p.get("video", True)]
    if len(inactive) > total * 0.5 and total > 2:
        suggestions.append("Most participants have both audio and video off. Consider checking if everyone is engaged.")

    return suggestions


# ── Structured meeting intelligence ────────────────────────────────────────

# The 3 fixed table types every intelligence/summary payload always carries,
# in display order. Columns are fixed per type — only `rows` varies per
# meeting. Unlike the old single-auto-picked-table design, all 3 always show
# on the summary page's Table view so users can see at a glance which aspects
# of project management this meeting did/didn't cover.
_TABLE_DEFS = [
    ("task_tracker", "Task Tracker", [
        {"key": "task", "label": "Task"},
        {"key": "assignee", "label": "Assignee"},
        {"key": "deadline", "label": "Deadline"},
    ]),
    ("resource_allocation", "Resource Allocation", [
        {"key": "member", "label": "Team Member"},
        {"key": "hours", "label": "Hours Allocated"},
        {"key": "cost", "label": "Cost"},
    ]),
    ("risk_matrix", "Risk Matrix", [
        {"key": "risk", "label": "Project Risk"},
        {"key": "impact", "label": "Impact"},
        {"key": "solution", "label": "Solution"},
    ]),
]


def _empty_tables() -> list[dict]:
    return [
        {"type": t, "type_label": label, "columns": cols, "rows": []}
        for t, label, cols in _TABLE_DEFS
    ]


# Schema string is embedded in the prompt so the model knows exactly what
# JSON shape to produce. Kept in lockstep with `_EMPTY_INTELLIGENCE` so the
# UI never has to special-case "missing key" vs "empty list".
_INTELLIGENCE_SCHEMA = """{
  "tldr": "2-3 sentence executive headline — what happened, why it matters",
  "score": {
    "productivity": 0-100,
    "clarity": 0-100,
    "decision_speed": 0-100,
    "participation": 0-100,
    "overall": 0-100
  },
  "topics": [
    {"title": "string", "summary": "1-2 sentence summary", "started_at": "HH:MM or null", "ended_at": "HH:MM or null"}
  ],
  "decisions": [
    {"title": "string", "detail": "string", "type": "approved|rejected|deferred|escalated", "time": "HH:MM or null"}
  ],
  "action_items": [
    {"task": "string", "owner": "person name or null", "due": "YYYY-MM-DD or relative string or null", "priority": "low|med|high", "depends_on": "string or null"}
  ],
  "risks": [
    {"title": "string", "severity": "low|med|high", "rationale": "1 sentence why this is risky"}
  ],
  "speakers": [
    {"name": "string", "message_count": 0, "role_in_meeting": "leader|expert|contributor|silent|blocker", "highlights": ["short quotes or paraphrases"]}
  ],
  "sentiment": {
    "overall": "positive|neutral|mixed|negative",
    "energy": "low|medium|high",
    "notes": "1-2 sentences about team mood / confidence"
  },
  "follow_ups": {
    "emails": ["drafted subject lines for follow-up emails"],
    "slack": ["1-line slack updates"],
    "tasks": ["jira-style task titles"]
  },
  "contradictions": [
    {"summary": "what conflicts", "between": ["statement A", "statement B"]}
  ],
  "knowledge_nuggets": ["facts/decisions worth saving to the org wiki"],
  "tables": [
    {"type": "task_tracker", "type_label": "Task Tracker", "columns": [{"key": "task", "label": "Task"}, {"key": "assignee", "label": "Assignee"}, {"key": "deadline", "label": "Deadline"}], "rows": [{"task": "string", "assignee": "string", "deadline": "string"}]},
    {"type": "resource_allocation", "type_label": "Resource Allocation", "columns": [{"key": "member", "label": "Team Member"}, {"key": "hours", "label": "Hours Allocated"}, {"key": "cost", "label": "Cost"}], "rows": []},
    {"type": "risk_matrix", "type_label": "Risk Matrix", "columns": [{"key": "risk", "label": "Project Risk"}, {"key": "impact", "label": "Impact"}, {"key": "solution", "label": "Solution"}], "rows": [{"risk": "string", "impact": "string", "solution": "string"}]}
  ]
}"""


def _empty_intelligence() -> dict:
    """Default-shaped intelligence object. Returned when there's nothing
    meaningful to summarize so the UI can always render the same structure."""
    return {
        "tldr": "",
        "score": {
            "productivity": 0,
            "clarity": 0,
            "decision_speed": 0,
            "participation": 0,
            "overall": 0,
        },
        "topics": [],
        "decisions": [],
        "action_items": [],
        "risks": [],
        "speakers": [],
        "sentiment": {"overall": "neutral", "energy": "low", "notes": ""},
        "follow_ups": {"emails": [], "slack": [], "tasks": []},
        "contradictions": [],
        "knowledge_nuggets": [],
        "tables": _empty_tables(),
    }


def _extract_json(text: str) -> dict | None:
    """Best-effort JSON extraction from a model response.

    Claude is generally cooperative when asked to output raw JSON, but it
    occasionally wraps the payload in ```json fences or trailing prose. We
    strip fences first, then fall back to grabbing the largest {...} block.
    """
    if not text:
        return None
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        # Drop a leading "json" language tag if present
        if raw.lower().startswith("json"):
            raw = raw[4:].lstrip("\r\n ")
        # Trim any trailing fence remnants
        raw = raw.split("```", 1)[0].strip()
    try:
        return json.loads(raw)
    except Exception:
        pass
    # Last-ditch: pull the outermost { ... } and try again
    match = re.search(r"\{[\s\S]*\}", raw)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            return None
    return None


def _format_chat_log(chat_log: list[dict], limit: int = 800) -> str:
    """Render chat messages as `[HH:MM] Name: body`. Older middle slices are
    trimmed for very long meetings so we stay under the input-token budget."""
    if not chat_log:
        return "(no chat activity)"
    msgs = list(chat_log)
    if len(msgs) > limit:
        head = msgs[: limit // 2]
        tail = msgs[-limit // 2 :]
        msgs = head + [{"time": "", "name": "system", "body": f"... ({len(chat_log) - limit} messages trimmed) ..."}] + tail
    lines = []
    for m in msgs:
        t = m.get("time") or m.get("timestamp") or ""
        name = m.get("name") or m.get("sender") or m.get("user") or "Unknown"
        body = m.get("body") or m.get("text") or m.get("content") or ""
        if not body:
            continue
        lines.append(f"[{t}] {name}: {body}")
    return "\n".join(lines) if lines else "(no chat activity)"


def _auto_table(result: dict):
    """Ensure `tables` is always exactly the 3 fixed types (task_tracker,
    resource_allocation, risk_matrix), in order, with fixed columns.

    Backfills any row list the model left out using data it already
    extracted elsewhere in the SAME response (action_items -> task_tracker,
    risks -> risk_matrix) — reusing already-grounded fields, never
    fabricating new content. Resource Allocation has no such source field
    in the schema, so a missing/empty result for it is left as an empty
    table (a correct, expected outcome when the meeting never discussed
    budget/staffing) rather than invented.

    `key_takeaways` (present on the transcript-summary schema, which has no
    `action_items`/`risks` fields at all) is a second fallback source for
    task_tracker, used only when action_items didn't already supply rows —
    the transcript prompt requires every takeaway to carry a real assignee,
    so a takeaway with both `text` and `assignee` is exactly as grounded as
    an action item and safe to reuse the same way.
    """
    by_type = {}
    existing = result.get("tables")
    if isinstance(existing, list):
        for t in existing:
            if isinstance(t, dict) and t.get("type"):
                by_type[t["type"]] = t

    items = result.get("action_items") or []
    risks = result.get("risks") or []
    takeaways = result.get("key_takeaways") or []
    task_tracker_rows = [
        {"task": i.get("task", ""), "assignee": i.get("owner", ""), "deadline": i.get("due", "")}
        for i in items if i.get("task")
    ] or [
        {"task": t.get("text", ""), "assignee": t.get("assignee", ""), "deadline": ""}
        for t in takeaways if t.get("text") and t.get("assignee")
    ]
    fallback_rows = {
        "task_tracker": task_tracker_rows,
        "resource_allocation": [],
        "risk_matrix": [
            {"risk": r.get("title", ""), "impact": r.get("severity", ""), "solution": r.get("rationale", "")}
            for r in risks if r.get("title")
        ],
    }

    tables = []
    for ttype, label, cols in _TABLE_DEFS:
        found = by_type.get(ttype)
        rows = found.get("rows") if isinstance(found, dict) and found.get("rows") else fallback_rows[ttype]
        columns = found.get("columns") if isinstance(found, dict) and found.get("columns") else cols
        tables.append({"type": ttype, "type_label": label, "columns": columns, "rows": rows})
    result["tables"] = tables


def _call_structured_ai(system: str, user_prompt: str, default_shape: dict, *, max_tokens: int = 1024) -> dict:
    """Shared "call Claude, expect JSON back" core — extracted here because
    ai_generate_agenda/_meeting_brief/_followup_tasks (Sema Calendar Phase 2
    slice 8) would otherwise each repeat the same client/timing/usage/
    JSON-merge boilerplate ai_generate_intelligence already has inline
    below. ai_generate_intelligence itself is left as-is rather than
    retrofitted onto this helper — it's shipped, tested, unrelated to this
    slice, and refactoring it isn't necessary to add the three new
    functions cleanly.

    Returns default_shape merged with whatever keys the model returned,
    plus _model/_input_tokens/_output_tokens/_latency_ms/_error metadata —
    same contract as ai_generate_intelligence, just factored out.
    """
    client = _get_client()
    started = time.monotonic()
    result = dict(default_shape)
    meta = {"_model": None, "_input_tokens": None, "_output_tokens": None, "_latency_ms": None, "_error": None}

    if not client:
        meta["_error"] = "Anthropic API key not configured."
        result.update(meta)
        return result

    settings = get_settings()
    try:
        response = client.messages.create(
            model=settings.ai_model, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": user_prompt}],
        )
        meta["_model"] = settings.ai_model
        usage = getattr(response, "usage", None)
        if usage is not None:
            meta["_input_tokens"] = getattr(usage, "input_tokens", None)
            meta["_output_tokens"] = getattr(usage, "output_tokens", None)
        text = response.content[0].text if response.content else ""
        parsed = _extract_json(text)
        if parsed is None:
            meta["_error"] = "Model did not return parseable JSON."
        else:
            base = dict(default_shape)
            for k, v in parsed.items():
                base[k] = v
            result = base
    except Exception as e:
        log.exception("AI structured call failed")
        meta["_error"] = f"AI request failed: {e}"

    meta["_latency_ms"] = int((time.monotonic() - started) * 1000)
    result.update(meta)
    return result


# ── Sema Calendar & Mail — agenda / brief / follow-up (Phase 2 slice 8) ─────
# Spec §13.1 Phase 2 AI workflow row. All three are pure generation — no DB
# access, no governance decisions here; app/connect/calendar_service/
# ai_workflows.py is what resolves autonomy, stages L2 proposals, and
# persists Task rows. Kept that way so this file stays "call Claude, get
# structured output back," matching the existing ai_generate_intelligence
# shape, not a second place governance logic could leak into.

def ai_generate_agenda(meeting_title: str, attendee_names: list[str], context_notes: str | None = None) -> dict:
    """{"agenda_items": [{"topic", "duration_minutes", "owner"}]} + metadata."""
    default = {"agenda_items": []}
    roster = ", ".join(attendee_names) if attendee_names else "(no attendees listed)"
    system = (
        "You are Zoiko Sema's meeting agenda assistant. Given a meeting title and "
        "attendees, propose a focused, time-boxed agenda in pure JSON.\n"
        "Rules: Output JSON ONLY, no prose, no markdown fences. Match the schema "
        "exactly. duration_minutes are integers summing to a reasonable total "
        "(<= 60 unless the title implies a longer session). owner is an attendee "
        "name from the roster or null if unclear."
    )
    user_prompt = (
        f"Meeting title: {meeting_title}\nAttendees: {roster}\n"
        + (f"Context notes: {context_notes}\n" if context_notes else "")
        + '\nSchema:\n{"agenda_items": [{"topic": "string", "duration_minutes": 0, "owner": "string or null"}]}\n'
        "Return the JSON object now."
    )
    return _call_structured_ai(system, user_prompt, default, max_tokens=800)


def ai_generate_meeting_brief(
    meeting_title: str, attendee_names: list[str], prior_meeting_titles: list[str] | None = None,
) -> dict:
    """{"summary", "key_points": [...], "suggested_talking_points": [...]} + metadata."""
    default = {"summary": "", "key_points": [], "suggested_talking_points": []}
    roster = ", ".join(attendee_names) if attendee_names else "(no attendees listed)"
    history = "\n".join(f"- {t}" for t in (prior_meeting_titles or [])) or "(no prior related meetings found)"
    system = (
        "You are Zoiko Sema's pre-meeting brief assistant. Given a meeting title, "
        "its attendees, and titles of prior related meetings with the same people, "
        "produce a short prep brief in pure JSON.\n"
        "Rules: Output JSON ONLY, no prose, no markdown fences. Match the schema "
        "exactly. Do not invent facts not implied by the titles given — if there's "
        "not enough signal, say so plainly in summary rather than fabricating detail."
    )
    user_prompt = (
        f"Meeting title: {meeting_title}\nAttendees: {roster}\n"
        f"Prior related meetings:\n{history}\n\n"
        '\nSchema:\n{"summary": "string", "key_points": ["string"], "suggested_talking_points": ["string"]}\n'
        "Return the JSON object now."
    )
    return _call_structured_ai(system, user_prompt, default, max_tokens=800)


def ai_generate_followup_tasks(meeting_title: str, context_notes: str) -> dict:
    """{"tasks": [{"title", "assignee_email", "priority"}]} + metadata.
    context_notes is caller-supplied free text (manual notes today; a
    natural future source is MeetingIntelligence's own summary once that
    integration exists — not built here, no real caller for it yet)."""
    default = {"tasks": []}
    system = (
        "You are Zoiko Sema's follow-up task assistant. Given a meeting title and "
        "notes from that meeting, extract concrete follow-up tasks in pure JSON.\n"
        "Rules: Output JSON ONLY, no prose, no markdown fences. Match the schema "
        "exactly. priority is one of low/med/high. assignee_email is an email "
        "address ONLY if the notes name one explicitly; otherwise null — never "
        "invent an email address."
    )
    user_prompt = (
        f"Meeting title: {meeting_title}\nNotes:\n{context_notes}\n\n"
        '\nSchema:\n{"tasks": [{"title": "string", "assignee_email": "string or null", "priority": "low|med|high"}]}\n'
        "Return the JSON object now."
    )
    return _call_structured_ai(system, user_prompt, default, max_tokens=800)


def ai_generate_intelligence(
    chat_log: list[dict],
    meeting_title: str = "Meeting",
    participants: list[dict] | None = None,
    duration_seconds: int | None = None,
    language: str = "english",
) -> dict:
    """Produce a structured meeting-intelligence payload.

    Supports both Anthropic Claude (default) and Groq (when AI_PROVIDER=groq).
    Returns a dict shaped like `_empty_intelligence()`, plus metadata keys
    `_model`, `_input_tokens`, `_output_tokens`, `_latency_ms`, `_error`.

    Failure modes are surfaced via `_error`; callers should still persist the
    row so the UI can show "generation failed — retry".
    """
    client = _get_ai_client()
    started = time.monotonic()
    result: dict = _empty_intelligence()
    meta = {
        "_model": None,
        "_input_tokens": None,
        "_output_tokens": None,
        "_latency_ms": None,
        "_error": None,
    }

    if not client:
        meta["_error"] = "AI API key not configured. Set ANTHROPIC_API_KEY (Claude) or AI_API_KEY (Groq)."
        result.update(meta)
        return result

    if not chat_log:
        meta["_error"] = "No chat or transcript content available to analyze."
        meta["_latency_ms"] = int((time.monotonic() - started) * 1000)
        result.update(meta)
        return result

    settings = get_settings()
    convo = _format_chat_log(chat_log)
    roster = ""
    if participants:
        roster = "Participants: " + ", ".join(
            f"{p.get('name','?')}" + (f" ({p.get('role')})" if p.get("role") else "")
            for p in participants[:50]
        )
    duration_line = ""
    if duration_seconds:
        mins = duration_seconds // 60
        duration_line = f"Meeting duration: ~{mins} minutes."

    system = (
        "You are Zoiko Sema's Meeting Intelligence Engine. Your job is to read a "
        "meeting transcript (chat log) and produce an executive-grade structured "
        "analysis in pure JSON.\n\n"
        "Rules:\n"
        "- Output JSON ONLY. No prose before or after. No markdown code fences.\n"
        "- Match the schema exactly. Use [] for empty arrays, null for unknown scalars.\n"
        "- Be specific: extract real owners, real deadlines, real decisions.\n"
        "  Never invent names that don't appear in the chat log.\n"
        "- Score fields are 0-100 integers; calibrate honestly.\n"
        "- Sentiment must be grounded in actual language — don't sugarcoat.\n"
        "- tldr should read like a McKinsey one-liner: what was decided, why it matters.\n"
        "- You MUST include \"tables\" in EVERY response: an array of EXACTLY 3 "
        "objects, always in this order, each with these FIXED columns (never "
        "rename, add, or remove columns):\n"
        "  1. task_tracker — columns: Task, Assignee, Deadline. Best for project tracking.\n"
        "  2. resource_allocation — columns: Team Member, Hours Allocated, Cost. Best for managers.\n"
        "  3. risk_matrix — columns: Project Risk, Impact, Solution. Best for stakeholders.\n"
        "- Populate each table's rows ONLY from things actually said in the chat log:\n"
        "  • task_tracker rows come from real action items with real owners/deadlines.\n"
        "  • resource_allocation rows require real names WITH real hours/cost/effort "
        "actually discussed — if the meeting never covered budget or staffing hours, "
        "leave its rows as an empty array. Do not estimate or invent numbers.\n"
        "  • risk_matrix rows come from real risks or concerns actually raised.\n"
        "- An empty rows array for a table is CORRECT and EXPECTED when the "
        "meeting didn't cover that topic — never fabricate rows just to fill a table.\n"
        "- Output ALL text fields (tldr, topics, decisions, action_items, risks, "
        "speakers, sentiment, follow_ups, contradictions, knowledge_nuggets, "
        "table labels and cell values) in the language specified. "
        "Preserve participant names and proper nouns as-is — only translate "
        "the analysis text itself.\n"
        "- Use the CORRECT script for the target language: for Chinese use "
        "Simplified Chinese characters (Hanzi), for Japanese use proper mix of "
        "Kanji, Hiragana and Katakana, for Arabic and Hebrew use their native "
        "right-to-left script, for Korean use Hangul, for Thai use Thai script, "
        "for Greek use Greek alphabet, for Russian/Ukrainian use Cyrillic.\n"
        f"- Language: {language}. ALL output text must be in {language}. "
        "If the language requested is 'chinese', output in Simplified Chinese. "
        "If 'japanese', output in Japanese (Kanji + Kana). "
        "Do NOT fall back to English. If you cannot fluently produce text in "
        "the requested language, output a clear statement in that language "
        "saying you cannot comply."
    )

    user_prompt = (
        f"Meeting title: {meeting_title}\n"
        f"{duration_line}\n"
        f"{roster}\n\n"
        f"Schema to follow:\n{_INTELLIGENCE_SCHEMA}\n\n"
        f"Chat log (oldest first):\n{convo}\n\n"
        "Return the JSON object now."
    )

    is_groq = settings.ai_provider == "groq"

    try:
        if is_groq:
            response = client.chat.completions.create(
                model=settings.ai_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=4096,
                response_format={"type": "json_object"},
            )
            meta["_model"] = settings.ai_model
            usage = getattr(response, "usage", None)
            if usage is not None:
                meta["_input_tokens"] = getattr(usage, "prompt_tokens", None)
                meta["_output_tokens"] = getattr(usage, "completion_tokens", None)
            text = response.choices[0].message.content if response.choices else ""
        else:
            response = client.messages.create(
                model=settings.ai_model,
                max_tokens=4096,
                system=system,
                messages=[{"role": "user", "content": user_prompt}],
            )
            meta["_model"] = settings.ai_model
            usage = getattr(response, "usage", None)
            if usage is not None:
                meta["_input_tokens"] = getattr(usage, "input_tokens", None)
                meta["_output_tokens"] = getattr(usage, "output_tokens", None)
            text = response.content[0].text if response.content else ""

        parsed = _extract_json(text)
        if parsed is None:
            meta["_error"] = "Model did not return parseable JSON."
        else:
            base = _empty_intelligence()
            for k, v in parsed.items():
                base[k] = v
            _auto_table(base)
            result = base
    except Exception as e:
        log.exception("ai_generate_intelligence failed")
        meta["_error"] = f"AI request failed: {e}"

    meta["_latency_ms"] = int((time.monotonic() - started) * 1000)
    result.update(meta)
    return result


# ── Post-meeting transcript summarizer (Groq) ───────────────────────────────
# Separate vendor from the Anthropic-based functions above, used specifically
# for turning the in-meeting SPOKEN transcript (captured client-side via the
# caption pipeline, never the text chat log) into a short recap once a
# meeting ends. Kept in this module rather than a new file since it's the
# same "lazy client + prompt + JSON-parse" shape as ai_generate_intelligence.

def _groq_api_key(settings) -> str:
    """Generic AI_API_KEY (when AI_PROVIDER=groq) wins, since that's the name
    the deploy env actually sets; GROQ_API_KEY is the vendor-specific
    fallback for anyone who configures it that way instead."""
    if settings.ai_provider == "groq" and settings.ai_api_key:
        return settings.ai_api_key
    return settings.groq_api_key


def _groq_model(settings) -> str:
    """Same precedence as _groq_api_key: generic AI_MODEL wins when
    AI_PROVIDER=groq, else the GROQ_MODEL default."""
    if settings.ai_provider == "groq" and settings.ai_model:
        return settings.ai_model
    return settings.groq_model


def _get_groq_client():
    """Lazy-import groq to avoid startup crash if not installed."""
    try:
        import groq
        settings = get_settings()
        key = _groq_api_key(settings)
        if not key:
            return None
        return groq.Groq(api_key=key)
    except ImportError:
        log.warning("groq package not installed — transcript summarizer disabled")
        return None


def _get_ai_client():
    """Return the appropriate AI client based on ai_provider setting.
    
    Supports both Anthropic Claude (default) and Groq (when AI_PROVIDER=groq).
    Returns None if the provider's API key is not configured.
    """
    settings = get_settings()
    if settings.ai_provider == "groq":
        return _get_groq_client()
    return _get_client()


def _empty_transcript_summary() -> dict:
    """Default-shaped transcript summary. Returned when there's nothing
    meaningful to summarize so the UI can always render the same structure."""
    return {
        "title": "", "summary": "", "key_takeaways": [],
        "tables": _empty_tables(),
    }


def groq_summarize_transcript(transcript: list[dict], meeting_title: str = "Meeting", language: str = "english") -> dict:
    """Summarize a spoken-conversation transcript into {title, summary,
    key_takeaways} using Groq.

    `transcript` is the same {time, name, body}-shaped list `_format_chat_log`
    already reads (with timestamp/sender/user/text/content fallback keys) —
    the client builds it from the accumulated caption transcript, not chat.

    Returns a dict shaped like `_empty_transcript_summary()`, plus metadata
    keys `_model`, `_input_tokens`, `_output_tokens`, `_latency_ms`, `_error`
    — mirrors `ai_generate_intelligence`'s error-surfacing convention so
    callers/UI handle both the same way.
    """
    client = _get_groq_client()
    started = time.monotonic()
    result = _empty_transcript_summary()
    meta = {
        "_model": None,
        "_input_tokens": None,
        "_output_tokens": None,
        "_latency_ms": None,
        "_error": None,
    }

    if not client:
        meta["_error"] = "Groq API key not configured."
        result.update(meta)
        return result

    if not transcript:
        meta["_error"] = "No transcript content available to summarize."
        meta["_latency_ms"] = int((time.monotonic() - started) * 1000)
        result.update(meta)
        return result

    settings = get_settings()
    convo = _format_chat_log(transcript)

    system = (
        "You are ZoikoSema's post-meeting summarizer. Read a meeting's spoken "
        "conversation transcript and produce a concise recap in pure JSON.\n\n"
        "Rules:\n"
        "- Output JSON ONLY. No prose before or after. No markdown code fences.\n"
        '- Schema: {"title": string, "summary": string, "key_takeaways": '
        '[{"assignee": string|null, "text": string}], '
        '"tables": [{"type": string, "type_label": string, '
        '"columns": [{"key": string, "label": string}], "rows": [dict]}]}\n'
        '- "title" is a short (under ~8 words) headline for what this meeting '
        "was about.\n"
        '- "summary" is 2-4 sentences covering what was discussed and decided.\n'
        '- "key_takeaways" must capture contributions FROM EVERY SPEAKER '
        "mentioned in the transcript. Every single takeaway MUST include an "
        '"assignee" — set it to the speaker who raised or owns that point '
        "(exactly as their name appears in the transcript). Never use null "
        "for assignee; assign every takeaway to a specific person.\n"
        "- IMPORTANT: Identify ALL participants mentioned in the conversation "
        "and ensure each one appears in at least one key takeaway if they "
        "contributed substantively. Do not omit any speaker.\n"
        "- Never invent names, tasks, or decisions that don't appear in the "
        "transcript. If nothing substantive was discussed, say so plainly in "
        '"summary" and return an empty "key_takeaways" array.\n'
        "- You MUST include \"tables\" in EVERY response: an array of EXACTLY 3 "
        "objects, always in this order, each with these FIXED columns (never "
        "rename, add, or remove columns):\n"
        "  1. task_tracker — columns: Task, Assignee, Deadline. Best for project tracking.\n"
        "  2. resource_allocation — columns: Team Member, Hours Allocated, Cost. Best for managers.\n"
        "  3. risk_matrix — columns: Project Risk, Impact, Solution. Best for stakeholders.\n"
        "- Populate each table's rows ONLY from things actually said in the transcript:\n"
        "  • task_tracker rows come from real action items with real owners/deadlines.\n"
        "  • resource_allocation rows require real names WITH real hours/cost/effort "
        "actually discussed — if the conversation never covered budget or staffing "
        "hours, leave its rows as an empty array. Do not estimate or invent numbers.\n"
        "  • risk_matrix rows come from real risks or concerns actually raised.\n"
        "- An empty rows array for a table is CORRECT and EXPECTED when the "
        "conversation didn't cover that topic — never fabricate rows just to fill a table.\n"
        f"- Language: {language}. ALL output text (title, summary, key_takeaways "
        "text, table labels and cell values) must be in {language}. "
        "Preserve participant names and proper nouns as-is — only translate "
        "the analysis content.\n"
        "- Use the CORRECT script: for Chinese use Simplified Chinese characters "
        "(Hanzi), for Japanese use Kanji+Hiragana+Katakana, for Korean use Hangul, "
        "for Arabic/Hebrew use native right-to-left script, for Thai use Thai script, "
        "for Greek use Greek alphabet, for Cyrillic languages use Cyrillic.\n"
        "If the language requested is 'chinese', output in Simplified Chinese. "
        "If 'japanese', output in Japanese (Kanji + Kana). "
        "Do NOT fall back to English. If you cannot produce text in the requested "
        "language, output a clear statement in that language saying so."
    )
    user_prompt = (
        f"Meeting title: {meeting_title}\n\n"
        f"Transcript (oldest first):\n{convo}\n\n"
        "Return the JSON object now."
    )

    model = _groq_model(settings)
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            # 1024 was tight enough that a meeting with several speakers (each
            # requiring an assignee-tagged key takeaway) could burn the whole
            # budget before ever reaching the tables section, leaving
            # task_tracker/risk_matrix empty even when the transcript had
            # clearly actionable content. 2048 gives both room to complete.
            max_tokens=2048,
            response_format={"type": "json_object"},
        )
        meta["_model"] = model
        usage = getattr(response, "usage", None)
        if usage is not None:
            meta["_input_tokens"] = getattr(usage, "prompt_tokens", None)
            meta["_output_tokens"] = getattr(usage, "completion_tokens", None)
        text = response.choices[0].message.content if response.choices else ""
        parsed = _extract_json(text)
        if parsed is None:
            meta["_error"] = "Model did not return parseable JSON."
        else:
            base = _empty_transcript_summary()
            for k in base:
                if k in parsed:
                    base[k] = parsed[k]
            _auto_table(base)
            result = base
    except Exception as e:
        log.exception("groq_summarize_transcript failed")
        meta["_error"] = f"AI request failed: {e}"

    meta["_latency_ms"] = int((time.monotonic() - started) * 1000)
    result.update(meta)
    return result
