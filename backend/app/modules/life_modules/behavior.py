from datetime import UTC, datetime, timedelta
from sqlite3 import Connection


def clamp_percent(value: object) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, number))


def int_config(config: dict, key: str, default: int = 0) -> int:
    try:
        return int(config.get(key, default))
    except (TypeError, ValueError):
        return default


def module_activity_summary(conn: Connection, module_id: str) -> dict:
    week_start = (datetime.now(UTC) - timedelta(days=7)).replace(microsecond=0).isoformat()
    row = conn.execute(
        """
        SELECT COUNT(id) AS count, COALESCE(SUM(duration_minutes), 0) AS minutes
        FROM activities
        WHERE module_id = ? AND occurred_at >= ?
        """,
        (module_id, week_start),
    ).fetchone()
    return {"weekly_activity_count": row["count"], "weekly_minutes": row["minutes"]}


def habit_streak(conn: Connection, module_id: str) -> int:
    rows = conn.execute(
        """
        SELECT DISTINCT substr(occurred_at, 1, 10) AS activity_day
        FROM activities
        WHERE module_id = ?
        ORDER BY activity_day DESC
        LIMIT 30
        """,
        (module_id,),
    ).fetchall()
    activity_days = {row["activity_day"] for row in rows}
    streak = 0
    cursor = datetime.now(UTC).date()
    if cursor.isoformat() not in activity_days:
        cursor = cursor - timedelta(days=1)
    while cursor.isoformat() in activity_days:
        streak += 1
        cursor = cursor - timedelta(days=1)
    return streak


def build_behavior(conn: Connection, module: dict) -> dict:
    config = module.get("config") or {}
    activity = module_activity_summary(conn, module["id"])
    module_type = module["type"]

    if module_type == "project":
        tasks_open = int_config(config, "tasks_open")
        tasks_done = int_config(config, "tasks_done")
        bugs_open = int_config(config, "bugs_open")
        bugs_done = int_config(config, "bugs_done")
        features_open = int_config(config, "features_open")
        features_done = int_config(config, "features_done")
        return {
            "module_id": module["id"],
            "type": module_type,
            "config": config,
            "summary": {
                **activity,
                "progress_percent": clamp_percent(config.get("progress_percent", 0)),
                "tasks_open": tasks_open,
                "tasks_done": tasks_done,
                "bugs_open": bugs_open,
                "bugs_done": bugs_done,
                "features_open": features_open,
                "features_done": features_done,
                "total_done": tasks_done + bugs_done + features_done,
                "total_open": tasks_open + bugs_open + features_open,
            },
        }

    if module_type == "habit":
        weekly_target = max(1, int_config(config, "weekly_target", 3))
        completions = activity["weekly_activity_count"]
        return {
            "module_id": module["id"],
            "type": module_type,
            "config": config,
            "summary": {
                **activity,
                "weekly_target": weekly_target,
                "weekly_completions": completions,
                "streak_days": habit_streak(conn, module["id"]),
                "progress_percent": min(100, round((completions / weekly_target) * 100)),
            },
        }

    if module_type == "learning":
        units_total = int_config(config, "learning_units_total")
        units_done = int_config(config, "learning_units_done")
        progress = clamp_percent(config.get("progress_percent", round((units_done / units_total) * 100) if units_total else 0))
        return {
            "module_id": module["id"],
            "type": module_type,
            "config": config,
            "summary": {
                **activity,
                "study_sessions": activity["weekly_activity_count"],
                "study_minutes": activity["weekly_minutes"],
                "learning_units_total": units_total,
                "learning_units_done": units_done,
                "progress_percent": progress,
            },
        }

    return {
        "module_id": module["id"],
        "type": module_type,
        "config": config,
        "summary": {
            **activity,
            "placeholder": True,
            "message": "Placeholder module type for MVP.",
        },
    }
