from fastapi.testclient import TestClient

from app.main import app


def _module_id(client: TestClient) -> str:
    return {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]


def _create_goal(client: TestClient, title: str = "Edit me") -> str:
    return client.post(
        "/api/v1/planning/goals",
        json={"title": title, "module_id": _module_id(client)},
    ).json()["id"]


def test_patch_goal_updates_fields():
    with TestClient(app) as client:
        goal_id = _create_goal(client)
        resp = client.patch(
            f"/api/v1/planning/goals/{goal_id}",
            json={"title": "Renamed goal", "target_date": "2026-12-31T00:00:00+00:00"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["title"] == "Renamed goal"
        assert body["target_date"] == "2026-12-31T00:00:00+00:00"
        # persisted
        again = client.get("/api/v1/planning/goals").json()
        assert any(g["id"] == goal_id and g["title"] == "Renamed goal" for g in again)


def test_patch_goal_unknown_module_404():
    with TestClient(app) as client:
        goal_id = _create_goal(client)
        resp = client.patch(f"/api/v1/planning/goals/{goal_id}", json={"module_id": "nope"})
        assert resp.status_code == 404


def test_patch_unknown_goal_404():
    with TestClient(app) as client:
        resp = client.patch("/api/v1/planning/goals/nope", json={"title": "x"})
        assert resp.status_code == 404


def test_delete_goal_abandons_and_hides_from_active():
    with TestClient(app) as client:
        goal_id = _create_goal(client, "To abandon")
        # make it active first so we prove it drops out of the active list
        client.patch(f"/api/v1/planning/goals/{goal_id}", json={"title": "Active-ish"})
        resp = client.delete(f"/api/v1/planning/goals/{goal_id}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "abandoned"
        active = client.get("/api/v1/planning/goals?status=active").json()
        assert all(g["id"] != goal_id for g in active)
        # still present (history) when queried by its status
        abandoned = client.get("/api/v1/planning/goals?status=abandoned").json()
        assert any(g["id"] == goal_id for g in abandoned)


def test_delete_unknown_goal_404():
    with TestClient(app) as client:
        resp = client.delete("/api/v1/planning/goals/nope")
        assert resp.status_code == 404
