"""Hobby module + idea backlog tests. Temp DB per test via conftest."""

from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.main import app


def _discipline_id(client: TestClient) -> str:
    return client.get("/api/v1/disciplines").json()[0]["id"]


def _create_hobby(client: TestClient, name: str = "Guitar") -> dict:
    response = client.post(
        "/api/v1/modules",
        json={
            "discipline_id": _discipline_id(client),
            "type": "hobby",
            "name": name,
            "slug": name.lower().replace(" ", "-"),
            "config": {"category": "creative"},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_create_hobby_module_and_ideas_table_exists():
    with TestClient(app) as client:
        module = _create_hobby(client)
        assert module["type"] == "hobby"
    with db_connection() as conn:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hobby_ideas'"
        ).fetchone()
        assert row is not None


def _insert_idea(
    module_id: str,
    title: str,
    *,
    pinned: int = 0,
    status: str = "open",
    created_at: str = "2026-01-01T00:00:00+00:00",
) -> str:
    idea_id = new_id()
    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO hobby_ideas (id, module_id, title, status, pinned, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (idea_id, module_id, title, status, pinned, created_at, created_at),
        )
    return idea_id


def _behavior_summary(client: TestClient, module_id: str) -> dict:
    response = client.get(f"/api/v1/modules/{module_id}/behavior")
    assert response.status_code == 200, response.text
    return response.json()["summary"]


def test_hobby_behavior_empty_module():
    with TestClient(app) as client:
        module = _create_hobby(client)
        summary = _behavior_summary(client, module["id"])
        assert summary["days_since_last"] is None
        assert summary["ideas_open"] == 0
        assert summary["next_idea"] is None
        assert summary["category"] == "creative"


def test_hobby_behavior_pinned_beats_oldest():
    with TestClient(app) as client:
        module = _create_hobby(client)
        _insert_idea(module["id"], "Oldest", created_at="2026-01-01T00:00:00+00:00")
        pinned_id = _insert_idea(
            module["id"], "Pinned", pinned=1, created_at="2026-06-01T00:00:00+00:00"
        )
        summary = _behavior_summary(client, module["id"])
        assert summary["next_idea"] == {"id": pinned_id, "title": "Pinned"}
        assert summary["ideas_open"] == 2


def test_hobby_behavior_oldest_open_when_no_pin_and_ignores_closed():
    with TestClient(app) as client:
        module = _create_hobby(client)
        _insert_idea(module["id"], "Done", status="done", created_at="2025-01-01T00:00:00+00:00")
        oldest_id = _insert_idea(module["id"], "Oldest open", created_at="2026-01-01T00:00:00+00:00")
        _insert_idea(module["id"], "Newer", created_at="2026-06-01T00:00:00+00:00")
        summary = _behavior_summary(client, module["id"])
        assert summary["next_idea"] == {"id": oldest_id, "title": "Oldest open"}
        assert summary["ideas_open"] == 2


def test_hobby_behavior_days_since_last_after_session():
    with TestClient(app) as client:
        module = _create_hobby(client)
        response = client.post(
            "/api/v1/activities/quick-log",
            json={
                "module_id": module["id"],
                "title": "Practice",
                "activity_type": "hobby",
                "duration_minutes": 20,
            },
        )
        assert response.status_code in (200, 201), response.text
        summary = _behavior_summary(client, module["id"])
        assert summary["days_since_last"] == 0
        assert summary["weekly_activity_count"] == 1


def test_ideas_crud_and_listing():
    with TestClient(app) as client:
        module = _create_hobby(client)

        created = client.post(
            f"/api/v1/hobby/{module['id']}/ideas",
            json={"title": "Learn the intro to Karma Police", "notes": "capo 2"},
        )
        assert created.status_code == 201, created.text
        idea = created.json()
        assert idea["status"] == "open"
        assert idea["pinned"] == 0

        listed = client.get(f"/api/v1/hobby/{module['id']}/ideas").json()
        assert [row["id"] for row in listed] == [idea["id"]]

        patched = client.patch(
            f"/api/v1/hobby/{module['id']}/ideas/{idea['id']}",
            json={"title": "Karma Police intro"},
        ).json()
        assert patched["title"] == "Karma Police intro"

        only_open = client.get(f"/api/v1/hobby/{module['id']}/ideas?status=open").json()
        assert len(only_open) == 1


def test_pin_is_exclusive_per_module():
    with TestClient(app) as client:
        module = _create_hobby(client)
        first = _insert_idea(module["id"], "First", pinned=1)
        second = _insert_idea(module["id"], "Second", created_at="2026-02-01T00:00:00+00:00")

        response = client.patch(
            f"/api/v1/hobby/{module['id']}/ideas/{second}", json={"pinned": True}
        )
        assert response.status_code == 200, response.text
        listed = {row["id"]: row for row in client.get(f"/api/v1/hobby/{module['id']}/ideas").json()}
        assert listed[second]["pinned"] == 1
        assert listed[first]["pinned"] == 0


def test_pinning_a_non_open_idea_is_rejected():
    with TestClient(app) as client:
        module = _create_hobby(client)
        done = _insert_idea(module["id"], "Done", status="done")
        response = client.patch(
            f"/api/v1/hobby/{module['id']}/ideas/{done}", json={"pinned": True}
        )
        assert response.status_code == 422


def test_ideas_module_guards():
    with TestClient(app) as client:
        non_hobby = client.get("/api/v1/modules").json()[0]
        assert non_hobby["type"] != "hobby"
        response = client.post(
            f"/api/v1/hobby/{non_hobby['id']}/ideas", json={"title": "Nope"}
        )
        assert response.status_code == 422

        missing = client.post("/api/v1/hobby/does-not-exist/ideas", json={"title": "Nope"})
        assert missing.status_code == 404

        hobby = _create_hobby(client, name="Chess")
        idea_404 = client.patch(
            f"/api/v1/hobby/{hobby['id']}/ideas/does-not-exist", json={"title": "x"}
        )
        assert idea_404.status_code == 404
