from fastapi.testclient import TestClient

from app.main import app
from app.modules.planning import service

STEPS = [
    {"kind": "topic", "title": "Active Directory", "description": "AD", "sequence": 1, "unit": "minutes", "target": 60, "match": "active directory"},
]


def test_full_goal_to_plan_flow(monkeypatch):
    monkeypatch.setattr(service, "decompose_goal", lambda goal: {"rationale": "r", "steps": STEPS})
    with TestClient(app) as client:
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]

        goal = client.post("/api/v1/planning/goals", json={"title": "Pass OSCP", "module_id": module_id})
        assert goal.status_code == 201, goal.text
        goal_id = goal.json()["id"]

        proposal = client.post(f"/api/v1/planning/goals/{goal_id}/propose-plan")
        assert proposal.status_code == 200, proposal.text
        pid = proposal.json()["id"]
        assert proposal.json()["type"] == "activate_plan"

        accepted = client.post(f"/api/v1/proposals/{pid}/accept")
        assert accepted.status_code == 200

        client.post("/api/v1/activities", json={
            "module_id": module_id, "activity_type": "study",
            "title": "Active Directory enumeration", "duration_minutes": 30,
        })
        plan = client.get(f"/api/v1/planning/goals/{goal_id}/plan").json()
        assert plan["plan"]["status"] == "active"
        ad = next(s for s in plan["steps"] if s["title"] == "Active Directory")
        assert ad["progress"]["done"] == 30
        assert ad["progress"]["target"] == 60
        assert ad["progress"]["status"] == "in_progress"


def test_get_plan_404_when_none():
    with TestClient(app) as client:
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
        goal_id = client.post("/api/v1/planning/goals", json={"title": "No plan yet", "module_id": module_id}).json()["id"]
        assert client.get(f"/api/v1/planning/goals/{goal_id}/plan").status_code == 404
