"""Dashboard service layer.

Builds the "today" dashboard from real logged data. Lives in the service layer
(not the route handler) because the daily-brief flow and the scheduler also need
it — previously they imported the route function directly, a cross-module reach
into another module's router.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from sqlite3 import Connection
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.database import db_connection, new_id, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.life_modules.behavior import build_behavior
from app.shared.audit import record_audit_event

_SEVERITY_RANK = {"critical": 0, "warning": 1, "info": 2}


def get_today_dashboard() -> dict:
    # "Today" must mean the user's local calendar day (Asia/Jerusalem), not UTC —
    # otherwise an evening activity counts as "today" in the backend while the
    # frontend calendars (which group by local day) place it on the previous date.
    # We express the local-midnight boundary as a UTC instant so it compares
    # correctly against the UTC-stored occurred_at values.
    tz = ZoneInfo(get_settings().timezone)
    now_local = datetime.now(tz)
    today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC).isoformat()
    week_start = (datetime.now(UTC) - timedelta(days=7)).replace(microsecond=0).isoformat()
    with db_connection() as conn:
        recent_activities = rows_to_dicts(
            conn.execute(
                """
                SELECT
                  a.*,
                  d.name AS discipline_name,
                  d.slug AS discipline_slug,
                  d.color AS discipline_color,
                  lm.name AS module_name,
                  lm.slug AS module_slug,
                  lm.type AS module_type
                FROM activities a
                LEFT JOIN disciplines d ON d.id = a.discipline_id
                LEFT JOIN life_modules lm ON lm.id = a.module_id
                ORDER BY a.occurred_at DESC
                LIMIT 8
                """
            ).fetchall()
        )
        active_modules = rows_to_dicts(
            conn.execute(
                """
                SELECT lm.*, d.name AS discipline_name, d.slug AS discipline_slug, d.color AS discipline_color
                FROM life_modules lm
                JOIN disciplines d ON d.id = lm.discipline_id
                WHERE lm.status = 'active'
                ORDER BY lm.priority ASC, lm.name ASC
                LIMIT 8
                """
            ).fetchall()
        )
        active_modules = [{**module, "behavior": build_behavior(conn, module)} for module in active_modules]
        today_stats = conn.execute(
            """
            SELECT COUNT(id) AS activity_count, COALESCE(SUM(duration_minutes), 0) AS duration_minutes
            FROM activities
            WHERE occurred_at >= ?
            """,
            (today_start,),
        ).fetchone()
        week_stats = conn.execute(
            """
            SELECT COUNT(id) AS activity_count, COALESCE(SUM(duration_minutes), 0) AS duration_minutes
            FROM activities
            WHERE occurred_at >= ?
            """,
            (week_start,),
        ).fetchone()
        last_activity = conn.execute(
            """
            SELECT title, occurred_at
            FROM activities
            ORDER BY occurred_at DESC
            LIMIT 1
            """
        ).fetchone()
        weekly_balance = rows_to_dicts(
            conn.execute(
                """
                SELECT
                  d.id AS discipline_id,
                  d.name AS discipline_name,
                  d.slug AS discipline_slug,
                  d.color AS discipline_color,
                  COUNT(a.id) AS activity_count,
                  COALESCE(SUM(a.duration_minutes), 0) AS duration_minutes
                FROM disciplines d
                LEFT JOIN activities a
                  ON a.discipline_id = d.id
                 AND a.occurred_at >= ?
                WHERE d.is_active = 1
                GROUP BY d.id
                ORDER BY d.sort_order ASC, d.name ASC
                """,
                (week_start,),
            ).fetchall()
        )
        recommendations = build_recommendations(
            conn, recent_activities, weekly_balance, active_modules, today_start, today_stats["activity_count"]
        )

    return {
        "today_focus": {
            "question": "What is the best thing I should do right now?",
            "primary": recommendations[0]["title"] if recommendations else "Log one real action",
            "note": recommendations[0]["body"] if recommendations else "Start with a quick log to give Atlas signal.",
        },
        "real_signals": {
            "today_activity_count": today_stats["activity_count"],
            "today_duration_minutes": today_stats["duration_minutes"],
            "week_activity_count": week_stats["activity_count"],
            "week_duration_minutes": week_stats["duration_minutes"],
            "active_module_count": len(active_modules),
            "last_activity_title": last_activity["title"] if last_activity else None,
            "last_activity_at": last_activity["occurred_at"] if last_activity else None,
        },
        "recent_activities": recent_activities,
        "active_modules": active_modules,
        "weekly_balance": weekly_balance,
        "recommendations": recommendations,
    }


def _summary_number(module: dict, key: str, default: int = 0) -> int:
    value = ((module.get("behavior") or {}).get("summary") or {}).get(key, default)
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def build_recommendations(
    conn: Connection,
    recent_activities: list[dict],
    weekly_balance: list[dict],
    active_modules: list[dict],
    today_start: str,
    today_activity_count: int,
) -> list[dict]:
    """Generalized, ranked, keyed recommendations derived from real signals across
    the user's own modules/goals/disciplines. Recommendations whose key received
    feedback today are snoozed (see _snoozed_keys)."""
    from app.modules.planning.service import get_goal_plan

    candidates: list[dict] = []

    def add(key: str, severity: str, title: str, body: str) -> None:
        candidates.append({"key": key, "severity": severity, "title": title, "body": body, "_order": len(candidates)})

    for module in active_modules:
        if module["type"] == "habit":
            target = max(1, _summary_number(module, "weekly_target", 3))
            done = _summary_number(module, "weekly_completions")
            if done < target:
                add(
                    f"habit_behind:{module['id']}",
                    "warning" if done == 0 else "info",
                    f"Complete {module['name']} once today",
                    f"{module['name']} is at {done}/{target} this week. One completion protects the weekly rhythm.",
                )
        elif module["type"] == "learning":
            minutes = _summary_number(module, "study_minutes")
            if minutes < 45:
                units_done = _summary_number(module, "learning_units_done")
                units_total = _summary_number(module, "learning_units_total")
                add(
                    f"learning_light:{module['id']}",
                    "warning",
                    f"Study {module['name']} for 45 minutes",
                    f"{module['name']} has {minutes} study minutes this week. Unit progress {units_done}/{units_total}.",
                )
        elif module["type"] == "project":
            total_open = _summary_number(module, "total_open")
            if total_open > 0:
                total_done = _summary_number(module, "total_done")
                add(
                    f"project_open:{module['id']}",
                    "info",
                    f"Close one {module['name']} item",
                    f"{module['name']} has {total_open} open and {total_done} done. Pick one small item and close it.",
                )

    active_goals = rows_to_dicts(
        conn.execute("SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC").fetchall()
    )
    for goal in active_goals:
        plan = get_goal_plan(conn, goal["id"])
        drift = plan.get("drift") if plan else None
        if drift and drift.get("on_track") is False:
            add(
                f"goal_drift:{goal['id']}",
                "warning",
                f"{goal['title']} is behind schedule",
                f"You're at {int(drift['actual_percent'] * 100)}% vs {int(drift['expected_percent'] * 100)}% "
                "expected. Push the next step or re-plan.",
            )

    stale_cutoff = (datetime.now(UTC) - timedelta(days=14)).replace(microsecond=0).isoformat()
    for module in active_modules:
        fresh = conn.execute(
            "SELECT 1 FROM activities WHERE module_id = ? AND occurred_at >= ? LIMIT 1",
            (module["id"], stale_cutoff),
        ).fetchone()
        if not fresh:
            add(
                f"stale_module:{module['id']}",
                "warning",
                f"Re-engage {module['name']}",
                f"No activity logged for {module['name']} in 14 days. A small session revives it.",
            )

    active_slugs = {module["discipline_slug"] for module in active_modules}
    for balance in weekly_balance:
        if balance["discipline_slug"] in active_slugs and (balance.get("duration_minutes") or 0) == 0:
            add(
                f"discipline_gap:{balance['discipline_slug']}",
                "info",
                f"Invest in {balance['discipline_name']} this week",
                f"No time logged in {balance['discipline_name']} this week. A short session keeps it alive.",
            )

    if today_activity_count == 0:
        add(
            "log_nudge",
            "info",
            "Log one real action",
            "Atlas needs one real signal from today before making stronger recommendations.",
        )

    snoozed = _snoozed_keys(conn, today_start)
    visible = [c for c in candidates if c["key"] not in snoozed]
    visible.sort(key=lambda c: (_SEVERITY_RANK.get(c["severity"], 9), c["_order"]))
    return [{"key": c["key"], "severity": c["severity"], "title": c["title"], "body": c["body"]} for c in visible[:5]]


def _snoozed_keys(conn: Connection, today_start: str) -> set[str]:
    rows = conn.execute(
        "SELECT DISTINCT rec_key FROM recommendation_feedback WHERE created_at >= ?", (today_start,)
    ).fetchall()
    return {row["rec_key"] for row in rows}


def record_recommendation_feedback(conn: Connection, rec_key: str, action: str) -> dict:
    if action not in {"dismissed", "helpful"}:
        raise HTTPException(status_code=422, detail="action must be 'dismissed' or 'helpful'")
    conn.execute(
        "INSERT INTO recommendation_feedback (id, rec_key, action, created_at) VALUES (?, ?, ?, ?)",
        (new_id(), rec_key, action, utc_now_iso()),
    )
    record_audit_event(
        conn,
        entity_type="recommendation",
        entity_id=rec_key,
        action=action,
        summary=f"Recommendation {action}: {rec_key}",
        changes={},
    )
    return {"rec_key": rec_key, "action": action}
