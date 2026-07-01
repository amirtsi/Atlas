# Goals & Plans Engine (P2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Declare a goal → Atlas LLM decomposes it into a plan (arriving as an `activate_plan` proposal in the P1 inbox) → accept activates it → progress derives from real logged activities.

**Architecture:** New `planning` domain (goals/plans/plan_steps/plan_step_links). Progress is a query over `activities` (never stored). Plan activation reuses the P1 proposal inbox via a self-registered `activate_plan` handler (no proposals→planning import cycle). Decomposition reuses the coach's Anthropic-adapter pattern behind a monkeypatchable `decompose_goal`.

**Tech Stack:** Python 3.12, FastAPI, SQLite; stdlib urllib for the LLM call. Tests: pytest + FastAPI TestClient (LLM monkeypatched).

## Global Constraints

- Python `>=3.12`; no new runtime deps.
- **Honest core:** the plan (path) is a proposal — nothing activates until accepted; progress (position) is derived only from real `activities`/links, never stored, never invented; the LLM proposes titles/targets but `module_id` + `completion_rule` are constructed server-side; no key / LLM error → 422 (no fabricated plan). All create/activate steps audited.
- New tables land via `SCHEMA_SQL` `IF NOT EXISTS` (no `user_version` bump). Add `"depends_on"` and `"completion_rule"` to `row_to_dict`'s parsed keys.
- Reuse: P1 `proposals` service (`create_proposal`, `_HANDLERS`), coach adapter pattern, `record_audit_event`, `get_or_404`, `AtlasModel`/`AtlasResponse`, per-test temp DB.
- Backend from `backend/`; venv `.venv/bin/python`. Must pass `.venv/bin/ruff check app tests` + full `pytest`.

---

### Task 1: Data model + goals + progress engine

**Files:**
- Modify: `backend/app/core/database.py` (tables + `row_to_dict` keys)
- Modify: `backend/app/shared/schemas.py` (`GoalCreate`, `GoalOut`)
- Create: `backend/app/modules/planning/__init__.py` (empty)
- Create: `backend/app/modules/planning/service.py` (`create_goal`, `evaluate_step`)
- Test: `backend/tests/test_planning_service.py`

**Interfaces:**
- Produces: `create_goal(conn, payload: GoalCreate) -> dict`; `evaluate_step(conn, step: dict) -> dict` `{done,target,ratio,status,last_activity_at}`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_planning_service.py`:

```python
from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.core.time import utc_now_iso
from app.main import app
from app.modules.planning.service import create_goal, evaluate_step
from app.shared.schemas import GoalCreate


def _seed_goal_module() -> str:
    with TestClient(app) as client:
        return {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]


def _log(conn, module_id, title, minutes, activity_type="study"):
    aid = new_id()
    now = utc_now_iso()
    conn.execute(
        "INSERT INTO activities (id, module_id, activity_type, title, occurred_at, duration_minutes, source, metadata, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 'manual', '{}', ?, ?)",
        (aid, module_id, activity_type, title, now, minutes, now, now),
    )
    return aid


def test_create_goal_is_draft():
    module_id = _seed_goal_module()
    with db_connection() as conn:
        goal = create_goal(conn, GoalCreate(title="Pass OSCP", module_id=module_id))
    assert goal["status"] == "draft"
    assert goal["title"] == "Pass OSCP"


def test_evaluate_duration_rule_sums_matching_minutes():
    module_id = _seed_goal_module()
    with db_connection() as conn:
        _log(conn, module_id, "AD enumeration lab", 40)
        _log(conn, module_id, "Buffer overflow", 30)
        step = {
            "id": new_id(),
            "completion_rule": {"type": "duration", "module_id": module_id, "match": "ad", "target_minutes": 60},
        }
        result = evaluate_step(conn, step)
    assert result["done"] == 40  # only the "AD" activity matched
    assert result["target"] == 60
    assert result["status"] == "in_progress"


def test_evaluate_count_rule_and_done_status():
    module_id = _seed_goal_module()
    with db_connection() as conn:
        _log(conn, module_id, "box 1", 20)
        _log(conn, module_id, "box 2", 20)
        step = {"id": new_id(), "completion_rule": {"type": "count", "module_id": module_id, "match": "box", "target_count": 2}}
        result = evaluate_step(conn, step)
    assert result["done"] == 2
    assert result["status"] == "done"
    assert result["ratio"] == 1.0


def test_evaluate_empty_is_pending():
    module_id = _seed_goal_module()
    with db_connection() as conn:
        step = {"id": new_id(), "completion_rule": {"type": "duration", "module_id": module_id, "target_minutes": 100}}
        result = evaluate_step(conn, step)
    assert result["done"] == 0
    assert result["status"] == "pending"
```

- [ ] **Step 2: Run — expect fail** (`ModuleNotFoundError: app.modules.planning`).

Run: `.venv/bin/python -m pytest tests/test_planning_service.py -v`

- [ ] **Step 3a: Tables + row_to_dict.** In `backend/app/core/database.py`, add inside `SCHEMA_SQL` (after `proposals`, before the closing `"""`):

```sql
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  module_id TEXT REFERENCES life_modules(id),
  discipline_id TEXT REFERENCES disciplines(id),
  title TEXT NOT NULL,
  definition_of_done TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  target_date TEXT,
  capacity_minutes_per_week INTEGER,
  active_plan_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  achieved_at TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'proposed',
  rationale TEXT,
  based_on_plan_id TEXT,
  source_proposal_id TEXT,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  superseded_at TEXT
);

CREATE TABLE IF NOT EXISTS plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  goal_id TEXT NOT NULL REFERENCES goals(id),
  parent_id TEXT REFERENCES plan_steps(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  sequence INTEGER NOT NULL DEFAULT 0,
  depends_on TEXT NOT NULL DEFAULT '[]',
  completion_rule TEXT NOT NULL DEFAULT '{}',
  scheduled_for TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_step_links (
  step_id TEXT NOT NULL REFERENCES plan_steps(id),
  activity_id TEXT NOT NULL REFERENCES activities(id),
  PRIMARY KEY (step_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_plans_goal_id ON plans(goal_id);
CREATE INDEX IF NOT EXISTS idx_plan_steps_plan_id ON plan_steps(plan_id);
```

In `row_to_dict`, extend the parsed-keys tuple to include `"depends_on"` and `"completion_rule"`:

```python
    for key in ("config", "metadata", "default_metadata", "classification_json", "changes", "payload", "depends_on", "completion_rule"):
```

- [ ] **Step 3b: Schemas.** Append to `backend/app/shared/schemas.py`:

```python
class GoalCreate(AtlasModel):
    title: str = Field(min_length=1)
    module_id: str | None = None
    discipline_id: str | None = None
    definition_of_done: str | None = None
    target_date: str | None = None
    capacity_minutes_per_week: int | None = None
    created_by: str = "user"


class GoalOut(AtlasResponse):
    id: str
    module_id: str | None = None
    discipline_id: str | None = None
    title: str | None = None
    definition_of_done: str | None = None
    status: str | None = None
    target_date: str | None = None
    capacity_minutes_per_week: int | None = None
    active_plan_id: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    achieved_at: str | None = None
```

- [ ] **Step 3c: Service.** Create empty `backend/app/modules/planning/__init__.py`, then `backend/app/modules/planning/service.py`:

```python
"""Goals & Plans engine.

Goals and (versioned) plans; plan progress derived from real activities. The plan
is advisory (proposed via the P1 inbox); the position is a query over the ledger.
"""
from __future__ import annotations

from sqlite3 import Connection

from app.core.database import new_id
from app.core.time import utc_now_iso
from app.shared.audit import record_audit_event
from app.shared.schemas import GoalCreate
from app.shared.sql import get_or_404


def create_goal(conn: Connection, payload: GoalCreate) -> dict:
    now = utc_now_iso()
    goal_id = new_id()
    discipline_id = payload.discipline_id
    if payload.module_id:
        module = get_or_404(conn, "life_modules", payload.module_id)
        if discipline_id is None:
            discipline_id = module["discipline_id"]
    conn.execute(
        """
        INSERT INTO goals (id, module_id, discipline_id, title, definition_of_done, status,
                           target_date, capacity_minutes_per_week, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
        """,
        (
            goal_id, payload.module_id, discipline_id, payload.title, payload.definition_of_done,
            payload.target_date, payload.capacity_minutes_per_week, payload.created_by, now, now,
        ),
    )
    goal = get_or_404(conn, "goals", goal_id)
    record_audit_event(
        conn, entity_type="goal", entity_id=goal_id, action="created",
        summary=f"Goal created: {payload.title}", changes={"module_id": payload.module_id},
    )
    return goal


def evaluate_step(conn: Connection, step: dict) -> dict:
    """Derive a step's progress from real activities (or explicit links). Never stored."""
    rule = step.get("completion_rule") or {}
    rtype = rule.get("type", "duration")

    if rtype == "manual_link":
        done = conn.execute(
            "SELECT COUNT(*) AS c FROM plan_step_links WHERE step_id = ?", (step["id"],)
        ).fetchone()["c"]
        last = None
    else:
        where = ["a.module_id = ?"]
        params: list[object] = [rule.get("module_id")]
        if rule.get("activity_type"):
            where.append("a.activity_type = ?")
            params.append(rule["activity_type"])
        if rule.get("match"):
            where.append("(LOWER(a.title) LIKE ? OR LOWER(COALESCE(a.notes, '')) LIKE ?)")
            like = f"%{str(rule['match']).lower()}%"
            params.extend([like, like])
        agg = "COALESCE(SUM(a.duration_minutes), 0)" if rtype == "duration" else "COUNT(a.id)"
        row = conn.execute(
            f"SELECT {agg} AS v, MAX(a.occurred_at) AS last FROM activities a WHERE {' AND '.join(where)}",
            params,
        ).fetchone()
        done = row["v"] or 0
        last = row["last"]

    target = (rule.get("target_minutes") if rtype == "duration" else rule.get("target_count")) or 0
    ratio = min(1.0, done / target) if target else 0.0
    status = "done" if target and done >= target else "in_progress" if done else "pending"
    return {"done": done, "target": target, "ratio": ratio, "status": status, "last_activity_at": last}
```

- [ ] **Step 4: Run tests + full suite + ruff.** `.venv/bin/python -m pytest tests/test_planning_service.py -v` (4 pass); `.venv/bin/python -m pytest -q` (all pass); `.venv/bin/ruff check app tests` (clean).

- [ ] **Step 5: Commit.**

```bash
git add backend/app/core/database.py backend/app/shared/schemas.py backend/app/modules/planning/__init__.py backend/app/modules/planning/service.py backend/tests/test_planning_service.py
git commit -m "feat(planning): goals/plans tables + create_goal + ledger-derived evaluate_step"
```

---

### Task 2: Proposal-handler registry + plan activation

**Files:**
- Modify: `backend/app/modules/proposals/service.py` (add `register_proposal_handler`; validate against live registry)
- Modify: `backend/app/modules/planning/service.py` (add `_activate_plan_handler` + register at import)
- Test: `backend/tests/test_plan_activation.py`

**Interfaces:**
- Consumes: P1 `create_proposal`/`accept_proposal`; Task 1 tables.
- Produces: `register_proposal_handler(proposal_type: str, handler)`; planning `_activate_plan_handler(conn, payload) -> dict` registered for `"activate_plan"`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_plan_activation.py`:

```python
from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.core.time import utc_now_iso
from app.main import app
from app.modules.planning.service import create_goal
from app.modules.proposals.service import accept_proposal, create_proposal
from app.shared.schemas import GoalCreate


def _goal_with_plan(conn):
    goal = create_goal(conn, GoalCreate(title="Pass OSCP"))
    plan_id = new_id()
    now = utc_now_iso()
    conn.execute(
        "INSERT INTO plans (id, goal_id, version, status, created_at) VALUES (?, ?, 1, 'proposed', ?)",
        (plan_id, goal["id"], now),
    )
    return goal, plan_id


def test_accept_activate_plan_proposal_activates_plan_and_goal():
    with TestClient(app):  # ensures app import -> planning registers its handler
        with db_connection() as conn:
            goal, plan_id = _goal_with_plan(conn)
            proposal = create_proposal(
                conn, "activate_plan", "Plan for OSCP", "decomposed", {"plan_id": plan_id}
            )
            accept_proposal(conn, proposal["id"])
            plan = conn.execute("SELECT status FROM plans WHERE id = ?", (plan_id,)).fetchone()
            g = conn.execute("SELECT status, active_plan_id FROM goals WHERE id = ?", (goal["id"],)).fetchone()
    assert plan["status"] == "active"
    assert g["status"] == "active"
    assert g["active_plan_id"] == plan_id


def test_activate_plan_is_a_registered_type():
    with TestClient(app):
        from app.modules.proposals.service import KNOWN_TYPES

        assert "activate_plan" in KNOWN_TYPES
```

- [ ] **Step 2: Run — expect fail** (`create_proposal` rejects unknown type "activate_plan" → 422, or handler missing).

Run: `.venv/bin/python -m pytest tests/test_plan_activation.py -v`

- [ ] **Step 3a: Registry extension.** In `backend/app/modules/proposals/service.py`, replace the static `KNOWN_TYPES = set(_HANDLERS)` line and add a registration function. The `_HANDLERS` dict + the two `_apply_*` handlers + their two entries stay. Change:

```python
_HANDLERS: dict[str, ProposalHandler] = {
    "set_module_priority": _apply_set_module_priority,
    "set_module_status": _apply_set_module_status,
}


def register_proposal_handler(proposal_type: str, handler: ProposalHandler) -> None:
    """Let other domains add proposal types without proposals importing them (avoids
    an import cycle and keeps this module closed to modification — OCP)."""
    _HANDLERS[proposal_type] = handler
```

Then make validation use the live registry. In `create_proposal`, change the guard from `if type not in KNOWN_TYPES:` to:

```python
    if type not in _HANDLERS:
        raise HTTPException(status_code=422, detail="Unknown proposal type")
```

And expose `KNOWN_TYPES` as a live view for callers/tests — replace any `KNOWN_TYPES = set(_HANDLERS)` with a module-level property-like accessor by defining, at the bottom of the handler section:

```python
class _KnownTypes:
    def __contains__(self, item: object) -> bool:
        return item in _HANDLERS

    def __iter__(self):
        return iter(_HANDLERS)


KNOWN_TYPES = _KnownTypes()
```

(If the original P1 code referenced `KNOWN_TYPES` elsewhere, it keeps working — `in` and iteration are supported.)

- [ ] **Step 3b: Activation handler.** Append to `backend/app/modules/planning/service.py`:

```python
from app.modules.proposals.service import register_proposal_handler  # noqa: E402  (registration side-effect)


def _activate_plan_handler(conn: Connection, payload: dict) -> dict:
    plan_id = payload["plan_id"]
    plan = get_or_404(conn, "plans", plan_id)
    now = utc_now_iso()
    goal_id = plan["goal_id"]
    # Supersede any currently-active plan for this goal.
    conn.execute(
        "UPDATE plans SET status = 'superseded', superseded_at = ? WHERE goal_id = ? AND status = 'active'",
        (now, goal_id),
    )
    conn.execute(
        "UPDATE plans SET status = 'active', activated_at = ? WHERE id = ?",
        (now, plan_id),
    )
    conn.execute(
        "UPDATE goals SET active_plan_id = ?, status = 'active', updated_at = ? WHERE id = ?",
        (plan_id, now, goal_id),
    )
    updated = get_or_404(conn, "plans", plan_id)
    record_audit_event(
        conn, entity_type="plan", entity_id=plan_id, action="activated",
        summary=f"Plan activated for goal {goal_id}", changes={"goal_id": goal_id},
    )
    return updated


register_proposal_handler("activate_plan", _activate_plan_handler)
```

> Place the `from app.modules.proposals.service import register_proposal_handler` with the other imports at the TOP of planning/service.py (not mid-file) — the `# noqa` note is only to explain the import exists for its registration side effect. Keep ruff happy: it IS used (called at module load).

- [ ] **Step 4: Run tests + full suite + ruff.** `.venv/bin/python -m pytest tests/test_plan_activation.py -v` (2 pass); full `pytest -q` (all pass, incl. P1 proposals); ruff clean.

- [ ] **Step 5: Commit.**

```bash
git add backend/app/modules/proposals/service.py backend/app/modules/planning/service.py backend/tests/test_plan_activation.py
git commit -m "feat(planning): self-registered activate_plan proposal handler"
```

---

### Task 3: LLM decomposition → proposed plan

**Files:**
- Modify: `backend/app/modules/planning/service.py` (`decompose_goal`, `propose_plan_for_goal`)
- Modify: `backend/app/core/config.py` (reuse `coach_model`; no new field needed) — no change if `coach_model` already exists (it does)
- Test: `backend/tests/test_plan_decomposition.py`

**Interfaces:**
- Consumes: Task 1/2; P1 `create_proposal`.
- Produces: `decompose_goal(goal: dict) -> list[dict]` (module-level, monkeypatchable); `propose_plan_for_goal(conn, goal_id: str) -> dict` (returns the created `activate_plan` proposal).

- [ ] **Step 1: Write the failing test** — `backend/tests/test_plan_decomposition.py`:

```python
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import db_connection
from app.main import app
from app.modules.planning import service
from app.modules.planning.service import create_goal, propose_plan_for_goal
from app.shared.schemas import GoalCreate

STEPS = [
    {"kind": "topic", "title": "Active Directory", "description": "AD attacks", "sequence": 1, "unit": "minutes", "target": 600, "match": "active directory"},
    {"kind": "topic", "title": "Buffer Overflow", "description": "BOF", "sequence": 2, "unit": "count", "target": 3, "match": "overflow"},
]


def _goal_id(conn) -> str:
    with TestClient(app) as client:
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
    return create_goal(conn, GoalCreate(title="Pass OSCP", module_id=module_id))["id"]


def test_propose_plan_creates_proposed_plan_steps_and_proposal(monkeypatch):
    monkeypatch.setattr(service, "decompose_goal", lambda goal: {"rationale": "r", "steps": STEPS})
    with db_connection() as conn:
        goal_id = _goal_id(conn)
        proposal = propose_plan_for_goal(conn, goal_id)
        assert proposal["type"] == "activate_plan"
        plan_id = proposal["payload"]["plan_id"]
        plan = conn.execute("SELECT status, goal_id FROM plans WHERE id = ?", (plan_id,)).fetchone()
        steps = conn.execute(
            "SELECT title, completion_rule FROM plan_steps WHERE plan_id = ? ORDER BY sequence", (plan_id,)
        ).fetchall()
    assert plan["status"] == "proposed"
    assert len(steps) == 2
    # completion_rule.module_id is server-constructed from the goal, not the LLM
    import json
    rule0 = json.loads(steps[0]["completion_rule"])
    assert rule0["module_id"] is not None
    assert rule0["type"] in {"duration", "count"}


def test_propose_plan_without_llm_key_is_422(monkeypatch):
    monkeypatch.delenv("ATLAS_ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()
    # real decompose_goal path: no key -> None -> 422
    with db_connection() as conn:
        goal_id = _goal_id(conn)
        with pytest.raises(HTTPException) as exc:
            propose_plan_for_goal(conn, goal_id)
    assert exc.value.status_code == 422
```

- [ ] **Step 2: Run — expect fail** (`propose_plan_for_goal` not defined).

Run: `.venv/bin/python -m pytest tests/test_plan_decomposition.py -v`

- [ ] **Step 3: Implement.** Append to `backend/app/modules/planning/service.py` (add `json`, urllib imports + `get_settings` at top):

```python
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import get_settings

_DECOMPOSE_SYSTEM = (
    "You are a planning assistant. Decompose the user's goal into a concrete, sequenced "
    "plan. Reply with ONLY JSON: {\"rationale\": string, \"steps\": [{\"kind\": "
    "\"phase\"|\"topic\"|\"practice\"|\"milestone\", \"title\": string, \"description\": "
    "string, \"sequence\": int, \"unit\": \"minutes\"|\"count\", \"target\": int, "
    "\"match\": string}]}. 'match' is a short lowercase keyword found in activity titles "
    "for that step. 6-12 steps. No prose outside the JSON."
)


def decompose_goal(goal: dict) -> dict | None:
    """Ask the LLM to decompose a goal into steps. Returns {rationale, steps} or None
    on no-key / error. Module-level so tests monkeypatch it."""
    settings = get_settings()
    api_key = (settings.anthropic_api_key or "").strip()
    if not api_key:
        return None
    user = json.dumps(
        {
            "title": goal.get("title"),
            "definition_of_done": goal.get("definition_of_done"),
            "target_date": goal.get("target_date"),
            "capacity_minutes_per_week": goal.get("capacity_minutes_per_week"),
        },
        ensure_ascii=False,
    )
    body = json.dumps(
        {"model": settings.coach_model, "max_tokens": 1500, "system": _DECOMPOSE_SYSTEM,
         "messages": [{"role": "user", "content": user}]}
    ).encode("utf-8")
    request = Request(
        "https://api.anthropic.com/v1/messages", data=body,
        headers={"content-type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8") or "{}")
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None
    text = ""
    for block in payload.get("content") or []:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text") or ""
            break
    try:
        start, end = text.find("{"), text.rfind("}")
        data = json.loads(text[start : end + 1]) if start != -1 and end != -1 else None
    except (ValueError, TypeError):
        return None
    if not data or not isinstance(data.get("steps"), list) or not data["steps"]:
        return None
    return data


def _completion_rule(goal: dict, step_spec: dict) -> dict:
    unit = step_spec.get("unit", "minutes")
    match = str(step_spec.get("match") or step_spec.get("title") or "").lower().strip()
    rule: dict = {"module_id": goal.get("module_id"), "match": match}
    if unit == "count":
        rule["type"] = "count"
        rule["target_count"] = int(step_spec.get("target") or 1)
    else:
        rule["type"] = "duration"
        rule["target_minutes"] = int(step_spec.get("target") or 30)
    return rule


def propose_plan_for_goal(conn: Connection, goal_id: str) -> dict:
    from app.modules.proposals.service import create_proposal

    goal = get_or_404(conn, "goals", goal_id)
    decomposed = decompose_goal(goal)
    if not decomposed:
        raise HTTPException(status_code=422, detail="Plan decomposition unavailable (needs AI key)")

    now = utc_now_iso()
    plan_id = new_id()
    conn.execute(
        "INSERT INTO plans (id, goal_id, version, status, rationale, created_at) VALUES (?, ?, 1, 'proposed', ?, ?)",
        (plan_id, goal_id, decomposed.get("rationale"), now),
    )
    for spec in decomposed["steps"]:
        conn.execute(
            """
            INSERT INTO plan_steps (id, plan_id, goal_id, kind, title, description, sequence,
                                    depends_on, completion_rule, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
            """,
            (
                new_id(), plan_id, goal_id, spec.get("kind", "topic"), spec.get("title", "Step"),
                spec.get("description"), int(spec.get("sequence") or 0),
                json.dumps(_completion_rule(goal, spec)), now, now,
            ),
        )
    proposal = create_proposal(
        conn, "activate_plan", f"Plan for {goal['title']}",
        decomposed.get("rationale") or "Proposed plan from your goal.",
        {"plan_id": plan_id}, created_by="system",
    )
    conn.execute("UPDATE plans SET source_proposal_id = ? WHERE id = ?", (proposal["id"], plan_id))
    return proposal
```

- [ ] **Step 4: Run tests + full suite + ruff.** `.venv/bin/python -m pytest tests/test_plan_decomposition.py -v` (2 pass); full `pytest -q`; ruff clean.

- [ ] **Step 5: Commit.**

```bash
git add backend/app/modules/planning/service.py backend/tests/test_plan_decomposition.py
git commit -m "feat(planning): LLM goal decomposition -> proposed plan + inbox proposal"
```

---

### Task 4: Planning router + plan-with-progress + wiring

**Files:**
- Modify: `backend/app/modules/planning/service.py` (`get_goal_plan`)
- Create: `backend/app/modules/planning/router.py`
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_planning_api.py`

**Interfaces:**
- Produces: `get_goal_plan(conn, goal_id) -> dict | None` (active/latest plan + steps + per-step progress + overall percent); endpoints under `/planning`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_planning_api.py`:

```python
from fastapi.testclient import TestClient

from app.main import app
from app.modules.planning import service

STEPS = [
    {"kind": "topic", "title": "Active Directory", "description": "AD", "sequence": 1, "unit": "minutes", "target": 60, "match": "active directory"},
]


def test_full_goal_to_plan_flow(monkeypatch):
    monkeypatch.setattr(service, "decompose_goal", lambda goal: {"rationale": "r", "steps": STEPS})
    with TestClient(app) as client:
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]

        goal = client.post("/api/v1/planning/goals", json={"title": "Pass OSCP", "module_id": module_id})
        assert goal.status_code == 201, goal.text
        goal_id = goal.json()["id"]

        proposal = client.post(f"/api/v1/planning/goals/{goal_id}/propose-plan")
        assert proposal.status_code == 200, proposal.text
        pid = proposal.json()["id"]
        assert proposal.json()["type"] == "activate_plan"

        # The plan proposal shows up in the P1 inbox and accepting it activates the plan.
        accepted = client.post(f"/api/v1/proposals/{pid}/accept")
        assert accepted.status_code == 200

        # Log real activity toward the AD step, then read progress.
        client.post("/api/v1/activities", json={
            "module_id": module_id, "activity_type": "study",
            "title": "Active Directory enumeration", "duration_minutes": 30,
        })
        plan = client.get(f"/api/v1/planning/goals/{goal_id}/plan").json()
        assert plan["plan"]["status"] == "active"
        ad = next(s for s in plan["steps"] if s["title"] == "Active Directory")
        assert ad["progress"]["done"] == 30
        assert ad["progress"]["target"] == 60
        assert ad["progress"]["status"] == "in_progress"


def test_get_plan_404_when_none():
    with TestClient(app) as client:
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
        goal_id = client.post("/api/v1/planning/goals", json={"title": "No plan yet", "module_id": module_id}).json()["id"]
        assert client.get(f"/api/v1/planning/goals/{goal_id}/plan").status_code == 404
```

- [ ] **Step 2: Run — expect fail** (404s; router not registered).

Run: `.venv/bin/python -m pytest tests/test_planning_api.py -v`

- [ ] **Step 3a: `get_goal_plan`.** Append to `backend/app/modules/planning/service.py`:

```python
def get_goal_plan(conn: Connection, goal_id: str) -> dict | None:
    goal = get_or_404(conn, "goals", goal_id)
    plan_id = goal["active_plan_id"]
    if not plan_id:
        row = conn.execute(
            "SELECT id FROM plans WHERE goal_id = ? ORDER BY version DESC, created_at DESC LIMIT 1", (goal_id,)
        ).fetchone()
        plan_id = row["id"] if row else None
    if not plan_id:
        return None
    plan = get_or_404(conn, "plans", plan_id)
    from app.core.database import rows_to_dicts

    steps = rows_to_dicts(
        conn.execute("SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY sequence, created_at", (plan_id,)).fetchall()
    )
    for step in steps:
        step["progress"] = evaluate_step(conn, step)
    done = sum(1 for s in steps if s["progress"]["status"] == "done")
    overall = round(100 * done / len(steps)) if steps else 0
    return {"goal": goal, "plan": plan, "steps": steps, "overall_percent": overall}
```

- [ ] **Step 3b: Router.** Create `backend/app/modules/planning/router.py`:

```python
from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, rows_to_dicts
from app.modules.planning.service import create_goal, get_goal_plan, propose_plan_for_goal
from app.shared.schemas import GoalCreate, GoalOut, ProposalOut

router = APIRouter(prefix="/planning", tags=["planning"])


@router.post("/goals", status_code=201, response_model=GoalOut)
def create(payload: GoalCreate) -> dict:
    with db_connection() as conn:
        return create_goal(conn, payload)


@router.get("/goals", response_model=list[GoalOut])
def list_goals(status: str | None = None) -> list[dict]:
    sql = "SELECT * FROM goals"
    params: list[object] = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("/goals/{goal_id}/propose-plan", response_model=ProposalOut)
def propose_plan(goal_id: str) -> dict:
    with db_connection() as conn:
        return propose_plan_for_goal(conn, goal_id)


@router.get("/goals/{goal_id}/plan")
def goal_plan(goal_id: str) -> dict:
    with db_connection() as conn:
        result = get_goal_plan(conn, goal_id)
    if result is None:
        raise HTTPException(status_code=404, detail="No plan for this goal yet")
    return result
```

- [ ] **Step 3c: Wire.** In `backend/app/main.py`: `from app.modules.planning.router import router as planning_router` and `app.include_router(planning_router, prefix="/api/v1")`.

- [ ] **Step 4: Run tests + full suite + ruff.** `.venv/bin/python -m pytest tests/test_planning_api.py -v` (2 pass); full `pytest -q`; ruff clean.

- [ ] **Step 5: Commit.**

```bash
git add backend/app/modules/planning/router.py backend/app/modules/planning/service.py backend/app/main.py backend/tests/test_planning_api.py
git commit -m "feat(planning): goals/plan REST endpoints + plan-with-progress + wiring"
```

---

## Self-Review

**Spec coverage:** tables + row_to_dict keys (T1) · GoalCreate/GoalOut (T1) · create_goal (T1) · evaluate_step duration/count/manual_link/match (T1) · registry extension + self-registration, no cycle (T2) · activate_plan handler → plan+goal active, supersede prior (T2) · decompose_goal (LLM, monkeypatchable) + server-constructed completion_rule + proposed plan + activate_plan proposal (T3) · no-key → 422 (T3) · goals/propose-plan/plan endpoints (T4) · get_goal_plan with derived progress + overall percent (T4) · full flow incl. accept-via-P1-inbox (T4 test). Honest-core: proposal-gated activation, ledger-derived progress, server-built rules, 422 fallback — all covered.

**Placeholder scan:** No placeholders — every step carries complete, runnable code.

**Type consistency:** `create_goal(conn, GoalCreate)`, `evaluate_step(conn, step)`, `decompose_goal(goal)->{rationale,steps}`, `propose_plan_for_goal(conn, goal_id)->proposal`, `get_goal_plan(conn, goal_id)`, `register_proposal_handler(type, handler)`, `_activate_plan_handler(conn, payload)` are used consistently across tasks. Proposal type `"activate_plan"` matches between T2 (handler registration), T3 (create_proposal), and T4 (test). `completion_rule` shape matches between T1 evaluate_step and T3 `_completion_rule`.
```
