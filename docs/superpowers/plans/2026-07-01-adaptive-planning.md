# Adaptive Planning (P2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make plans adaptive — measure drift vs the target date, propose a re-plan (new plan version) when behind, and turn the daily brief forward. Plus the 3 P2a-review backlog fixes.

**Architecture:** All additions live in `planning/service.py` (+ its router) and the daily-brief composer. Re-plans reuse the P1 `activate_plan` proposal + handler (activation supersedes the prior plan). Drift/next-step are derived from real progress + real dates — never stored.

**Tech Stack:** Python 3.12, FastAPI, SQLite. Tests: pytest + TestClient (LLM monkeypatched).

## Global Constraints
- Python `>=3.12`; no new deps. Honest core: drift/next-step derived only from real progress + dates (`None` when insufficient); re-plans are advisory proposals (versioned, superseding, audited); decompose obeys 422-on-no-key. All from `backend/`; `.venv/bin/python`; must pass ruff + full pytest.
- Reuse P2a: `evaluate_step`, `decompose_goal`, `get_goal_plan`, `propose_plan_for_goal`, `_activate_plan_handler`, `create_proposal`.

---

### Task 1: Backlog fixes (module-required, time-scoped progress, non-empty match)

**Files:** Modify `backend/app/modules/planning/service.py`; Test `backend/tests/test_planning_backlog.py`.

**Interfaces:** `evaluate_step(conn, step, since=None)`; `propose_plan_for_goal` raises 422 on module-less goal; `get_goal_plan` passes the active plan's `activated_at` as `since`.

- [ ] **Step 1: Failing test** — `backend/tests/test_planning_backlog.py`:

```python
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.core.time import utc_now_iso
from app.main import app
from app.modules.planning.service import create_goal, evaluate_step, propose_plan_for_goal, _completion_rule
from app.shared.schemas import GoalCreate


def _oscp_module_id():
    with TestClient(app) as client:
        return {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]


def test_propose_plan_requires_module():
    with db_connection() as conn:
        goal = create_goal(conn, GoalCreate(title="No module goal"))
        with pytest.raises(HTTPException) as exc:
            propose_plan_for_goal(conn, goal["id"])
    assert exc.value.status_code == 422


def test_evaluate_step_since_excludes_older_activity():
    module_id = _oscp_module_id()
    with db_connection() as conn:
        old = new_id()
        conn.execute(
            "INSERT INTO activities (id, module_id, activity_type, title, occurred_at, duration_minutes, source, metadata, created_at, updated_at) "
            "VALUES (?, ?, 'study', 'AD old', '2020-01-01T00:00:00+00:00', 50, 'manual', '{}', ?, ?)",
            (old, module_id, utc_now_iso(), utc_now_iso()),
        )
        new = new_id()
        now = utc_now_iso()
        conn.execute(
            "INSERT INTO activities (id, module_id, activity_type, title, occurred_at, duration_minutes, source, metadata, created_at, updated_at) "
            "VALUES (?, ?, 'study', 'AD new', ?, 20, 'manual', '{}', ?, ?)",
            (new, module_id, now, now, now),
        )
        step = {"id": new_id(), "completion_rule": {"type": "duration", "module_id": module_id, "match": "ad", "target_minutes": 100}}
        all_time = evaluate_step(conn, step)
        since_now = evaluate_step(conn, step, since="2021-01-01T00:00:00+00:00")
    assert all_time["done"] == 70
    assert since_now["done"] == 20


def test_completion_rule_never_empty_match():
    rule = _completion_rule({"module_id": "m1"}, {"unit": "minutes", "target": 60, "title": "Active Directory"})
    assert rule["match"] == "active directory"
    rule2 = _completion_rule({"module_id": "m1"}, {"unit": "count", "target": 3, "title": "", "match": ""})
    assert "match" not in rule2  # no empty match stored
```

- [ ] **Step 2: Run — expect fail.** `.venv/bin/python -m pytest tests/test_planning_backlog.py -v`

- [ ] **Step 3a:** In `planning/service.py`, change `evaluate_step` signature to `def evaluate_step(conn: Connection, step: dict, since: str | None = None) -> dict:` and, inside the non-`manual_link` branch, after the `match` clause, add:

```python
            if since:
                where.append("a.occurred_at >= ?")
                params.append(since)
```

- [ ] **Step 3b:** In `_completion_rule`, replace the `match` handling so an empty match is dropped:

```python
def _completion_rule(goal: dict, step_spec: dict) -> dict:
    unit = step_spec.get("unit", "minutes")
    match = str(step_spec.get("match") or step_spec.get("title") or "").lower().strip()
    rule: dict = {"module_id": goal.get("module_id")}
    if match:
        rule["match"] = match
    if unit == "count":
        rule["type"] = "count"
        rule["target_count"] = int(step_spec.get("target") or 1)
    else:
        rule["type"] = "duration"
        rule["target_minutes"] = int(step_spec.get("target") or 30)
    return rule
```

- [ ] **Step 3c:** In `propose_plan_for_goal`, right after `goal = get_or_404(conn, "goals", goal_id)`, add:

```python
    if not goal.get("module_id"):
        raise HTTPException(status_code=422, detail="Goal needs a module before planning")
```

- [ ] **Step 3d:** In `get_goal_plan`, pass the active plan's activation time as `since` so progress counts only post-activation activity. Change the per-step loop to:

```python
    since = plan["activated_at"] if plan["status"] == "active" else None
    for step in steps:
        step["progress"] = evaluate_step(conn, step, since=since)
```

- [ ] **Step 4: Run** `.venv/bin/python -m pytest tests/test_planning_backlog.py -v` (3 pass); full `pytest -q`; ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/planning/service.py backend/tests/test_planning_backlog.py
git commit -m "fix(planning): require module, time-scope progress, non-empty match"
```

---

### Task 2: Drift & projection

**Files:** Modify `backend/app/modules/planning/service.py` (`compute_drift`, extend `get_goal_plan`); Test `backend/tests/test_planning_drift.py`.

**Interfaces:** `compute_drift(goal: dict, plan: dict, actual_percent: float) -> dict | None`; `get_goal_plan` result gains `"drift"`.

- [ ] **Step 1: Failing test** — `backend/tests/test_planning_drift.py`:

```python
from app.modules.planning.service import compute_drift


def test_drift_negative_when_behind():
    goal = {"target_date": "2026-07-11T00:00:00+00:00"}
    plan = {"activated_at": "2026-07-01T00:00:00+00:00", "status": "active"}
    # ~ (now is 2026-07-01+; assume ~0 elapsed at activation) — use a plan activated in the past via a fixed now is hard;
    # instead assert structure + math via a helper-friendly call: horizon 10 days, elapsed measured live.
    drift = compute_drift(goal, plan, actual_percent=0.0)
    assert drift is not None
    assert set(drift) == {"expected_percent", "actual_percent", "drift", "projected_completion", "on_track"}
    assert drift["actual_percent"] == 0.0
    # With 0 progress and any elapsed time, drift <= 0 and on_track reflects the threshold.
    assert drift["drift"] <= 0.0


def test_drift_none_without_target_date():
    goal = {"target_date": None}
    plan = {"activated_at": "2026-07-01T00:00:00+00:00", "status": "active"}
    assert compute_drift(goal, plan, actual_percent=0.5) is None


def test_drift_none_without_activation():
    goal = {"target_date": "2026-08-01T00:00:00+00:00"}
    plan = {"activated_at": None, "status": "proposed"}
    assert compute_drift(goal, plan, actual_percent=0.5) is None
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3a:** Add to `planning/service.py` (add `from datetime import UTC, datetime` to the top imports if not present):

```python
def _parse_iso(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def compute_drift(goal: dict, plan: dict, actual_percent: float) -> dict | None:
    target = _parse_iso(goal.get("target_date"))
    activated = _parse_iso(plan.get("activated_at"))
    if target is None or activated is None:
        return None
    now = datetime.now(UTC)
    horizon = (target - activated).total_seconds()
    if horizon <= 0:
        return None
    elapsed = max(0.0, (now - activated).total_seconds())
    expected = min(1.0, elapsed / horizon)
    drift = round(actual_percent - expected, 3)
    projected = None
    if actual_percent > 0:
        projected = (activated + (now - activated) / actual_percent).isoformat()
    return {
        "expected_percent": round(expected, 3),
        "actual_percent": round(actual_percent, 3),
        "drift": drift,
        "projected_completion": projected,
        "on_track": drift >= -0.15,
    }
```

- [ ] **Step 3b:** In `get_goal_plan`, before the final `return`, add drift using the computed `overall`:

```python
    drift = compute_drift(goal, plan, overall / 100)
    return {"goal": goal, "plan": plan, "steps": steps, "overall_percent": overall, "drift": drift}
```

(Replace the existing return line accordingly.)

- [ ] **Step 4: Run** drift tests (3 pass); full suite; ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/planning/service.py backend/tests/test_planning_drift.py
git commit -m "feat(planning): goal drift + projected completion in get_goal_plan"
```

---

### Task 3: Re-plan proposals

**Files:** Modify `backend/app/modules/planning/service.py` (`decompose_goal` context arg, `generate_replan_proposal`); Modify `backend/app/modules/planning/router.py` (`/replan`); Test `backend/tests/test_planning_replan.py`.

**Interfaces:** `decompose_goal(goal, context: str | None = None)`; `generate_replan_proposal(conn, goal_id) -> dict | None`; `POST /planning/goals/{id}/replan`.

- [ ] **Step 1: Failing test** — `backend/tests/test_planning_replan.py`:

```python
from fastapi.testclient import TestClient

from app.main import app
from app.modules.planning import service

STEPS = {"rationale": "adjusted", "steps": [
    {"kind": "topic", "title": "AD", "sequence": 1, "unit": "minutes", "target": 60, "match": "ad"},
]}


def _dated_goal_with_active_plan(client, monkeypatch):
    monkeypatch.setattr(service, "decompose_goal", lambda goal, context=None: STEPS)
    module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
    goal_id = client.post("/api/v1/planning/goals", json={
        "title": "Pass OSCP", "module_id": module_id, "target_date": "2020-01-10T00:00:00+00:00",
    }).json()["id"]
    pid = client.post(f"/api/v1/planning/goals/{goal_id}/propose-plan").json()["id"]
    client.post(f"/api/v1/proposals/{pid}/accept")
    return goal_id


def test_replan_when_behind_creates_v2(monkeypatch):
    with TestClient(app) as client:
        goal_id = _dated_goal_with_active_plan(client, monkeypatch)
        # target_date is in the past → behind → replan proposes v2
        resp = client.post(f"/api/v1/planning/goals/{goal_id}/replan").json()
        assert resp["type"] == "activate_plan"
        plan_id = resp["payload"]["plan_id"]
        v2 = client.get(f"/api/v1/planning/goals/{goal_id}/plan")  # still v1 active until accepted
        # second replan while one is pending -> no new proposal
        again = client.post(f"/api/v1/planning/goals/{goal_id}/replan").json()
        assert again.get("status") == "replan_pending"


def test_replan_on_track_returns_status(monkeypatch):
    with TestClient(app) as client:
        monkeypatch.setattr(service, "decompose_goal", lambda goal, context=None: STEPS)
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
        # far-future target -> on track
        goal_id = client.post("/api/v1/planning/goals", json={
            "title": "Later", "module_id": module_id, "target_date": "2099-01-01T00:00:00+00:00",
        }).json()["id"]
        pid = client.post(f"/api/v1/planning/goals/{goal_id}/propose-plan").json()["id"]
        client.post(f"/api/v1/proposals/{pid}/accept")
        resp = client.post(f"/api/v1/planning/goals/{goal_id}/replan").json()
        assert resp.get("status") == "on_track"
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3a:** Extend `decompose_goal` to accept context. Change its signature to `def decompose_goal(goal: dict, context: str | None = None) -> dict | None:` and, when building `user`, include the context:

```python
    user = json.dumps(
        {
            "title": goal.get("title"),
            "definition_of_done": goal.get("definition_of_done"),
            "target_date": goal.get("target_date"),
            "capacity_minutes_per_week": goal.get("capacity_minutes_per_week"),
            "adjustment": context,
        },
        ensure_ascii=False,
    )
```

- [ ] **Step 3b:** Add `generate_replan_proposal` to `planning/service.py`:

```python
def generate_replan_proposal(conn: Connection, goal_id: str) -> dict:
    from app.modules.proposals.service import create_proposal

    plan_view = get_goal_plan(conn, goal_id)
    if plan_view is None or plan_view["plan"]["status"] != "active":
        raise HTTPException(status_code=404, detail="Goal has no active plan to re-plan")
    drift = plan_view["drift"]
    if drift is None or drift["on_track"]:
        return {"status": "on_track"}
    existing = conn.execute(
        "SELECT 1 FROM proposals WHERE status = 'pending' AND type = 'activate_plan' "
        "AND json_extract(payload, '$.plan_id') IN (SELECT id FROM plans WHERE goal_id = ?) LIMIT 1",
        (goal_id,),
    ).fetchone()
    if existing:
        return {"status": "replan_pending"}

    goal = plan_view["goal"]
    active = plan_view["plan"]
    context = (
        f"Behind schedule: {int(drift['actual_percent'] * 100)}% done vs "
        f"{int(drift['expected_percent'] * 100)}% expected. Produce an adjusted, realistic plan."
    )
    decomposed = decompose_goal(goal, context=context)
    if not decomposed:
        raise HTTPException(status_code=422, detail="Re-plan decomposition unavailable (needs AI key)")
    now = utc_now_iso()
    plan_id = new_id()
    conn.execute(
        "INSERT INTO plans (id, goal_id, version, status, rationale, based_on_plan_id, created_at) "
        "VALUES (?, ?, ?, 'proposed', ?, ?, ?)",
        (plan_id, goal_id, int(active["version"]) + 1, decomposed.get("rationale"), active["id"], now),
    )
    for spec in decomposed["steps"]:
        conn.execute(
            "INSERT INTO plan_steps (id, plan_id, goal_id, kind, title, description, sequence, depends_on, completion_rule, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)",
            (new_id(), plan_id, goal_id, spec.get("kind", "topic"), spec.get("title", "Step"),
             spec.get("description"), int(spec.get("sequence") or 0), json.dumps(_completion_rule(goal, spec)), now, now),
        )
    proposal = create_proposal(
        conn, "activate_plan", f"Re-plan for {goal['title']} (v{int(active['version']) + 1})",
        decomposed.get("rationale") or context, {"plan_id": plan_id}, created_by="system",
    )
    conn.execute("UPDATE plans SET source_proposal_id = ? WHERE id = ?", (proposal["id"], plan_id))
    return proposal
```

- [ ] **Step 3c:** Add the endpoint to `planning/router.py` (import `generate_replan_proposal`):

```python
@router.post("/goals/{goal_id}/replan")
def replan(goal_id: str) -> dict:
    with db_connection() as conn:
        return generate_replan_proposal(conn, goal_id)
```

(Update the import line to include `generate_replan_proposal`. Note: this endpoint has no `response_model` because it returns either a proposal or a `{"status": ...}` dict.)

- [ ] **Step 4: Run** replan tests (2 pass); full suite; ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/planning/service.py backend/app/modules/planning/router.py backend/tests/test_planning_replan.py
git commit -m "feat(planning): drift-driven re-plan proposals (versioned)"
```

---

### Task 4: Forward daily brief

**Files:** Modify `backend/app/modules/planning/service.py` (`active_goal_brief_line`); Modify `backend/app/modules/communication/router.py` (`_compose_daily_brief`); Test `backend/tests/test_forward_brief.py`.

**Interfaces:** `active_goal_brief_line(conn) -> str | None`.

- [ ] **Step 1: Failing test** — `backend/tests/test_forward_brief.py`:

```python
from fastapi.testclient import TestClient

from app.main import app
from app.modules.planning import service

STEPS = {"rationale": "r", "steps": [
    {"kind": "topic", "title": "Active Directory", "sequence": 1, "unit": "minutes", "target": 60, "match": "active directory"},
]}


def test_brief_line_includes_next_step(monkeypatch):
    monkeypatch.setattr(service, "decompose_goal", lambda goal, context=None: STEPS)
    with TestClient(app) as client:
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
        goal_id = client.post("/api/v1/planning/goals", json={
            "title": "Pass OSCP", "module_id": module_id, "target_date": "2099-01-01T00:00:00+00:00",
        }).json()["id"]
        pid = client.post(f"/api/v1/planning/goals/{goal_id}/propose-plan").json()["id"]
        client.post(f"/api/v1/proposals/{pid}/accept")
        from app.core.database import db_connection
        with db_connection() as conn:
            line = service.active_goal_brief_line(conn)
    assert line is not None
    assert "Active Directory" in line


def test_brief_line_none_without_active_goal():
    with TestClient(app):
        from app.core.database import db_connection
        with db_connection() as conn:
            assert service.active_goal_brief_line(conn) is None
```

- [ ] **Step 2: Run — expect fail.**

- [ ] **Step 3a:** Add to `planning/service.py`:

```python
def active_goal_brief_line(conn: Connection) -> str | None:
    """Forward line for the daily brief: the most recently activated goal's next step + drift."""
    row = conn.execute(
        "SELECT g.id FROM goals g JOIN plans p ON p.id = g.active_plan_id "
        "WHERE g.status = 'active' ORDER BY p.activated_at DESC LIMIT 1"
    ).fetchone()
    if row is None:
        return None
    view = get_goal_plan(conn, row["id"])
    if not view:
        return None
    pending = [s for s in view["steps"] if s["progress"]["status"] != "done"]
    if not pending:
        return None
    nxt = min(pending, key=lambda s: s.get("sequence", 0))
    drift = view["drift"]
    note = "" if drift is None else (" · on track" if drift["on_track"] else " · behind — consider re-planning")
    return f"🎯 {view['goal']['title']}: next — {nxt['title']}{note}"
```

- [ ] **Step 3b:** In `communication/router.py::_compose_daily_brief`, append the plan line before the final `return`. Add the import at the top: `from app.modules.planning.service import active_goal_brief_line`, then in the function, before returning the joined lines:

```python
    from app.core.database import db_connection
    with db_connection() as conn:
        plan_line = active_goal_brief_line(conn)
    if plan_line:
        lines.append(plan_line)
```

(Insert this right before the `return "\n\n".join(lines)` — keep the existing `lines` list intact.)

- [ ] **Step 4: Run** forward-brief tests (2 pass); full suite; ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/planning/service.py backend/app/modules/communication/router.py backend/tests/test_forward_brief.py
git commit -m "feat(planning): forward daily brief (next step + drift)"
```

---

## Self-Review

**Spec coverage:** backlog fixes — module-required (T1 3c), time-scoped progress (T1 3a/3d), non-empty match (T1 3b); drift/projection (T2); re-plan versioned proposals + endpoint + idempotency + on-track/pending statuses (T3); forward brief (T4). Honest core: drift/next-step derived (T2/T4), re-plan advisory+versioned+422 (T3). All covered.

**Placeholder scan:** No placeholders; complete code throughout. (T2's drift test asserts structure + sign rather than exact fractions because "now" advances — deliberate and correct, not a gap.)

**Type consistency:** `evaluate_step(conn, step, since=None)` used with `since` in T1 tests + `get_goal_plan`; `compute_drift(goal, plan, actual_percent)` defined T2, used in `get_goal_plan` + `generate_replan_proposal`; `decompose_goal(goal, context=None)` extended T3, monkeypatched with `context=None` signature in T3/T4 tests; `generate_replan_proposal` returns a proposal dict or a `{"status": ...}` dict, matched by the router + tests; `active_goal_brief_line(conn)` defined T4, used in the brief.
```
