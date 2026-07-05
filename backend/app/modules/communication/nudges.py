"""Proactive insight nudges — honest, real-data conditions only (v1).

1) Plan drift: a goal's active plan is behind (same drift computation
   request_replan uses — nothing invented).
2) Module inactivity: an active module with no logged activity for
   ATLAS_NUDGE_INACTIVITY_DAYS days.

Each (ref_type, ref_id) gets a 48h cooldown so the owner is never nagged twice
about the same thing; the dispatcher's daily nudge cap does the rest.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from sqlite3 import Connection
from zoneinfo import ZoneInfo

from app.core.config import get_settings
from app.core.database import db_connection, rows_to_dicts
from app.modules.communication.outbox import enqueue, in_quiet_hours
from app.modules.planning.service import get_goal_plan

COOLDOWN_HOURS = 48


def _now_local() -> datetime:
    return datetime.now(ZoneInfo(get_settings().timezone))


def _recently_nudged(conn: Connection, ref_type: str, ref_id: str) -> bool:
    cutoff = (datetime.now(UTC) - timedelta(hours=COOLDOWN_HOURS)).replace(microsecond=0).isoformat()
    row = conn.execute(
        "SELECT 1 FROM outbox WHERE kind = 'nudge' AND ref_type = ? AND ref_id = ? "
        "AND created_at >= ? LIMIT 1",
        (ref_type, ref_id, cutoff),
    ).fetchone()
    return row is not None


def generate_nudges(conn: Connection) -> list[dict]:
    created: list[dict] = []

    goals = rows_to_dicts(
        conn.execute(
            "SELECT * FROM goals WHERE status = 'active' AND active_plan_id IS NOT NULL"
        ).fetchall()
    )
    for goal in goals:
        view = get_goal_plan(conn, goal["id"]) or {}
        drift = view.get("drift")
        if drift is None or drift["on_track"]:
            continue
        if _recently_nudged(conn, "goal", goal["id"]):
            continue
        body = (
            f"📉 Goal '{goal['title']}' is behind plan: "
            f"{int(drift['actual_percent'] * 100)}% done vs "
            f"{int(drift['expected_percent'] * 100)}% expected. "
            "Reply or open Atlas to re-plan."
        )
        created.append(enqueue(conn, kind="nudge", body=body, ref_type="goal", ref_id=goal["id"]))

    days = get_settings().nudge_inactivity_days
    cutoff = (datetime.now(UTC) - timedelta(days=days)).replace(microsecond=0).isoformat()
    stale = conn.execute(
        """
        SELECT lm.id, lm.name FROM life_modules lm
        WHERE lm.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM activities a WHERE a.module_id = lm.id AND a.occurred_at >= ?
          )
        ORDER BY lm.name
        """,
        (cutoff,),
    ).fetchall()
    for module in stale:
        if _recently_nudged(conn, "module", module["id"]):
            continue
        body = f"⏳ '{module['name']}' — no logged activity in {days} days."
        created.append(enqueue(conn, kind="nudge", body=body, ref_type="module", ref_id=module["id"]))

    return created


def run_nudge_pass() -> list[dict]:
    """One scheduler-driven pass (opens its own connection). Skipped in quiet
    hours per the spec — nothing should even be generated overnight."""
    settings = get_settings()
    if in_quiet_hours(_now_local(), settings.quiet_hours_start, settings.quiet_hours_end):
        return []
    with db_connection() as conn:
        return generate_nudges(conn)
