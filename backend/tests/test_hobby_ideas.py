"""Hobby module + idea backlog tests. Temp DB per test via conftest."""

from fastapi.testclient import TestClient

from app.core.database import db_connection
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
