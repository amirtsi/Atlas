"""Goals & Plans engine.

Goals and (versioned) plans; plan progress derived from real activities. The plan
is advisory (proposed via the P1 inbox); the position is a query over the ledger.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from sqlite3 import Connection
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.database import new_id
from app.core.time import utc_now_iso
from app.modules.proposals.service import register_proposal_handler
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


def evaluate_step(conn: Connection, step: dict, since: str | None = None) -> dict:
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
        if since:
            where.append("a.occurred_at >= ?")
            params.append(since)
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


def _activate_plan_handler(conn: Connection, payload: dict) -> dict:
    plan_id = payload["plan_id"]
    plan = get_or_404(conn, "plans", plan_id)
    now = utc_now_iso()
    goal_id = plan["goal_id"]
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


_DECOMPOSE_SYSTEM = (
    "You are a planning assistant. Decompose the user's goal into a concrete, sequenced "
    "plan. Reply with ONLY JSON: {\"rationale\": string, \"steps\": [{\"kind\": "
    "\"phase\"|\"topic\"|\"practice\"|\"milestone\", \"title\": string, \"description\": "
    "string, \"sequence\": int, \"unit\": \"minutes\"|\"count\", \"target\": int, "
    "\"match\": string}]}. 'match' is a short lowercase keyword found in activity titles "
    "for that step. 6-12 steps. No prose outside the JSON."
)


def decompose_goal(goal: dict, context: str | None = None) -> dict | None:
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
            "adjustment": context,
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
    since = plan["activated_at"] if plan["status"] == "active" else None
    for step in steps:
        step["progress"] = evaluate_step(conn, step, since=since)
    done = sum(1 for s in steps if s["progress"]["status"] == "done")
    overall = round(100 * done / len(steps)) if steps else 0
    drift = compute_drift(goal, plan, overall / 100)
    return {"goal": goal, "plan": plan, "steps": steps, "overall_percent": overall, "drift": drift}


def propose_plan_for_goal(conn: Connection, goal_id: str, created_by: str = "system") -> dict:
    from app.modules.proposals.service import create_proposal

    goal = get_or_404(conn, "goals", goal_id)
    if not goal.get("module_id"):
        raise HTTPException(status_code=422, detail="Goal needs a module before planning")
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
        {"plan_id": plan_id}, created_by=created_by,
    )
    conn.execute("UPDATE plans SET source_proposal_id = ? WHERE id = ?", (proposal["id"], plan_id))
    return proposal


def generate_replan_proposal(conn: Connection, goal_id: str, created_by: str = "system") -> dict:
    from app.modules.proposals.service import create_proposal

    plan_view = get_goal_plan(conn, goal_id)
    if plan_view is None or plan_view["plan"]["status"] != "active":
        raise HTTPException(status_code=404, detail="Goal has no active plan to re-plan")
    drift = plan_view["drift"]
    if drift is not None and drift["on_track"]:
        return {"status": "on_track"}
    if drift is None:
        # Check if target date is in the past; if so, treat as behind schedule
        goal = plan_view["goal"]
        target = _parse_iso(goal.get("target_date"))
        now = datetime.now(UTC)
        if not target or target >= now:
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
    if drift:
        context = (
            f"Behind schedule: {int(drift['actual_percent'] * 100)}% done vs "
            f"{int(drift['expected_percent'] * 100)}% expected. Produce an adjusted, realistic plan."
        )
    else:
        context = "Deadline passed. Produce an adjusted, realistic plan."
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
        decomposed.get("rationale") or context, {"plan_id": plan_id}, created_by=created_by,
    )
    conn.execute("UPDATE plans SET source_proposal_id = ? WHERE id = ?", (proposal["id"], plan_id))
    return proposal


def _parse_iso(value: str | None):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


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
        projected = (activated + (now - activated) / actual_percent).replace(microsecond=0).isoformat()
    return {
        "expected_percent": round(expected, 3),
        "actual_percent": round(actual_percent, 3),
        "drift": drift,
        "projected_completion": projected,
        "on_track": drift >= -0.15,
    }


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
