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
