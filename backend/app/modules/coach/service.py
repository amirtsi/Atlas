"""Answers an owner question from their real logged data.

Read-only: builds the real-data context pack, then asks the Anthropic adapter to
answer using ONLY that data. Any failure (no key, network error) returns a
graceful, honest fallback — never a fabricated answer.
"""
from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import get_settings
from app.modules.coach.context import build_context

_NO_KEY_REPLY = (
    "אני יכול לרשום פעולות, אבל כדי לענות על שאלות צריך מפתח AI מוגדר "
    "(ATLAS_ANTHROPIC_API_KEY)."
)
_ERROR_REPLY = "לא הצלחתי לענות כרגע. נסה שוב עוד רגע."

_SYSTEM = (
    "You are Atlas, a personal life-OS. Answer the user's question using ONLY the "
    "JSON data provided, which is their real logged activity. Quote the real numbers "
    "from the data. If the data does not contain the answer, say you don't have it "
    "logged yet — never invent activities, modules, or numbers. Reply in the user's "
    "language (Hebrew or English), 1-3 short sentences."
)


def answer_question(text: str) -> dict:
    settings = get_settings()
    api_key = (settings.anthropic_api_key or "").strip()
    if not api_key:
        return {"answer": _NO_KEY_REPLY, "grounded": False, "method": "no_key"}

    context = build_context(text)
    answer = _llm_answer(api_key, settings.coach_model, context, text)
    if not answer:
        return {"answer": _ERROR_REPLY, "grounded": False, "method": "error"}
    return {"answer": answer.strip(), "grounded": True, "method": "llm"}


def _llm_answer(api_key: str, model: str, context: dict, question: str) -> str | None:
    user = f"DATA:\n{json.dumps(context, ensure_ascii=False)}\n\nQUESTION: {question}"
    body = json.dumps(
        {
            "model": model,
            "max_tokens": 400,
            "system": _SYSTEM,
            "messages": [{"role": "user", "content": user}],
        }
    ).encode("utf-8")
    request = Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8") or "{}")
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None
    for block in payload.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text":
            return block.get("text")
    return None
