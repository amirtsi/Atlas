"""Obsidian projection: pure renderers + vault export safety."""

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app
from app.modules.obsidian.service import GENERATED_MARKER, render_daily_note, render_goal_note, safe_filename


def test_render_daily_note_lists_real_activities():
    note = render_daily_note(
        "יום חמישי 2.7.2026",
        "2026-07-02",
        [{"title": "אימון כוח", "module_name": "Gym", "duration_minutes": 50, "occurred_at": "2026-07-02T18:00:00+00:00"}],
        {"today_activity_count": 1, "today_duration_minutes": 50, "week_activity_count": 10, "week_duration_minutes": 600},
        ["⭐ Complete Gym once today — one completion protects the rhythm."],
    )
    assert GENERATED_MARKER in note
    assert "**18:00** אימון כוח · Gym · 50ד׳" in note
    assert "השבוע: 10 פעולות · 600ד׳" in note
    assert "⭐ Complete Gym" in note


def test_render_goal_note_checkboxes_and_drift():
    plan_view = {
        "overall_percent": 50,
        "plan": {"version": 2},
        "drift": {"on_track": False, "expected_percent": 0.6, "actual_percent": 0.4},
        "steps": [
            {"title": "Enumeration", "completion_rule": {"type": "duration"}, "progress": {"status": "done", "done": 120, "target": 120}},
            {"title": "AD attacks", "completion_rule": {"type": "duration"}, "progress": {"status": "in_progress", "done": 30, "target": 60}},
        ],
    }
    note = render_goal_note({"title": "Pass OSCP", "status": "active", "target_date": "2026-09-30T00:00:00+00:00"}, plan_view)
    assert "- [x] Enumeration — 120/120ד׳" in note
    assert "- [ ] AD attacks — 30/60ד׳" in note
    assert "מאחור" in note and "60%" in note
    # no drift -> no drift segment
    plan_view["drift"] = None
    assert "סטייה" not in render_goal_note({"title": "G", "status": "active"}, plan_view)


def test_safe_filename_strips_hostile_characters():
    assert safe_filename('a/b\\c:d*e?f"g<h>i|j') == "a b c d e f g h i j"
    assert safe_filename("..hidden") == "hidden"
    assert safe_filename("מטרה בעברית") == "מטרה בעברית"


def test_export_disabled_without_vault():
    with TestClient(app) as client:
        result = client.post("/api/v1/obsidian/export").json()
    assert result == {"configured": False, "written": [], "pruned": []}


def test_export_writes_prunes_and_respects_user_files(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    monkeypatch.setenv("ATLAS_OBSIDIAN_VAULT", str(vault))
    get_settings.cache_clear()

    with TestClient(app) as client:
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
        client.post("/api/v1/planning/goals", json={"title": "Pass OSCP", "module_id": module_id})

        # a stale generated note (orphaned goal) and a user-authored note
        goals_dir = vault / "Atlas" / "Goals"
        goals_dir.mkdir(parents=True, exist_ok=True)
        (goals_dir / "Old goal.md").write_text(f"---\n{GENERATED_MARKER}\n---\nstale", encoding="utf-8")
        (goals_dir / "My own note.md").write_text("my private thoughts", encoding="utf-8")

        result = client.post("/api/v1/obsidian/export").json()
        again = client.post("/api/v1/obsidian/export").json()

    assert result["configured"] is True
    daily_files = list((vault / "Atlas" / "Daily").glob("*.md"))
    assert len(daily_files) == 1
    assert (goals_dir / "Pass OSCP.md").exists()
    assert "Atlas/Goals/Old goal.md" in result["pruned"]
    assert (goals_dir / "My own note.md").exists()  # user file untouched
    # idempotent: same files, nothing newly pruned
    assert again["pruned"] == []
    assert sorted(again["written"]) == sorted(result["written"])
    # status endpoint reflects configuration
    get_settings.cache_clear()
