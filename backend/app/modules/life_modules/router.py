import json

from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, new_id, row_to_dict, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.life_modules.behavior import build_behavior
from app.shared.audit import record_audit_event
from app.shared.schemas import ModuleBehaviorUpdate, ModuleCreate, ModuleUpdate
from app.shared.sql import apply_update, get_or_404, json_dump

router = APIRouter(prefix="/modules", tags=["modules"])

VALID_MODULE_TYPES = {
    "project",
    "habit",
    "learning",
    "recovery",
    "relationship",
    "finance",
    "calendar",
    "ai_coach",
    "analytics",
    "ledger",
}

VALID_STATUSES = {"active", "paused", "completed", "archived"}


@router.get("")
def list_modules(
    discipline_id: str | None = None,
    type: str | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    where: list[str] = []
    params: list[object] = []
    if discipline_id:
        where.append("discipline_id = ?")
        params.append(discipline_id)
    if type:
        where.append("type = ?")
        params.append(type)
    if status:
        where.append("status = ?")
        params.append(status)

    sql = "SELECT * FROM life_modules"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY priority ASC, name ASC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("", status_code=201)
def create_module(payload: ModuleCreate) -> dict:
    if payload.type not in VALID_MODULE_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported module type")

    now = utc_now_iso()
    with db_connection() as conn:
        get_or_404(conn, "disciplines", payload.discipline_id)
        existing = conn.execute("SELECT id FROM life_modules WHERE slug = ?", (payload.slug,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Module slug already exists")
        module_id = new_id()
        conn.execute(
            """
            INSERT INTO life_modules
              (id, discipline_id, type, name, slug, description, priority, config,
               start_date, target_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                module_id,
                payload.discipline_id,
                payload.type,
                payload.name,
                payload.slug,
                payload.description,
                payload.priority,
                json.dumps(payload.config),
                payload.start_date,
                payload.target_date,
                now,
                now,
            ),
        )
        module = get_or_404(conn, "life_modules", module_id)
        record_audit_event(
            conn,
            entity_type="life_module",
            entity_id=module_id,
            action="created",
            summary=f"Created module: {module['name']}",
            changes={"name": module["name"], "type": module["type"], "discipline_id": module["discipline_id"]},
        )
        return module


@router.get("/{module_id}")
def get_module(module_id: str) -> dict:
    with db_connection() as conn:
        return get_or_404(conn, "life_modules", module_id)


@router.get("/{module_id}/behavior")
def get_module_behavior(module_id: str) -> dict:
    with db_connection() as conn:
        module = get_or_404(conn, "life_modules", module_id)
        return build_behavior(conn, module)


@router.patch("/{module_id}/behavior")
def update_module_behavior(module_id: str, payload: ModuleBehaviorUpdate) -> dict:
    with db_connection() as conn:
        module = get_or_404(conn, "life_modules", module_id)
        merged_config = {**(module.get("config") or {}), **payload.config}
        conn.execute(
            "UPDATE life_modules SET config = ?, updated_at = ? WHERE id = ?",
            (json_dump(merged_config), utc_now_iso(), module_id),
        )
        updated = get_or_404(conn, "life_modules", module_id)
        record_audit_event(
            conn,
            entity_type="life_module",
            entity_id=module_id,
            action="behavior_updated",
            summary=f"Updated behavior: {updated['name']}",
            changes=payload.config,
        )
        return build_behavior(conn, updated)


@router.patch("/{module_id}")
def update_module(module_id: str, payload: ModuleUpdate) -> dict:
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported module status")
    if "discipline_id" in data and data["discipline_id"] is not None:
        with db_connection() as conn:
            get_or_404(conn, "disciplines", data["discipline_id"])

    with db_connection() as conn:
        updated = apply_update(
            conn,
            "life_modules",
            module_id,
            data,
            {"discipline_id", "name", "description", "status", "priority", "config", "start_date", "target_date"},
        )
        record_audit_event(
            conn,
            entity_type="life_module",
            entity_id=module_id,
            action="updated",
            summary=f"Updated module: {updated['name']}",
            changes=data,
        )
        return updated


def _set_status(module_id: str, status: str) -> dict:
    now = utc_now_iso()
    with db_connection() as conn:
        get_or_404(conn, "life_modules", module_id)
        archived_at = now if status == "archived" else None
        conn.execute(
            "UPDATE life_modules SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?",
            (status, archived_at, now, module_id),
        )
        module = row_to_dict(conn.execute("SELECT * FROM life_modules WHERE id = ?", (module_id,)).fetchone())
        record_audit_event(
            conn,
            entity_type="life_module",
            entity_id=module_id,
            action=f"status_{status}",
            summary=f"Set module {module['name']} to {status}",
            changes={"status": status},
        )
        return module


@router.post("/{module_id}/archive")
def archive_module(module_id: str) -> dict:
    return _set_status(module_id, "archived")


@router.post("/{module_id}/pause")
def pause_module(module_id: str) -> dict:
    return _set_status(module_id, "paused")


@router.post("/{module_id}/resume")
def resume_module(module_id: str) -> dict:
    return _set_status(module_id, "active")
