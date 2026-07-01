from fastapi.testclient import TestClient

from app.main import app
from app.modules.planning import service

STEPS = {"rationale": "r", "steps": [
    {"kind": "topic", "title": "Active Directory", "sequence": 1, "unit": "minutes", "target": 60, "match": "active directory"},
]}


def test_brief_line_includes_next_step(monkeypatch):
    monkeypatch.setattr(service, "decompose_goal", lambda goal, context=None: STEPS)
    with TestClient(app) as client:
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
        goal_id = client.post("/api/v1/planning/goals", json={
            "title": "Pass OSCP", "module_id": module_id, "target_date": "2099-01-01T00:00:00+00:00",
        }).json()["id"]
        pid = client.post(f"/api/v1/planning/goals/{goal_id}/propose-plan").json()["id"]
        client.post(f"/api/v1/proposals/{pid}/accept")
        from app.core.database import db_connection
        with db_connection() as conn:
            line = service.active_goal_brief_line(conn)
    assert line is not None
    assert "Active Directory" in line


def test_brief_line_none_without_active_goal():
    with TestClient(app):
        from app.core.database import db_connection
        with db_connection() as conn:
            assert service.active_goal_brief_line(conn) is None
