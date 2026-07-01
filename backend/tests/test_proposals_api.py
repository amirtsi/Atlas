from fastapi.testclient import TestClient

from app.main import app


def test_create_list_accept_flow():
    with TestClient(app) as client:
        module = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["gym"]
        created = client.post(
            "/api/v1/proposals",
            json={
                "type": "set_module_priority",
                "title": "Bump Gym to 1",
                "rationale": "focus",
                "payload": {"module_id": module["id"], "priority": 1},
            },
        )
        assert created.status_code == 201, created.text
        pid = created.json()["id"]

        pending = client.get("/api/v1/proposals").json()
        assert any(p["id"] == pid for p in pending)

        accepted = client.post(f"/api/v1/proposals/{pid}/accept")
        assert accepted.status_code == 200
        assert accepted.json()["status"] == "accepted"

        module_after = client.get(f"/api/v1/modules/{module['id']}").json()
        assert module_after["priority"] == 1
        assert all(p["id"] != pid for p in client.get("/api/v1/proposals").json())


def test_generate_proposes_only_stale_modules():
    with TestClient(app) as client:
        generated = client.post("/api/v1/proposals/generate").json()
        assert len(generated) >= 1
        assert all(p["type"] == "set_module_status" for p in generated)
        again = client.post("/api/v1/proposals/generate").json()
        assert again == []


def test_generate_skips_modules_with_recent_activity():
    with TestClient(app) as client:
        modules = {m["slug"]: m for m in client.get("/api/v1/modules").json()}
        oscp = modules["oscp"]
        client.post(
            "/api/v1/activities",
            json={"module_id": oscp["id"], "activity_type": "study", "title": "OSCP", "duration_minutes": 30},
        )
        generated = client.post("/api/v1/proposals/generate").json()
        assert all(p["payload"]["module_id"] != oscp["id"] for p in generated)
