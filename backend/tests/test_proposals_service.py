import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import db_connection
from app.main import app
from app.modules.proposals import service


def _module(slug: str = "gym") -> dict:
    with TestClient(app) as client:
        return {m["slug"]: m for m in client.get("/api/v1/modules").json()}[slug]


def test_accept_priority_proposal_changes_module():
    module = _module("gym")
    with db_connection() as conn:
        proposal = service.create_proposal(
            conn, "set_module_priority", "Bump Gym", "focus", {"module_id": module["id"], "priority": 1}
        )
        accepted = service.accept_proposal(conn, proposal["id"])
        row = conn.execute("SELECT priority FROM life_modules WHERE id = ?", (module["id"],)).fetchone()
    assert accepted["status"] == "accepted"
    assert row["priority"] == 1


def test_accept_status_proposal_archives_module():
    module = _module("recovery")
    with db_connection() as conn:
        proposal = service.create_proposal(
            conn, "set_module_status", "Archive Recovery", "stale", {"module_id": module["id"], "status": "archived"}
        )
        service.accept_proposal(conn, proposal["id"])
        row = conn.execute("SELECT status FROM life_modules WHERE id = ?", (module["id"],)).fetchone()
    assert row["status"] == "archived"


def test_dismiss_changes_nothing():
    module = _module("gym")
    with db_connection() as conn:
        before = conn.execute("SELECT priority FROM life_modules WHERE id = ?", (module["id"],)).fetchone()["priority"]
        proposal = service.create_proposal(
            conn, "set_module_priority", "Bump", "x", {"module_id": module["id"], "priority": 5}
        )
        dismissed = service.dismiss_proposal(conn, proposal["id"])
        after = conn.execute("SELECT priority FROM life_modules WHERE id = ?", (module["id"],)).fetchone()["priority"]
    assert dismissed["status"] == "dismissed"
    assert after == before


def test_accept_already_resolved_is_409():
    module = _module("gym")
    with db_connection() as conn:
        proposal = service.create_proposal(
            conn, "set_module_priority", "Bump", "x", {"module_id": module["id"], "priority": 2}
        )
        service.accept_proposal(conn, proposal["id"])
        with pytest.raises(HTTPException) as exc:
            service.accept_proposal(conn, proposal["id"])
    assert exc.value.status_code == 409


def test_create_unknown_type_is_422():
    with db_connection() as conn, pytest.raises(HTTPException) as exc:
        service.create_proposal(conn, "delete_everything", "nope", "x", {})
    assert exc.value.status_code == 422
