# WhatsApp Q&A Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner ask Atlas questions over WhatsApp and get answers grounded in real logged data.

**Architecture:** Add an intent step to the existing Evolution webhook. A *question* routes to a small, read-only `coach` service that builds a real-data context pack from the service layer and asks Atlas's existing Anthropic adapter to answer from that data only. A *log* message keeps the existing classify→log→reply path unchanged.

**Tech Stack:** Python 3.12, FastAPI, SQLite, stdlib `urllib` for the Anthropic call, pytest + FastAPI `TestClient`.

## Global Constraints

- Python `>=3.12`; no new runtime dependencies (use stdlib `urllib`, like the existing classifier).
- **Honest core:** the question path is read-only and must never fabricate. Answers derive only from the supplied real data; when the data lacks the answer, say "not logged." On any LLM failure, reply gracefully — never a made-up answer.
- Reuse the existing Evolution pipe, service layer, `_send_and_store_reply`, and audit trail. Do not add a WhatsApp bridge or a second number.
- Reuse `ATLAS_ANTHROPIC_API_KEY`; with no key, logging still works and questions return a graceful fallback.
- All new/changed code must pass `ruff check app tests` and the full `pytest` suite. Run commands from the `backend/` directory; the venv Python is `.venv/bin/python`.
- Tests use the central per-test temp DB (`tests/conftest.py`) — never touch the dev DB.

---

### Task 1: Intent classifier

**Files:**
- Create: `backend/app/modules/communication/intent.py`
- Test: `backend/tests/test_intent.py`

**Interfaces:**
- Produces: `classify_intent(text: str) -> str` returning `"question"`, `"log"`, or `"other"`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_intent.py`:

```python
from app.modules.communication.intent import classify_intent


def test_english_question():
    assert classify_intent("what did I do this week?") == "question"


def test_hebrew_question():
    assert classify_intent("כמה זמן התאמנתי השבוע?") == "question"


def test_plain_log_is_not_a_question():
    assert classify_intent("עשיתי פיזיותרפיה 30 דקות") == "log"


def test_hebrew_word_containing_question_substring_is_log():
    # "סיימתי" contains the substring "מתי" (when) but is not a question.
    assert classify_intent("סיימתי") == "log"


def test_empty_is_other():
    assert classify_intent("   ") == "other"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_intent.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.modules.communication.intent'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/modules/communication/intent.py`:

```python
"""Owner-message intent detection for the WhatsApp loop.

Decides whether an inbound owner message is a QUESTION (answer it from real data),
a LOG (hand to the activity classifier), or OTHER (empty/unusable). Bias: only
"question" when the text clearly reads as one — a "?" or a standalone question
word. Everything else is "log", so the activity classifier stays the authority on
whether a message maps to a module.
"""
from __future__ import annotations

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_intent.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/communication/intent.py backend/tests/test_intent.py
git commit -m "feat(coach): add WhatsApp message intent classifier"
```

---

### Task 2: Coach context builder

**Files:**
- Create: `backend/app/modules/coach/__init__.py`
- Create: `backend/app/modules/coach/context.py`
- Test: `backend/tests/test_coach_context.py`

**Interfaces:**
- Consumes: `app.modules.dashboard.service.get_today_dashboard() -> dict` (existing; returns `real_signals`, `active_modules` with `behavior.summary`, `recent_activities`, `weekly_balance`).
- Produces: `build_context(text: str) -> dict` with keys `signals`, `weekly_balance`, `active_modules`, `recent_activities`, `focus_module`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_coach_context.py`:

```python
from fastapi.testclient import TestClient

from app.main import app
from app.modules.coach.context import build_context


def test_context_carries_real_numbers_and_focus_module():
    with TestClient(app) as client:
        modules = {m["slug"]: m for m in client.get("/api/v1/modules").json()}
        oscp = modules["oscp"]
        created = client.post(
            "/api/v1/activities",
            json={
                "module_id": oscp["id"],
                "activity_type": "study",
                "title": "OSCP AD enumeration",
                "duration_minutes": 45,
            },
        )
        assert created.status_code == 201, created.text

        context = build_context("how is oscp going this week?")

    assert context["signals"]["week_activity_count"] >= 1
    assert any(m["name"] == "OSCP" for m in context["active_modules"])
    assert context["focus_module"] is not None
    assert context["focus_module"]["name"] == "OSCP"


def test_context_has_no_focus_module_when_none_named():
    with TestClient(app) as client:
        context = build_context("what did I do today?")
    assert context["focus_module"] is None
    assert "signals" in context
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_coach_context.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.modules.coach'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/modules/coach/__init__.py` (empty file):

```python
```

Create `backend/app/modules/coach/context.py`:

```python
"""Builds a compact, read-only pack of the owner's REAL logged data for the coach.

Composes the existing dashboard service (signals + active modules with behavior +
recent activities + weekly balance) and, when the question names an active module,
flags it as the focus. Pure read + shape — no LLM, no writes. The dashboard
service opens its own connection; WAL mode makes that safe alongside the webhook.
"""
from __future__ import annotations

from app.modules.dashboard.service import get_today_dashboard


def _find_focus_module(text: str, modules: list[dict]) -> dict | None:
    lowered = text.lower()
    for module in modules:
        name = str(module.get("name") or "").lower()
        if name and name in lowered:
            return module
    return None


def build_context(text: str) -> dict:
    dashboard = get_today_dashboard()

    active_modules = [
        {
            "name": module.get("name"),
            "type": module.get("type"),
            "status": module.get("status"),
            "summary": (module.get("behavior") or {}).get("summary") or {},
        }
        for module in (dashboard.get("active_modules") or [])
    ]
    recent_activities = [
        {
            "title": activity.get("title"),
            "occurred_at": activity.get("occurred_at"),
            "duration_minutes": activity.get("duration_minutes"),
            "module": activity.get("module_name"),
        }
        for activity in (dashboard.get("recent_activities") or [])
    ]
    weekly_balance = [
        {
            "discipline": item.get("discipline_name"),
            "activity_count": item.get("activity_count"),
            "duration_minutes": item.get("duration_minutes"),
        }
        for item in (dashboard.get("weekly_balance") or [])
    ]

    return {
        "signals": dashboard.get("real_signals") or {},
        "weekly_balance": weekly_balance,
        "active_modules": active_modules,
        "recent_activities": recent_activities,
        "focus_module": _find_focus_module(text, active_modules),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_coach_context.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/coach/__init__.py backend/app/modules/coach/context.py backend/tests/test_coach_context.py
git commit -m "feat(coach): add read-only real-data context builder"
```

---

### Task 3: Coach service (config + answer)

**Files:**
- Modify: `backend/app/core/config.py` (add `coach_enabled`, `coach_model`)
- Create: `backend/app/modules/coach/service.py`
- Test: `backend/tests/test_coach_service.py`

**Interfaces:**
- Consumes: `build_context(text) -> dict` (Task 2); `app.core.config.get_settings()` with new fields `coach_enabled: bool` and `coach_model: str`, plus existing `anthropic_api_key`.
- Produces: `answer_question(text: str) -> dict` with `{"answer": str, "grounded": bool, "method": str}` where `method` is one of `"no_key"`, `"error"`, `"llm"`. Also `_llm_answer(api_key, model, context, question) -> str | None` (module-level, so tests can monkeypatch it).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_coach_service.py`:

```python
from app.core.config import get_settings
from app.modules.coach import service


def test_no_api_key_returns_honest_fallback(monkeypatch):
    monkeypatch.delenv("ATLAS_ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()
    result = service.answer_question("what did I do this week?")
    assert result["method"] == "no_key"
    assert result["grounded"] is False
    assert result["answer"]  # non-empty graceful message


def test_llm_error_returns_honest_fallback(monkeypatch):
    monkeypatch.setenv("ATLAS_ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()
    monkeypatch.setattr(service, "build_context", lambda text: {"signals": {}})
    monkeypatch.setattr(service, "_llm_answer", lambda *a, **k: None)
    result = service.answer_question("how is oscp?")
    assert result["method"] == "error"
    assert result["grounded"] is False


def test_grounded_answer_uses_llm(monkeypatch):
    monkeypatch.setenv("ATLAS_ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()
    monkeypatch.setattr(service, "build_context", lambda text: {"signals": {"week_activity_count": 3}})
    monkeypatch.setattr(service, "_llm_answer", lambda *a, **k: "You logged 3 activities this week.")
    result = service.answer_question("what did I do this week?")
    assert result["method"] == "llm"
    assert result["grounded"] is True
    assert "3" in result["answer"]


def test_coach_settings_have_defaults():
    from app.core.config import Settings

    settings = Settings()
    assert settings.coach_enabled is True
    assert settings.coach_model
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_coach_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.modules.coach.service'`.

- [ ] **Step 3a: Add config fields**

In `backend/app/core/config.py`, add these two fields to the `Settings` class, right after the `log_level` field:

```python
    # WhatsApp Q&A coach. Answers owner questions from real logged data using the
    # Anthropic adapter (reuses ATLAS_ANTHROPIC_API_KEY). Disable with
    # ATLAS_COACH_ENABLED=false — questions then fall back to a clarification reply.
    coach_enabled: bool = True
    coach_model: str = "claude-haiku-4-5"
```

- [ ] **Step 3b: Write the service**

Create `backend/app/modules/coach/service.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_coach_service.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/app/modules/coach/service.py backend/tests/test_coach_service.py
git commit -m "feat(coach): add answer_question service + coach config"
```

---

### Task 4: Wire the coach into the WhatsApp webhook

**Files:**
- Modify: `backend/app/modules/communication/router.py` (imports + `_handle_owner_message`)
- Test: `backend/tests/test_whatsapp.py` (add two tests)

**Interfaces:**
- Consumes: `classify_intent(text) -> str` (Task 1); `answer_question(text) -> dict` (Task 3); existing `_send_and_store_reply`, `classify_message`, `insert_activity`, `get_settings`, `json_dump`.
- Produces: no new interface — the webhook's returned `classification` dict now includes `method` values like `"coach:llm"`/`"coach:no_key"` for question messages (matched `False`, `activity_id` `None`).

- [ ] **Step 1: Write the failing tests**

Add these two tests to `backend/tests/test_whatsapp.py` (inside `WhatsAppTwoWayTest`, before the closing `if __name__` block):

```python
    def test_owner_question_gets_coach_reply_not_activity(self) -> None:
        # A question must NOT create an activity, but must get a reply (coach path).
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            before_activities = _whatsapp_activity_count(client, recovery_id)
            before_replies = _auto_reply_count(client, provider["id"])

            webhook = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "מה עשיתי השבוע?", key_id="q-1"),
            )
            self.assertEqual(webhook.status_code, 202)
            classification = webhook.json()["classification"]
            self.assertIsNotNone(classification)
            self.assertFalse(classification["matched"])
            self.assertIsNone(classification["activity_id"])
            self.assertTrue(classification["method"].startswith("coach:"))

            # No activity created; exactly one reply sent (dry-run).
            self.assertEqual(_whatsapp_activity_count(client, recovery_id), before_activities)
            self.assertEqual(_auto_reply_count(client, provider["id"]), before_replies + 1)

    def test_log_message_still_logs_after_coach_wiring(self) -> None:
        # Regression: a plain log statement still classifies + logs, not answered.
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            before_activities = _whatsapp_activity_count(client, recovery_id)

            webhook = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות", key_id="log-1"),
            )
            self.assertEqual(webhook.status_code, 202)
            classification = webhook.json()["classification"]
            self.assertTrue(classification["matched"])
            self.assertEqual(classification["module_id"], recovery_id)
            self.assertEqual(_whatsapp_activity_count(client, recovery_id), before_activities + 1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_whatsapp.py::WhatsAppTwoWayTest::test_owner_question_gets_coach_reply_not_activity -v`
Expected: FAIL — the question currently goes through `classify_message`, so `method` is `"rules"` (not `"coach:*"`), and the assertion `classification["method"].startswith("coach:")` fails.

- [ ] **Step 3a: Add imports**

In `backend/app/modules/communication/router.py`, add these two imports alongside the existing `from app.modules.*` imports (after the `from app.modules.communication.evolution import ...` line):

```python
from app.modules.coach.service import answer_question
from app.modules.communication.intent import classify_intent
```

- [ ] **Step 3b: Add the coach branch to `_handle_owner_message`**

Replace the entire existing `_handle_owner_message` function with this version. Only the new leading `if` block is added; the rest is the existing body, unchanged:

```python
def _handle_owner_message(conn, provider: dict, inbound_message_id: str | None, normalized: dict, sender: str, now: str) -> dict:
    """Answer owner questions from real data; otherwise classify + log when confident."""
    text = normalized["content_text"]
    settings = get_settings()

    if settings.coach_enabled and classify_intent(text) == "question":
        coach = answer_question(text)
        reply_message_id = _send_and_store_reply(conn, provider, sender, coach["answer"], in_reply_to=inbound_message_id)
        if inbound_message_id:
            conn.execute(
                "UPDATE communication_messages SET metadata = ?, updated_at = ? WHERE id = ?",
                (
                    json_dump(
                        {
                            "raw_event_type": normalized["event_type"],
                            "intent": "question",
                            "ai_generated": True,
                            "coach_method": coach["method"],
                        }
                    ),
                    now,
                    inbound_message_id,
                ),
            )
        return {
            "matched": False,
            "module_id": None,
            "module_name": None,
            "discipline_id": None,
            "activity_type": None,
            "title": None,
            "duration_minutes": None,
            "confidence": 0.0,
            "method": f"coach:{coach['method']}",
            "intent": "question",
            "reply_text": coach["answer"],
            "activity_id": None,
            "reply_message_id": reply_message_id,
        }

    result = classify_message(conn, provider, text)

    activity_id = None
    if result["matched"]:
        activity = insert_activity(
            conn,
            ActivityCreate(
                module_id=result["module_id"],
                discipline_id=result["discipline_id"],
                activity_type=result["activity_type"],
                title=result["title"],
                duration_minutes=result["duration_minutes"],
                source="whatsapp",
                metadata={
                    "channel": "whatsapp",
                    "classified_by": result["method"],
                    "confidence": result["confidence"],
                    "inbound_message_id": inbound_message_id,
                },
            ),
        )
        activity_id = activity["id"]

    reply_message_id = _send_and_store_reply(conn, provider, sender, result["reply_text"], in_reply_to=inbound_message_id)

    if inbound_message_id:
        conn.execute(
            "UPDATE communication_messages SET metadata = ?, updated_at = ? WHERE id = ?",
            (
                json_dump(
                    {
                        "raw_event_type": normalized["event_type"],
                        "classification": {
                            "matched": result["matched"],
                            "module_id": result["module_id"],
                            "method": result["method"],
                            "confidence": result["confidence"],
                        },
                        "activity_id": activity_id,
                    }
                ),
                now,
                inbound_message_id,
            ),
        )

    return {**result, "activity_id": activity_id, "reply_message_id": reply_message_id}
```

> Note: `insert_activity`, `ActivityCreate`, `classify_message`, `_send_and_store_reply`, `json_dump`, and `get_settings` are already imported in this file — do not re-import them.

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `.venv/bin/python -m pytest -v`
Expected: PASS — the two new webhook tests pass and all prior tests still pass (no regression).

- [ ] **Step 5: Lint, then commit**

Run: `.venv/bin/ruff check app tests`
Expected: `All checks passed!` (if it flags import order in `router.py`, run `.venv/bin/ruff check app tests --fix` and re-run the suite).

```bash
git add backend/app/modules/communication/router.py backend/tests/test_whatsapp.py
git commit -m "feat(coach): route WhatsApp questions to the coach in the webhook"
```

---

## Self-Review

**Spec coverage:**
- Intent routing (`log`/`question`/`other`) → Task 1 + Task 4 wiring. ✓
- Read-only context pack from the service layer → Task 2. ✓
- LLM answer via existing adapter, honest fallbacks → Task 3. ✓
- Honest-core guards (read-only, grounded prompt, real numbers, fail-honest, audited metadata) → Task 2 (read-only), Task 3 (prompt + fallbacks), Task 4 (`ai_generated` metadata). ✓
- Error/fallback table (no key, LLM error, ambiguous→log, non-owner, `coach_enabled=false`) → Task 3 (no_key/error), Task 1 bias (ambiguous→log), Task 4 (`coach_enabled` guard); non-owner is the existing allowlist, untouched. ✓
- Config (`coach_model`, `coach_enabled`, reuse key) → Task 3. ✓
- Testing (intent, context, honest fallback without network, e2e webhook + log regression) → Tasks 1–4. ✓
- Success criteria (real numbers; empty module never invents; logging unchanged) → Task 2/3 tests + Task 4 regression test. ✓

**Placeholder scan:** No TBD/TODO; every code and test step contains complete code. ✓

**Type consistency:** `classify_intent(text) -> str`, `build_context(text) -> dict`, `answer_question(text) -> dict {answer, grounded, method}`, `_llm_answer(api_key, model, context, question) -> str | None` — used consistently across Tasks 3 and 4. The webhook question-branch return includes every key `_public_classification` reads (`matched`, `module_id`, `module_name`, `activity_id`, `method`, `confidence`, `reply_message_id`). ✓

**Note on the deferred `build_context(conn, text)` signature:** the spec sketched `build_context(conn, text)` and `answer_question(conn, text)`, but the reads flow through `get_today_dashboard()` (which manages its own connection), so `conn` is unused. The plan drops it to avoid a dead parameter — same behavior, cleaner interface.
