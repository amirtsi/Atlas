"""Obsidian projection.

Renders Atlas's real data as markdown inside a dedicated `Atlas/` folder in the
user's Obsidian vault: one daily note per day (activities, stats, brief line,
goal next-step) and one note per non-abandoned goal (plan checkboxes with real
progress + drift). Notes are derived FULL REWRITES — the ledger stays the single
source of truth; frontmatter marks every file as generated so manual edits are
knowingly ephemeral. Atlas never writes or deletes anything outside `Atlas/`.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from app.core.config import get_settings
from app.core.database import db_connection, rows_to_dicts
from app.shared.audit import record_audit_event

GENERATED_MARKER = "generated_by: atlas"

_HEBREW_WEEKDAYS = {0: "יום שני", 1: "יום שלישי", 2: "יום רביעי", 3: "יום חמישי", 4: "יום שישי", 5: "שבת", 6: "יום ראשון"}


def vault_ready() -> Path | None:
    """The Atlas-owned folder inside the configured vault, or None (feature off)."""
    vault = get_settings().obsidian_vault.strip()
    if not vault:
        return None
    root = Path(vault).expanduser() / "Atlas"
    (root / "Daily").mkdir(parents=True, exist_ok=True)
    (root / "Goals").mkdir(parents=True, exist_ok=True)
    return root


def safe_filename(title: str) -> str:
    """Sanitize a note title into a filename. Hebrew/unicode is fine in Obsidian;
    only path-hostile characters and leading dots are stripped."""
    cleaned = re.sub(r'[\\/:*?"<>|]', " ", title)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lstrip(".")
    return cleaned or "untitled"


def render_daily_note(date_label: str, date_iso: str, activities: list[dict], signals: dict, brief_lines: list[str]) -> str:
    lines = [
        "---",
        GENERATED_MARKER,
        "type: atlas-daily",
        f"date: {date_iso}",
        "---",
        f"# Atlas · {date_label}",
        "",
        "## פעולות",
    ]
    if activities:
        for activity in activities:
            time_part = (activity.get("occurred_at") or "")[11:16]
            bits = [activity.get("title") or "פעולה"]
            if activity.get("module_name"):
                bits.append(str(activity["module_name"]))
            if activity.get("duration_minutes"):
                bits.append(f"{activity['duration_minutes']}ד׳")
            lines.append(f"- **{time_part}** " + " · ".join(bits))
    else:
        lines.append("- אין פעולות שנרשמו היום (עדיין).")
    lines += [
        "",
        "## סיכום",
        f"- היום: {signals.get('today_activity_count', 0)} פעולות · {signals.get('today_duration_minutes', 0)}ד׳"
        f" | השבוע: {signals.get('week_activity_count', 0)} פעולות · {signals.get('week_duration_minutes', 0)}ד׳",
    ]
    lines += [f"- {line}" for line in brief_lines if line]
    return "\n".join(lines) + "\n"


def render_goal_note(goal: dict, plan_view: dict | None) -> str:
    progress = plan_view["overall_percent"] if plan_view else 0
    lines = [
        "---",
        GENERATED_MARKER,
        "type: atlas-goal",
        f"status: {goal.get('status')}",
        f"target_date: {(goal.get('target_date') or '')[:10]}",
        f"progress: {progress}",
        "---",
        f"# 🎯 {goal.get('title')}",
        "",
    ]
    status_bits = [f"**סטטוס:** {goal.get('status')}", f"**התקדמות:** {progress}%"]
    drift = (plan_view or {}).get("drift")
    if drift:
        label = "בזמן" if drift.get("on_track") else "מאחור"
        status_bits.append(
            f"**סטייה:** {label} (צפוי {round(drift['expected_percent'] * 100)}% · בפועל {round(drift['actual_percent'] * 100)}%)"
        )
    lines.append(" · ".join(status_bits))
    lines.append("")
    if plan_view:
        lines.append(f"## תוכנית (v{plan_view['plan'].get('version', 1)})")
        for step in plan_view["steps"]:
            progress_info = step.get("progress") or {}
            box = "x" if progress_info.get("status") == "done" else " "
            unit = "ד׳" if (step.get("completion_rule") or {}).get("type") == "duration" else ""
            lines.append(f"- [{box}] {step.get('title')} — {progress_info.get('done', 0)}/{progress_info.get('target', 0)}{unit}")
    else:
        lines.append("_אין תוכנית עדיין._")
    return "\n".join(lines) + "\n"


def export_to_vault() -> dict:
    """Write today's daily note + one note per non-abandoned goal; prune generated
    goal notes whose goal is gone/abandoned. Constrained to the Atlas/ folder."""
    from app.modules.dashboard.service import get_today_dashboard
    from app.modules.planning.service import active_goal_brief_line, get_goal_plan

    root = vault_ready()
    if root is None:
        return {"configured": False, "written": [], "pruned": []}

    settings = get_settings()
    tz = ZoneInfo(settings.timezone)
    now_local = datetime.now(tz)
    date_iso = now_local.date().isoformat()
    date_label = f"{_HEBREW_WEEKDAYS[now_local.weekday()]} {now_local.day}.{now_local.month}.{now_local.year}"
    today_start_utc = now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC).isoformat()

    dashboard = get_today_dashboard()
    written: list[str] = []

    with db_connection() as conn:
        today_activities = rows_to_dicts(
            conn.execute(
                """
                SELECT a.*, lm.name AS module_name
                FROM activities a LEFT JOIN life_modules lm ON lm.id = a.module_id
                WHERE a.occurred_at >= ? ORDER BY a.occurred_at DESC
                """,
                (today_start_utc,),
            ).fetchall()
        )
        brief_lines: list[str] = []
        top = (dashboard.get("recommendations") or [None])[0]
        if top:
            brief_lines.append(f"⭐ {top['title']} — {top['body']}")
        goal_line = active_goal_brief_line(conn)
        goals = rows_to_dicts(
            conn.execute("SELECT * FROM goals WHERE status != 'abandoned' ORDER BY created_at DESC").fetchall()
        )
        goal_views = {goal["id"]: (goal, get_goal_plan(conn, goal["id"])) for goal in goals}

    if goal_line:
        # Rewrite the plain goal line as a wikilink so the daily note joins the graph.
        for goal, _ in goal_views.values():
            title = goal.get("title") or ""
            if title and title in goal_line:
                goal_line = goal_line.replace(title, f"[[Atlas/Goals/{safe_filename(title)}|{title}]]", 1)
                break
        brief_lines.append(goal_line)

    daily_path = root / "Daily" / f"{date_iso}.md"
    daily_path.write_text(
        render_daily_note(date_label, date_iso, today_activities, dashboard.get("real_signals") or {}, brief_lines),
        encoding="utf-8",
    )
    written.append(str(daily_path.relative_to(root.parent)))

    expected_goal_files: set[str] = set()
    for goal, plan_view in goal_views.values():
        filename = f"{safe_filename(goal.get('title') or goal['id'])}.md"
        expected_goal_files.add(filename)
        goal_path = root / "Goals" / filename
        goal_path.write_text(render_goal_note(goal, plan_view), encoding="utf-8")
        written.append(str(goal_path.relative_to(root.parent)))

    # Prune: only generated files, only inside Atlas/Goals/, only when orphaned.
    pruned: list[str] = []
    for existing in (root / "Goals").glob("*.md"):
        if existing.name in expected_goal_files:
            continue
        try:
            head = existing.read_text(encoding="utf-8", errors="ignore")[:200]
        except OSError:
            continue
        if GENERATED_MARKER in head:
            existing.unlink()
            pruned.append(str(existing.relative_to(root.parent)))

    with db_connection() as conn:
        record_audit_event(
            conn,
            entity_type="obsidian_export",
            entity_id=date_iso,
            action="exported",
            summary=f"Obsidian export: {len(written)} notes written, {len(pruned)} pruned",
            changes={"written": len(written), "pruned": len(pruned)},
        )
    return {"configured": True, "written": written, "pruned": pruned}
