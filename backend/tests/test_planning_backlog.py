import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.core.time import utc_now_iso
from app.main import app
from app.modules.planning.service import _completion_rule, create_goal, evaluate_step, propose_plan_for_goal
from app.shared.schemas import GoalCreate


def _oscp_module_id():
    with TestClient(app) as client:
        return {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]


def test_propose_plan_requires_module():
    # Initialize DB through TestClient
    with TestClient(app):
        pass
    with db_connection() as conn:
        goal = create_goal(conn, GoalCreate(title="No module goal"))
        with pytest.raises(HTTPException) as exc:
            propose_plan_for_goal(conn, goal["id"])
    assert exc.value.status_code == 422


def test_evaluate_step_since_excludes_older_activity():
    module_id = _oscp_module_id()
    with db_connection() as conn:
        old = new_id()
        conn.execute(
            "INSERT INTO activities (id, module_id, activity_type, title, occurred_at, duration_minutes, source, metadata, created_at, updated_at) "
            "VALUES (?, ?, 'study', 'AD old', '2020-01-01T00:00:00+00:00', 50, 'manual', '{}', ?, ?)",
            (old, module_id, utc_now_iso(), utc_now_iso()),
        )
        new = new_id()
        now = utc_now_iso()
        conn.execute(
            "INSERT INTO activities (id, module_id, activity_type, title, occurred_at, duration_minutes, source, metadata, created_at, updated_at) "
            "VALUES (?, ?, 'study', 'AD new', ?, 20, 'manual', '{}', ?, ?)",
            (new, module_id, now, now, now),
        )
        step = {"id": new_id(), "completion_rule": {"type": "duration", "module_id": module_id, "match": "ad", "target_minutes": 100}}
        all_time = evaluate_step(conn, step)
        since_now = evaluate_step(conn, step, since="2021-01-01T00:00:00+00:00")
    assert all_time["done"] == 70
    assert since_now["done"] == 20


def test_completion_rule_never_empty_match():
    rule = _completion_rule({"module_id": "m1"}, {"unit": "minutes", "target": 60, "title": "Active Directory"})
    assert rule["match"] == "active directory"
    rule2 = _completion_rule({"module_id": "m1"}, {"unit": "count", "target": 3, "title": "", "match": ""})
    assert "match" not in rule2
