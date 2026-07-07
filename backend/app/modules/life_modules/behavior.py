from datetime import UTC, datetime, timedelta
from sqlite3 import Connection

# Module types whose state is honestly derived from logged sessions + recorded metrics
# (rather than a checklist of records). "good" tells the UI which direction is positive.
WELLBEING_TYPES: dict[str, dict] = {
    "recovery": {
        "activity_type": "recovery",
        "session_title": "Recovery session",
        "metrics": [
            {"key": "pain", "label": "Pain", "min": 1, "max": 10, "good": "low"},
            {"key": "mobility", "label": "Mobility", "min": 1, "max": 10, "good": "high"},
        ],
    },
    "relationship": {
        "activity_type": "relationship",
        "session_title": "Quality time",
        "metrics": [
            {"key": "quality", "label": "Quality", "min": 1, "max": 5, "good": "high"},
        ],
    },
}


def metric_stats(conn: Connection, module_id: str, metric_key: str, limit: int = 14) -> dict:
    values = [
        row["value_number"]
        for row in conn.execute(
            """
            SELECT value_number FROM metrics
            WHERE module_id = ? AND metric_key = ? AND value_number IS NOT NULL
            ORDER BY recorded_at DESC LIMIT ?
            """,
            (module_id, metric_key, limit),
        ).fetchall()
    ]
    return {
        "latest": values[0] if values else None,
        "avg": round(sum(values) / len(values), 1) if values else None,
        "count": len(values),
    }


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


def project_item_counts(conn: Connection, module_id: str) -> dict:
    """Open/done counts per item type, derived from real project_items records."""
    counts = {item_type: {"open": 0, "done": 0} for item_type in ("task", "bug", "feature")}
    rows = conn.execute(
        """
        SELECT item_type, status, COUNT(id) AS count
        FROM project_items
        WHERE module_id = ?
        GROUP BY item_type, status
        """,
        (module_id,),
    ).fetchall()
    for row in rows:
        bucket = counts.get(row["item_type"])
        if bucket is None:
            continue
        bucket["done" if row["status"] == "done" else "open"] += row["count"]
    return counts


def hobby_days_since_last(conn: Connection, module_id: str) -> int | None:
    row = conn.execute(
        "SELECT MAX(occurred_at) AS last FROM activities WHERE module_id = ?", (module_id,)
    ).fetchone()
    if not row["last"]:
        return None
    last_day = datetime.fromisoformat(row["last"]).date()
    return max(0, (datetime.now(UTC).date() - last_day).days)


def hobby_next_idea(conn: Connection, module_id: str) -> dict | None:
    """The suggestion: pinned open idea if any, else the oldest open idea."""
    row = conn.execute(
        """
        SELECT id, title FROM hobby_ideas
        WHERE module_id = ? AND status = 'open'
        ORDER BY pinned DESC, created_at ASC
        LIMIT 1
        """,
        (module_id,),
    ).fetchone()
    return {"id": row["id"], "title": row["title"]} if row else None


def build_behavior(conn: Connection, module: dict) -> dict:
    config = module.get("config") or {}
    activity = module_activity_summary(conn, module["id"])
    module_type = module["type"]

    if module_type == "project":
        counts = project_item_counts(conn, module["id"])
        tasks_open, tasks_done = counts["task"]["open"], counts["task"]["done"]
        bugs_open, bugs_done = counts["bug"]["open"], counts["bug"]["done"]
        features_open, features_done = counts["feature"]["open"], counts["feature"]["done"]
        total_open = tasks_open + bugs_open + features_open
        total_done = tasks_done + bugs_done + features_done
        total = total_open + total_done
        return {
            "module_id": module["id"],
            "type": module_type,
            "config": config,
            "summary": {
                **activity,
                "progress_percent": round((total_done / total) * 100) if total else 0,
                "tasks_open": tasks_open,
                "tasks_done": tasks_done,
                "bugs_open": bugs_open,
                "bugs_done": bugs_done,
                "features_open": features_open,
                "features_done": features_done,
                "total_done": total_done,
                "total_open": total_open,
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
        units = conn.execute(
            "SELECT COUNT(id) AS total, COALESCE(SUM(status = 'completed'), 0) AS done FROM learning_units WHERE module_id = ?",
            (module["id"],),
        ).fetchone()
        units_total = units["total"]
        units_done = units["done"]
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
                "progress_percent": round((units_done / units_total) * 100) if units_total else 0,
            },
        }

    if module_type == "hobby":
        ideas_open = conn.execute(
            "SELECT COUNT(id) AS count FROM hobby_ideas WHERE module_id = ? AND status = 'open'",
            (module["id"],),
        ).fetchone()["count"]
        return {
            "module_id": module["id"],
            "type": module_type,
            "config": config,
            "summary": {
                **activity,
                "days_since_last": hobby_days_since_last(conn, module["id"]),
                "ideas_open": ideas_open,
                "next_idea": hobby_next_idea(conn, module["id"]),
                "category": config.get("category") or "creative",
            },
        }

    if module_type in WELLBEING_TYPES:
        metric_summary = {
            definition["key"]: metric_stats(conn, module["id"], definition["key"])
            for definition in WELLBEING_TYPES[module_type]["metrics"]
        }
        return {
            "module_id": module["id"],
            "type": module_type,
            "config": config,
            "summary": {
                **activity,
                "sessions_week": activity["weekly_activity_count"],
                "metrics": metric_summary,
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
