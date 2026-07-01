from fastapi.testclient import TestClient

from app.main import app
from app.modules.coach.context import build_context


def test_context_carries_real_numbers_and_focus_module():
    with TestClient(app) as client:
        modules = {m["slug"]: m for m in client.get("/api/v1/modules").json()}
        assert "oscp" in modules, "seed is missing the oscp module"
        oscp = modules["oscp"]
        created = client.post(
            "/api/v1/activities",
            json={
                "module_id": oscp["id"],
                "activity_type": "study",
                "title": "OSCP AD enumeration",
                "duration_minutes": 45,
            },
        )
        assert created.status_code == 201, created.text

        context = build_context("how is oscp going this week?")

    assert context["signals"]["week_activity_count"] >= 1
    assert any(m["name"] == "OSCP" for m in context["active_modules"])
    assert context["focus_module"] is not None
    assert context["focus_module"]["name"] == "OSCP"


def test_context_has_no_focus_module_when_none_named():
    with TestClient(app):
        context = build_context("what did I do today?")
    assert context["focus_module"] is None
    assert "signals" in context
