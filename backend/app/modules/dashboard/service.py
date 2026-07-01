"""Dashboard service layer.

Builds the "today" dashboard from real logged data. Lives in the service layer
(not the route handler) because the daily-brief flow and the scheduler also need
it — previously they imported the route function directly, a cross-module reach
into another module's router.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.config import get_settings
from app.core.database import db_connection, rows_to_dicts
from app.modules.life_modules.behavior import build_behavior


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

    recommendations = _build_recommendations(recent_activities, weekly_balance, active_modules)
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
        "recommendations": recommendations[:1],
    }


def _summary_number(module: dict, key: str, default: int = 0) -> int:
    value = ((module.get("behavior") or {}).get("summary") or {}).get(key, default)
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _module_recommendation(active_modules: list[dict]) -> dict | None:
    for module in active_modules:
        if module["type"] != "habit":
            continue
        weekly_target = max(1, _summary_number(module, "weekly_target", 3))
        weekly_completions = _summary_number(module, "weekly_completions")
        if weekly_completions < weekly_target:
            return {
                "severity": "warning" if weekly_completions == 0 else "info",
                "title": f"Complete {module['name']} once today",
                "body": (
                    f"{module['name']} is at {weekly_completions}/{weekly_target} this week. "
                    "One completion will protect the weekly rhythm."
                ),
            }

    for module in active_modules:
        if module["type"] != "learning":
            continue
        study_minutes = _summary_number(module, "study_minutes")
        units_done = _summary_number(module, "learning_units_done")
        units_total = _summary_number(module, "learning_units_total")
        if study_minutes < 45:
            return {
                "severity": "warning",
                "title": f"Study {module['name']} for 45 minutes",
                "body": (
                    f"{module['name']} has {study_minutes} study minutes this week. "
                    f"Current unit progress is {units_done}/{units_total}."
                ),
            }

    for module in active_modules:
        if module["type"] != "project":
            continue
        total_open = _summary_number(module, "total_open")
        total_done = _summary_number(module, "total_done")
        if total_open > 0:
            return {
                "severity": "info",
                "title": f"Close one {module['name']} item",
                "body": (
                    f"{module['name']} has {total_open} open items and {total_done} completed. "
                    "Pick one small task, bug, or feature and close it."
                ),
            }

    return None


def _build_recommendations(
    recent_activities: list[dict], weekly_balance: list[dict], active_modules: list[dict]
) -> list[dict]:
    by_slug = {item["discipline_slug"]: item for item in weekly_balance}
    learning_minutes = by_slug.get("learning", {}).get("duration_minutes", 0)
    recovery_minutes = by_slug.get("recovery", {}).get("duration_minutes", 0)
    work_minutes = by_slug.get("work", {}).get("duration_minutes", 0)

    module_recommendation = _module_recommendation(active_modules)
    if module_recommendation:
        return [module_recommendation]

    if learning_minutes == 0:
        return [
            {
                "severity": "warning",
                "title": "Study OSCP tonight",
                "body": "No learning activity is logged this week. If you have 45 minutes, use it for OSCP.",
            }
        ]
    if work_minutes > learning_minutes * 2 and learning_minutes < 180:
        return [
            {
                "severity": "info",
                "title": "Keep OSCP light but present",
                "body": "Work is dominating the week. A short OSCP session keeps the learning thread alive.",
            }
        ]
    if recovery_minutes == 0:
        return [
            {
                "severity": "warning",
                "title": "Protect recovery",
                "body": "No recovery activity is logged this week. Do a short physiotherapy session.",
            }
        ]
    if not recent_activities:
        return [
            {
                "severity": "info",
                "title": "Log one completed action",
                "body": "Atlas needs one real signal from today before making stronger recommendations.",
            }
        ]
    return [
        {
            "severity": "info",
            "title": "Stay with the current mission",
            "body": "Your week has signal. Choose the next small action instead of opening a new front.",
        }
    ]
