import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import db_connection
from app.main import app
from app.modules.planning import service
from app.modules.planning.service import create_goal, propose_plan_for_goal
from app.shared.schemas import GoalCreate

STEPS = [
    {"kind": "topic", "title": "Active Directory", "description": "AD attacks", "sequence": 1, "unit": "minutes", "target": 600, "match": "active directory"},
    {"kind": "topic", "title": "Buffer Overflow", "description": "BOF", "sequence": 2, "unit": "count", "target": 3, "match": "overflow"},
]


def _goal_id(conn) -> str:
    with TestClient(app) as client:
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
    return create_goal(conn, GoalCreate(title="Pass OSCP", module_id=module_id))["id"]


def test_propose_plan_creates_proposed_plan_steps_and_proposal(monkeypatch):
    monkeypatch.setattr(service, "decompose_goal", lambda goal: {"rationale": "r", "steps": STEPS})
    with db_connection() as conn:
        goal_id = _goal_id(conn)
        proposal = propose_plan_for_goal(conn, goal_id)
        assert proposal["type"] == "activate_plan"
        plan_id = proposal["payload"]["plan_id"]
        plan = conn.execute("SELECT status, goal_id FROM plans WHERE id = ?", (plan_id,)).fetchone()
        steps = conn.execute(
            "SELECT title, completion_rule FROM plan_steps WHERE plan_id = ? ORDER BY sequence", (plan_id,)
        ).fetchall()
    assert plan["status"] == "proposed"
    assert len(steps) == 2
    import json
    rule0 = json.loads(steps[0]["completion_rule"])
    assert rule0["module_id"] is not None
    assert rule0["type"] in {"duration", "count"}


def test_propose_plan_without_llm_key_is_422(monkeypatch):
    monkeypatch.delenv("ATLAS_ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()
    with db_connection() as conn:
        goal_id = _goal_id(conn)
        with pytest.raises(HTTPException) as exc:
            propose_plan_for_goal(conn, goal_id)
    assert exc.value.status_code == 422
