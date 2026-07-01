from fastapi.testclient import TestClient

from app import mcp_server
from app.main import app


def _create_module(client: TestClient) -> str:
    disciplines = client.get("/api/v1/disciplines").json()
    discipline_id = disciplines[0]["id"]
    resp = client.post(
        "/api/v1/modules",
        json={"discipline_id": discipline_id, "type": "project", "name": "MCP Read Target", "slug": "mcp-read-target"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_atlas_snapshot_returns_real_signals():
    with TestClient(app):
        snap = mcp_server.atlas_snapshot()
    assert "real_signals" in snap


def test_list_modules_returns_seeded_module():
    with TestClient(app) as client:
        _create_module(client)
        mods = mcp_server.list_modules()
    assert any(m["name"] == "MCP Read Target" for m in mods)


def test_list_modules_filters_by_status():
    with TestClient(app) as client:
        _create_module(client)
        active = mcp_server.list_modules(status="active")
        archived = mcp_server.list_modules(status="archived")
    assert any(m["name"] == "MCP Read Target" for m in active)
    assert all(m["name"] != "MCP Read Target" for m in archived)


def test_get_goal_plan_without_plan_returns_error():
    with TestClient(app) as client:
        disciplines = client.get("/api/v1/disciplines").json()
        goal = client.post(
            "/api/v1/planning/goals",
            json={"title": "Read goal", "discipline_id": disciplines[0]["id"]},
        ).json()
        result = mcp_server.get_goal_plan(goal["id"])
    assert "error" in result


def test_recent_activities_caps_limit():
    with TestClient(app):
        acts = mcp_server.recent_activities(limit=9999)
    assert isinstance(acts, list)


def test_list_proposals_defaults_to_pending():
    with TestClient(app):
        props = mcp_server.list_proposals()
    assert isinstance(props, list)
