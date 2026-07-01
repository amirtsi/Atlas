from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.core.time import utc_now_iso
from app.main import app
from app.modules.planning.service import create_goal, evaluate_step
from app.shared.schemas import GoalCreate


def _seed_goal_module() -> str:
    with TestClient(app) as client:
        return {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]


def _log(conn, module_id, title, minutes, activity_type="study"):
    aid = new_id()
    now = utc_now_iso()
    conn.execute(
        "INSERT INTO activities (id, module_id, activity_type, title, occurred_at, duration_minutes, source, metadata, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 'manual', '{}', ?, ?)",
        (aid, module_id, activity_type, title, now, minutes, now, now),
    )
    return aid


def test_create_goal_is_draft():
    module_id = _seed_goal_module()
    with db_connection() as conn:
        goal = create_goal(conn, GoalCreate(title="Pass OSCP", module_id=module_id))
    assert goal["status"] == "draft"
    assert goal["title"] == "Pass OSCP"


def test_evaluate_duration_rule_sums_matching_minutes():
    module_id = _seed_goal_module()
    with db_connection() as conn:
        _log(conn, module_id, "AD enumeration lab", 40)
        _log(conn, module_id, "Buffer overflow", 30)
        step = {
            "id": new_id(),
            "completion_rule": {"type": "duration", "module_id": module_id, "match": "ad", "target_minutes": 60},
        }
        result = evaluate_step(conn, step)
    assert result["done"] == 40
    assert result["target"] == 60
    assert result["status"] == "in_progress"


def test_evaluate_count_rule_and_done_status():
    module_id = _seed_goal_module()
    with db_connection() as conn:
        _log(conn, module_id, "box 1", 20)
        _log(conn, module_id, "box 2", 20)
        step = {"id": new_id(), "completion_rule": {"type": "count", "module_id": module_id, "match": "box", "target_count": 2}}
        result = evaluate_step(conn, step)
    assert result["done"] == 2
    assert result["status"] == "done"
    assert result["ratio"] == 1.0


def test_evaluate_empty_is_pending():
    module_id = _seed_goal_module()
    with db_connection() as conn:
        step = {"id": new_id(), "completion_rule": {"type": "duration", "module_id": module_id, "target_minutes": 100}}
        result = evaluate_step(conn, step)
    assert result["done"] == 0
    assert result["status"] == "pending"
