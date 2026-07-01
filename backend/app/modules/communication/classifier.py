"""Honest WhatsApp message classification.

Turns a free-text WhatsApp message from the owner into a real activity — but only
when the signal is unambiguous. The default classifier is keyword-rule based and
needs no credentials. When ``ATLAS_ANTHROPIC_API_KEY`` is configured the Claude
adapter is consulted first (minimal payload: the message plus the user's own
module names — never the ledger), with the rule classifier as the fallback.

Nothing is ever fabricated: a message that doesn't clearly map to one existing
module creates no activity and gets one clarification question. We never invent a
module — classification only ever points at a module the user already has.
"""
from __future__ import annotations

import json
import re
from sqlite3 import Connection
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import Settings, get_settings
from app.core.database import rows_to_dicts

# Keyword hints per module *type* (Hebrew + English). These only ever map a
# message onto a module the user already has.
TYPE_KEYWORDS: dict[str, list[str]] = {
    "recovery": [
        "physio", "physiotherapy", "rehab", "recovery", "stretch", "mobility",
        "פיזיו", "פיזיותרפיה", "שיקום", "התאוששות", "מתיחות", "כאב",
    ],
    "learning": [
        "study", "studied", "learn", "learning", "course", "lab", "machine",
        "lecture", "oscp", "למדתי", "למידה", "לימוד", "קורס", "מכונה", "תרגול",
    ],
    "habit": [
        "gym", "workout", "train", "training", "run", "ran", "running", "lift",
        "אימון", "התאמנתי", "כושר", "ריצה", "חדר כושר",
    ],
    "project": [
        "bug", "commit", "code", "coded", "deploy", "deployed", "feature",
        "task", "fixed", "ticket", "pr", "באג", "קוד", "פיתוח", "משימה", "תיקנתי",
    ],
    "relationship": [
        "date", "quality time", "partner", "girlfriend", "boyfriend", "wife",
        "husband", "זוגיות", "זמן איכות", "בן זוג", "בת זוג", "דייט", "אשתי", "בעלי",
    ],
}

_DURATION_RE = re.compile(
    r"(\d{1,3})\s*(hours?|hrs?|h|minutes?|mins?|m|שעות|שעה|דקות|דקה|דק[׳']?)",
    re.IGNORECASE,
)


def parse_duration_minutes(text: str) -> int | None:
    """Extract a duration like ``30 דקות`` / ``45 min`` / ``1h`` -> minutes."""
    match = _DURATION_RE.search(text)
    if not match:
        return None
    amount = int(match.group(1))
    unit = match.group(2).lower()
    if unit.startswith("h") or unit.startswith("ש"):  # hours / שעה / שעות
        return amount * 60
    return amount


def _clean_title(text: str, max_length: int = 80) -> str:
    title = " ".join(text.strip().split())
    return title[:max_length] if title else "WhatsApp activity"


def _activity_type_for(module_type: str) -> str:
    # Mirror the in-app loggers: learning logs "study", everything else logs by type.
    return "study" if module_type == "learning" else module_type


def load_active_modules(conn: Connection) -> list[dict]:
    return rows_to_dicts(
        conn.execute(
            "SELECT id, slug, name, type, discipline_id FROM life_modules WHERE status = 'active'"
        ).fetchall()
    )


def _module_keywords(module: dict) -> list[str]:
    keywords = [str(module["slug"]).lower(), str(module["name"]).lower()]
    keywords.extend(TYPE_KEYWORDS.get(module["type"], []))
    return [keyword for keyword in keywords if keyword]


def rule_match(modules: list[dict], text: str) -> dict | None:
    """Score modules by keyword hits. Return the single clear winner, else None."""
    lowered = text.lower()
    scored: list[tuple[int, dict]] = []
    for module in modules:
        score = sum(1 for keyword in _module_keywords(module) if keyword in lowered)
        if score:
            scored.append((score, module))
    if not scored:
        return None
    scored.sort(key=lambda item: item[0], reverse=True)
    # A tie between the top two modules is ambiguous — do not guess.
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        return None
    return {"module": scored[0][1], "confidence": 0.8, "method": "rules"}


def classify_message(conn: Connection, provider: dict, text: str) -> dict:
    """Classify one inbound message. Always returns a result dict with a reply."""
    modules = load_active_modules(conn)
    settings = get_settings()

    result = _llm_match(text, modules, settings) or rule_match(modules, text)
    if result is None:
        return {
            "matched": False,
            "module_id": None,
            "module_name": None,
            "discipline_id": None,
            "activity_type": None,
            "title": None,
            "duration_minutes": None,
            "confidence": 0.0,
            "method": "rules",
            "reply_text": _clarification_reply(),
        }

    module = result["module"]
    duration = parse_duration_minutes(text)
    return {
        "matched": True,
        "module_id": module["id"],
        "module_name": module["name"],
        "discipline_id": module["discipline_id"],
        "activity_type": _activity_type_for(module["type"]),
        "title": _clean_title(text),
        "duration_minutes": duration,
        "confidence": result["confidence"],
        "method": result["method"],
        "reply_text": _confirmation_reply(module["name"], duration),
    }


def _confirmation_reply(module_name: str, duration: int | None) -> str:
    suffix = f" ({duration} דק׳)" if duration else ""
    return f"✅ נרשם ב{module_name}{suffix}. אטלס עדכן את היומן."


def _clarification_reply() -> str:
    return (
        "לא הצלחתי לקשר את ההודעה למודול מסוים, אז לא רשמתי כלום. "
        'אפשר לציין את התחום — למשל: "פיזיותרפיה 30 דקות" או "OSCP 45 דקות".'
    )


# --------------------------------------------------------------------------- #
# Optional Claude adapter. Inactive until ATLAS_ANTHROPIC_API_KEY is set.
# Minimal payload: the message + the user's module names. Never the ledger.
# --------------------------------------------------------------------------- #
def _llm_match(text: str, modules: list[dict], settings: Settings) -> dict | None:
    api_key = (settings.anthropic_api_key or "").strip()
    if not api_key or not modules:
        return None

    catalog = "\n".join(f"- {module['slug']}: {module['name']} ({module['type']})" for module in modules)
    system = (
        "You classify a single WhatsApp message from a user into exactly one of "
        "their life modules, or none if it is ambiguous. Reply with ONLY a JSON "
        'object: {"module_slug": string|null, "confidence": number between 0 and 1}. '
        "module_slug must be one of the provided slugs or null. Never invent a slug."
    )
    user = f"Modules:\n{catalog}\n\nMessage: {text!r}"

    raw = _anthropic_text(api_key, settings.classification_model, system, user)
    if not raw:
        return None
    try:
        data = json.loads(_extract_json(raw))
    except (ValueError, TypeError):
        return None

    slug = data.get("module_slug")
    try:
        confidence = float(data.get("confidence") or 0)
    except (ValueError, TypeError):
        confidence = 0.0
    if not slug or confidence < 0.5:
        return None
    module = {module["slug"]: module for module in modules}.get(slug)
    if module is None:
        return None
    return {"module": module, "confidence": confidence, "method": "llm"}


def _anthropic_text(api_key: str, model: str, system: str, user: str) -> str | None:
    body = json.dumps(
        {
            "model": model,
            "max_tokens": 200,
            "system": system,
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


def _extract_json(raw: str) -> str:
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end < start:
        return raw
    return raw[start : end + 1]
