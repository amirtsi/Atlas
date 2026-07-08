"""Hard-delete of a life module: owned rows cascade, history unlinks. Temp DB per test."""

from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.core.time import utc_now_iso
from app.main import app


def _discipline_id(client: TestClient) -> str:
    return client.get("/api/v1/disciplines").json()[0]["id"]


def _create_module(client: TestClient, *, type_: str = "project", name: str = "Doomed") -> dict:
    response = client.post(
        "/api/v1/modules",
        json={
            "discipline_id": _discipline_id(client),
            "type": type_,
            "name": name,
            "slug": name.lower(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _count(table: str, module_id: str) -> int:
    with db_connection() as conn:
        return conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE module_id = ?", (module_id,)
        ).fetchone()[0]


def test_delete_cascades_owned_rows_and_unlinks_history():
    with TestClient(app) as client:
        module = _create_module(client)
        module_id = module["id"]

        item = client.post(
            f"/api/v1/project/{module_id}/items", json={"item_type": "task", "title": "T1"}
        )
        assert item.status_code == 201

        logged = client.post(
            "/api/v1/activities/quick-log",
            json={"module_id": module_id, "title": "Work", "activity_type": "project"},
        )
        assert logged.status_code in (200, 201)
        activity_id = logged.json()["id"]

        now = utc_now_iso()
        goal_id = new_id()
        template_id = new_id()
        metric_id = new_id()
        with db_connection() as conn:
            conn.execute(
                "INSERT INTO goals (id, module_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (goal_id, module_id, "Ship it", now, now),
            )
            conn.execute(
                """
                INSERT INTO activity_templates (id, module_id, title, activity_type, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (template_id, module_id, "Quick work", "project", now, now),
            )
            conn.execute(
                """
                INSERT INTO metrics (id, module_id, metric_key, value_number, recorded_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (metric_id, module_id, "pain", 3, now, now),
            )

        response = client.delete(f"/api/v1/modules/{module_id}")
        assert response.status_code == 200, response.text
        assert response.json()["id"] == module_id

        assert client.get(f"/api/v1/modules/{module_id}").status_code == 404
        assert _count("project_items", module_id) == 0
        assert _count("activity_templates", module_id) == 0
        assert _count("metrics", module_id) == 0

        with db_connection() as conn:
            activity = conn.execute(
                "SELECT module_id FROM activities WHERE id = ?", (activity_id,)
            ).fetchone()
            assert activity is not None and activity["module_id"] is None
            goal = conn.execute("SELECT module_id FROM goals WHERE id = ?", (goal_id,)).fetchone()
            assert goal is not None and goal["module_id"] is None
            audit = conn.execute(
                "SELECT action FROM audit_events WHERE entity_type = 'life_module' AND entity_id = ? ORDER BY rowid DESC",
                (module_id,),
            ).fetchone()
            assert audit is not None and audit["action"] == "deleted"


def test_delete_hobby_cascades_ideas():
    with TestClient(app) as client:
        module = _create_module(client, type_="hobby", name="Whittling")
        module_id = module["id"]
        created = client.post(f"/api/v1/hobby/{module_id}/ideas", json={"title": "Spoon"})
        assert created.status_code == 201

        assert client.delete(f"/api/v1/modules/{module_id}").status_code == 200
        assert _count("hobby_ideas", module_id) == 0


def test_delete_unknown_module_404_and_not_repeatable():
    with TestClient(app) as client:
        assert client.delete("/api/v1/modules/nope").status_code == 404
        module = _create_module(client, name="Once")
        assert client.delete(f"/api/v1/modules/{module['id']}").status_code == 200
        assert client.delete(f"/api/v1/modules/{module['id']}").status_code == 404
