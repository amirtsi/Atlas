"""Owner-message intent detection for the WhatsApp loop.

Decides whether an inbound owner message is a QUESTION (answer it from real data),
a LOG (hand to the activity classifier), or OTHER (empty/unusable). Bias: only
"question" when the text clearly reads as one — a "?" or a standalone question
word. Everything else is "log", so the activity classifier stays the authority on
whether a message maps to a module.
"""
import re

# "?" anywhere, an English question word, or a Hebrew question word as a whole
# token (Hebrew has no \b, so we anchor on start/space/"?" to avoid matching a
# question word *inside* another word — e.g. "מתי" inside "סיימתי").
_QUESTION_RE = re.compile(
    r"\?"
    r"|\b(what|how|why|when|which|who|where)\b"
    r"|(?:^|\s)(מה|איך|למה|מתי|כמה|האם|איפה|מי)(?:\s|\?|$)",
    re.IGNORECASE,
)


def classify_intent(text: str) -> str:
    stripped = (text or "").strip()
    if not stripped:
        return "other"
    if _QUESTION_RE.search(stripped):
        return "question"
    return "log"
