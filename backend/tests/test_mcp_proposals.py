from fastapi.testclient import TestClient

from app import mcp_server
from app.main import app


def _create_module(client: TestClient) -> str:
    disciplines = client.get("/api/v1/disciplines").json()
    resp = client.post(
        "/api/v1/modules",
        json={"discipline_id": disciplines[0]["id"], "type": "project", "name": "MCP Write Target", "slug": "mcp-write-target"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_propose_module_status_creates_pending_hermes_proposal():
    with TestClient(app) as client:
        module_id = _create_module(client)
        result = mcp_server.propose_module_status(module_id, "archived", "stale for 30d")
        assert result["status"] == "pending"
        assert result["created_by"] == "hermes"
        assert result["type"] == "set_module_status"
        # module itself is unchanged until the owner accepts
        module = client.get(f"/api/v1/modules/{module_id}").json()
        assert module["status"] == "active"


def test_propose_module_priority_creates_pending_proposal():
    with TestClient(app) as client:
        module_id = _create_module(client)
        result = mcp_server.propose_module_priority(module_id, 1, "focus here")
        assert result["status"] == "pending"
        assert result["type"] == "set_module_priority"
        assert result["payload"]["priority"] == 1


def test_propose_module_status_unknown_module_returns_error():
    with TestClient(app):
        result = mcp_server.propose_module_status("does-not-exist", "archived", "x")
    assert result["status_code"] == 404


def test_propose_plan_without_ai_key_returns_error(monkeypatch):
    # decompose returns falsy -> service raises 422 (honest, no fabricated plan)
    monkeypatch.setattr("app.modules.planning.service.decompose_goal", lambda goal, context=None: None)
    with TestClient(app) as client:
        module_id = _create_module(client)
        goal = client.post(
            "/api/v1/planning/goals",
            json={"title": "Plan goal", "module_id": module_id},
        ).json()
        result = mcp_server.propose_plan(goal["id"])
    assert result["status_code"] == 422


def test_propose_plan_with_stubbed_decompose_creates_proposal(monkeypatch):
    monkeypatch.setattr(
        "app.modules.planning.service.decompose_goal",
        lambda goal, context=None: {
            "rationale": "stub",
            "steps": [{"kind": "topic", "title": "Study AD", "sequence": 0, "unit": "minutes", "target": 60}],
        },
    )
    with TestClient(app) as client:
        module_id = _create_module(client)
        goal = client.post(
            "/api/v1/planning/goals",
            json={"title": "Plan goal 2", "module_id": module_id},
        ).json()
        result = mcp_server.propose_plan(goal["id"])
    assert result.get("type") == "activate_plan"
    assert result.get("status") == "pending"


def test_propose_plan_tags_created_by_hermes(monkeypatch):
    monkeypatch.setattr(
        "app.modules.planning.service.decompose_goal",
        lambda goal, context=None: {
            "rationale": "stub",
            "steps": [{"kind": "topic", "title": "Study AD", "sequence": 0, "unit": "minutes", "target": 60}],
        },
    )
    with TestClient(app) as client:
        module_id = _create_module(client)
        goal = client.post(
            "/api/v1/planning/goals",
            json={"title": "Hermes plan", "module_id": module_id},
        ).json()
        result = mcp_server.propose_plan(goal["id"])
    assert result["created_by"] == "hermes"


def test_request_replan_tags_created_by_hermes(monkeypatch):
    # A behind-schedule (past target_date) goal with an active plan; the MCP
    # re-plan tool should file a v2 activate_plan proposal tagged created_by=hermes.
    from app.modules.planning import service

    monkeypatch.setattr(
        service,
        "decompose_goal",
        lambda goal, context=None: {
            "rationale": "adjusted",
            "steps": [{"kind": "topic", "title": "AD", "sequence": 1, "unit": "minutes", "target": 60}],
        },
    )
    with TestClient(app) as client:
        module_id = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["oscp"]["id"]
        goal_id = client.post(
            "/api/v1/planning/goals",
            json={"title": "Pass OSCP", "module_id": module_id, "target_date": "2020-01-10T00:00:00+00:00"},
        ).json()["id"]
        pid = client.post(f"/api/v1/planning/goals/{goal_id}/propose-plan").json()["id"]
        client.post(f"/api/v1/proposals/{pid}/accept")
        result = mcp_server.request_replan(goal_id)
    assert result["type"] == "activate_plan"
    assert result["created_by"] == "hermes"
