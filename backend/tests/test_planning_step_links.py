from fastapi.testclient import TestClient

from app.main import app
from app.modules.planning import service

STEP = {"rationale": "x", "steps": [{"kind": "topic", "title": "AD", "sequence": 1, "unit": "minutes", "target": 60}]}


def _oscp(client: TestClient) -> str:
    return {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]


def _active_plan_step(client: TestClient, monkeypatch) -> tuple[str, str, str]:
    monkeypatch.setattr(service, "decompose_goal", lambda goal, context=None: STEP)
    module_id = _oscp(client)
    goal_id = client.post("/api/v1/planning/goals", json={"title": "G", "module_id": module_id}).json()["id"]
    pid = client.post(f"/api/v1/planning/goals/{goal_id}/propose-plan").json()["id"]
    client.post(f"/api/v1/proposals/{pid}/accept")
    plan = client.get(f"/api/v1/planning/goals/{goal_id}/plan").json()
    return goal_id, plan["steps"][0]["id"], module_id


def _log_activity(client: TestClient, module_id: str, title: str, minutes: int) -> str:
    return client.post(
        "/api/v1/activities",
        json={"module_id": module_id, "activity_type": "study", "title": title, "duration_minutes": minutes},
    ).json()["id"]


def test_link_credits_activity_and_unlink_reverts(monkeypatch):
    with TestClient(app) as client:
        goal_id, step_id, module_id = _active_plan_step(client, monkeypatch)
        # Activity the rule (match "ad") does NOT auto-match, so it only counts once linked.
        activity_id = _log_activity(client, module_id, "Report writing", 40)

        before = client.get(f"/api/v1/planning/goals/{goal_id}/plan").json()["steps"][0]
        assert before["progress"]["done"] == 0
        assert before["linked_activity_ids"] == []

        resp = client.post(f"/api/v1/planning/steps/{step_id}/links", json={"activity_id": activity_id})
        assert resp.status_code == 200, resp.text
        assert activity_id in resp.json()["linked_activity_ids"]

        linked = client.get(f"/api/v1/planning/goals/{goal_id}/plan").json()["steps"][0]
        assert linked["progress"]["done"] == 40
        assert activity_id in linked["linked_activity_ids"]

        r2 = client.delete(f"/api/v1/planning/steps/{step_id}/links/{activity_id}")
        assert r2.status_code == 200
        assert activity_id not in r2.json()["linked_activity_ids"]
        after = client.get(f"/api/v1/planning/goals/{goal_id}/plan").json()["steps"][0]
        assert after["progress"]["done"] == 0


def test_link_is_idempotent(monkeypatch):
    with TestClient(app) as client:
        _, step_id, module_id = _active_plan_step(client, monkeypatch)
        activity_id = _log_activity(client, module_id, "lab time", 10)
        client.post(f"/api/v1/planning/steps/{step_id}/links", json={"activity_id": activity_id})
        resp = client.post(f"/api/v1/planning/steps/{step_id}/links", json={"activity_id": activity_id})
        assert resp.status_code == 200
        assert resp.json()["linked_activity_ids"].count(activity_id) == 1


def test_link_unknown_step_404(monkeypatch):
    with TestClient(app) as client:
        module_id = _oscp(client)
        activity_id = _log_activity(client, module_id, "x", 10)
        resp = client.post("/api/v1/planning/steps/nope/links", json={"activity_id": activity_id})
        assert resp.status_code == 404


def test_link_unknown_activity_404(monkeypatch):
    with TestClient(app) as client:
        _, step_id, _ = _active_plan_step(client, monkeypatch)
        resp = client.post(f"/api/v1/planning/steps/{step_id}/links", json={"activity_id": "nope"})
        assert resp.status_code == 404
