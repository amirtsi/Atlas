from fastapi.testclient import TestClient

from app.main import app
from app.modules.planning import service

STEPS = {"rationale": "adjusted", "steps": [
    {"kind": "topic", "title": "AD", "sequence": 1, "unit": "minutes", "target": 60, "match": "ad"},
]}


def _dated_goal_with_active_plan(client, monkeypatch):
    monkeypatch.setattr(service, "decompose_goal", lambda goal, context=None: STEPS)
    module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
    goal_id = client.post("/api/v1/planning/goals", json={
        "title": "Pass OSCP", "module_id": module_id, "target_date": "2020-01-10T00:00:00+00:00",
    }).json()["id"]
    pid = client.post(f"/api/v1/planning/goals/{goal_id}/propose-plan").json()["id"]
    client.post(f"/api/v1/proposals/{pid}/accept")
    return goal_id


def test_replan_when_behind_creates_v2(monkeypatch):
    with TestClient(app) as client:
        goal_id = _dated_goal_with_active_plan(client, monkeypatch)
        resp = client.post(f"/api/v1/planning/goals/{goal_id}/replan").json()
        assert resp["type"] == "activate_plan"
        assert resp["payload"]["plan_id"]
        again = client.post(f"/api/v1/planning/goals/{goal_id}/replan").json()
        assert again.get("status") == "replan_pending"


def test_replan_on_track_returns_status(monkeypatch):
    with TestClient(app) as client:
        monkeypatch.setattr(service, "decompose_goal", lambda goal, context=None: STEPS)
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
        goal_id = client.post("/api/v1/planning/goals", json={
            "title": "Later", "module_id": module_id, "target_date": "2099-01-01T00:00:00+00:00",
        }).json()["id"]
        pid = client.post(f"/api/v1/planning/goals/{goal_id}/propose-plan").json()["id"]
        client.post(f"/api/v1/proposals/{pid}/accept")
        resp = client.post(f"/api/v1/planning/goals/{goal_id}/replan").json()
        assert resp.get("status") == "on_track"
