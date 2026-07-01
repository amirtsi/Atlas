import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import db_connection
from app.main import app
from app.modules.life_modules.service import set_module_priority, set_module_status


def _a_module_id() -> str:
    with TestClient(app) as client:
        return client.get("/api/v1/modules").json()[0]["id"]


def test_set_module_status_archives_and_audits():
    module_id = _a_module_id()
    with db_connection() as conn:
        updated = set_module_status(conn, module_id, "archived")
    assert updated["status"] == "archived"
    assert updated["archived_at"] is not None


def test_set_module_status_rejects_unknown_status():
    module_id = _a_module_id()
    with db_connection() as conn, pytest.raises(HTTPException) as exc:
        set_module_status(conn, module_id, "banana")
    assert exc.value.status_code == 422


def test_set_module_priority_updates():
    module_id = _a_module_id()
    with db_connection() as conn:
        updated = set_module_priority(conn, module_id, 5)
    assert updated["priority"] == 5
