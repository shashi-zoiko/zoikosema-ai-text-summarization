import logging
from typing import Protocol

log = logging.getLogger(__name__)


class KnowledgeDocument:
    title: str
    content: str
    source_url: str | None
    source_label: str
    relevance_score: float


class KnowledgeSource(Protocol):
    def query(self, question: str, user_context: dict) -> list[KnowledgeDocument]:
        ...


_HELP_CENTER_ARTICLES = [
    {
        "title": "Joining a meeting",
        "content": "Users can join meetings via the Meetings tab or an invite link. Enter the meeting code or click the link. No account required for guest join. Hosts must start the meeting before participants can join.",
        "source_url": "https://www.zoikosema.com/help-center",
    },
    {
        "title": "Microphone not working",
        "content": "Check OS microphone permissions for Zoiko Sema. In the app, select the correct mic from the audio settings dropdown. Test mic in a private meeting. If using Bluetooth, disconnect and reconnect.",
        "source_url": "https://www.zoikosema.com/help-center",
    },
    {
        "title": "Camera not working",
        "content": "Ensure camera permissions are granted to Zoiko Sema in your OS settings. Close other apps using the camera. Select the correct camera in video settings. Restart the app if the issue persists.",
        "source_url": "https://www.zoikosema.com/help-center",
    },
    {
        "title": "Plans and pricing",
        "content": "All prices are in US dollars (USD). Free plan includes unlimited 1-on-1 meetings (40-min limit on group meetings), up to 10 participants. Pro is $14/month and removes time limits, adds cloud recording and up to 100 participants. Business is $24/month and adds admin controls, SSO, and up to 300 participants. Enterprise uses custom pricing and is not self-serve — to get Enterprise you Request a Demo (not a Help Center article). Enterprise adds custom seat limits, dedicated support, advanced security controls, and admin controls.",
        "source_url": "https://www.zoikosema.com/pricing",
    },
    {
        "title": "Recording meetings",
        "content": "Recording is available on Pro and higher plans. Host can start/stop recording from the meeting controls. Recordings are saved to the cloud and accessible from the Recordings tab. Participants are notified when recording is active.",
        "source_url": "https://www.zoikosema.com/help-center",
    },
    {
        "title": "Screen sharing",
        "content": "Share your entire screen, a specific window, or a browser tab. Presenter can switch sharing sources during the meeting. Optimize for video or text content. Available on all plans.",
        "source_url": "https://www.zoikosema.com/help-center",
    },
    {
        "title": "Inviting participants",
        "content": "Copy the meeting invite link from the meeting window or share the meeting code. Invites can be sent via email, chat, or calendar integration. Workspace members can be added directly from the directory.",
        "source_url": "https://www.zoikosema.com/help-center",
    },
    {
        "title": "Workspace administration",
        "content": "Admins can manage users, set security policies, configure SSO, and view usage analytics from the Admin panel. Role-based access: Owner, Admin, Member, and Guest roles available.",
        "source_url": "https://www.zoikosema.com/help-center",
    },
    {
        "title": "Audio/video diagnostics",
        "content": "Run a pre-meeting device check from Settings > Audio & Video. Test speaker, microphone, and camera. View signal strength and network quality indicators during meetings.",
        "source_url": "https://www.zoikosema.com/help-center",
    },
    {
        "title": "Meeting chat and reactions",
        "content": "Use in-meeting chat for text communication. Send emoji reactions, raise hand, or use live captions. Chat is saved with the recording for Pro plans.",
        "source_url": "https://www.zoikosema.com/help-center",
    },
]

_PRODUCT_DOC_ARTICLES = [
    {
        "title": "Sema Guide — AI assistant",
        "content": "Sema Guide is Zoiko's AI support agent integrated into the platform. It answers product questions, troubleshoots common issues, and can request human handoff when needed. It has access to workspace policy, account context, and conversation history. Meeting content is never accessed unless explicitly authorized.",
        "source_url": "https://meet.zoikosema.com/login",
    },
    {
        "title": "Confidential Mode",
        "content": "When enabled during a meeting, Confidential Mode restricts Sema Guide to shell-only access. Meeting audio, video, chat, and screen content are isolated. No AI processing of meeting content occurs. Participants see a visible indicator when Confidential Mode is active.",
        "source_url": "https://www.zoikosema.com/products",
    },
    {
        "title": "Privacy and data handling",
        "content": "Conversation messages are retained for 30 days after the last message. Security records may be kept up to 12 months. Processing occurs in European data centers. Users can download, delete, or request portability of their data at any time from the Privacy & Data panel.",
        "source_url": "https://www.zoikosema.com/products",
    },
    {
        "title": "Action execution",
        "content": "Sema Guide can propose workspace actions based on user requests. Consequential changes require explicit user confirmation. The action preview card shows the target, current value, proposed change, people affected, and reversibility. Users can confirm, edit, or cancel proposed actions.",
        "source_url": "https://www.zoikosema.com/products",
    },
    {
        "title": "Handoff to human support",
        "content": "Users can request a human specialist from the overflow menu or by asking Sema Guide. When requested, the session enters a queue and a specialist is assigned. Estimated wait time is shown. The user retains the ability to send messages during the queue.",
        "source_url": "https://www.zoikosema.com/products",
    },
]


_SKIP_WORDS = {"the", "a", "an", "is", "are", "was", "were", "be", "been",
               "being", "have", "has", "had", "do", "does", "did", "will",
               "would", "could", "should", "may", "might", "can", "shall",
               "to", "of", "in", "for", "on", "with", "at", "by", "from",
               "as", "into", "through", "during", "before", "after", "about",
               "between", "under", "over", "out", "off", "up", "down", "and",
               "or", "but", "nor", "not", "so", "yet", "if", "then", "than",
               "also", "just", "very", "too", "how", "what", "why", "when",
               "where", "which", "who", "whom", "this", "that", "these",
               "those", "i", "you", "he", "she", "it", "we", "they", "me",
               "my", "your", "his", "her", "its", "our", "their", "mine",
               "yours", "hers", "its", "ours", "theirs", "&", "check"}


def _score_article(question: str, title: str, content: str) -> float:
    q_words = [w for w in question.lower().split() if w not in _SKIP_WORDS and len(w) > 2]
    if not q_words:
        return 0
    score = 0
    title_lower = title.lower()
    content_lower = content.lower()
    matched_keywords = 0
    for kw in q_words:
        kw_match = False
        if kw in title_lower:
            score += 3
            kw_match = True
        if kw in content_lower:
            score += 1
            kw_match = True
        if kw_match:
            matched_keywords += 1
    if matched_keywords < 2:
        return 0
    return score + matched_keywords


class HelpCenterSource:
    def query(self, question: str, user_context: dict) -> list[KnowledgeDocument]:
        scored = []
        for article in _HELP_CENTER_ARTICLES:
            score = _score_article(question, article["title"], article["content"])
            if score > 0:
                doc = KnowledgeDocument()
                doc.title = article["title"]
                doc.content = article["content"]
                doc.source_url = article["source_url"]
                doc.source_label = "Help Center"
                doc.relevance_score = score
                scored.append(doc)
        scored.sort(key=lambda d: d.relevance_score, reverse=True)
        return scored[:3]


class ProductDocSource:
    def query(self, question: str, user_context: dict) -> list[KnowledgeDocument]:
        scored = []
        for article in _PRODUCT_DOC_ARTICLES:
            score = _score_article(question, article["title"], article["content"])
            if score > 0:
                doc = KnowledgeDocument()
                doc.title = article["title"]
                doc.content = article["content"]
                doc.source_url = article["source_url"]
                doc.source_label = "Product Documentation"
                doc.relevance_score = score
                scored.append(doc)
        scored.sort(key=lambda d: d.relevance_score, reverse=True)
        return scored[:3]


_knowledge_sources: list[KnowledgeSource] = []


def register_source(source: KnowledgeSource):
    _knowledge_sources.append(source)


def query_all_sources(question: str, user_context: dict, max_results: int = 3) -> list[KnowledgeDocument]:
    results: list[KnowledgeDocument] = []
    for source in _knowledge_sources:
        try:
            docs = source.query(question, user_context)
            results.extend(docs)
        except Exception:
            log.exception("Knowledge source query failed")
    results.sort(key=lambda d: d.relevance_score, reverse=True)
    return results[:max_results]


register_source(HelpCenterSource())
register_source(ProductDocSource())
