import logging

from app.connect.sema_guide.knowledge_sources import query_all_sources

log = logging.getLogger(__name__)


class ContextPackage:
    context_text: str = ""
    sources: list[dict] = []
    permission_denied: list[str] = []


def build_context(
    question: str,
    user_context: dict,
    max_tokens: int = 2000,
) -> ContextPackage:
    pkg = ContextPackage()

    docs = query_all_sources(question, user_context, max_results=5)

    context_parts = []
    for doc in docs:
        context_parts.append(f"[{doc.source_label}] {doc.content}")
        pkg.sources.append({
            "label": doc.source_label,
            "url": doc.source_url,
            "title": doc.title,
            "relevance": doc.relevance_score,
        })

    if context_parts:
        pkg.context_text = "\n\n".join(context_parts)

    return pkg
