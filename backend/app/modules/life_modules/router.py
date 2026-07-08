import json

from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, new_id, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.life_modules.behavior import build_behavior
from app.modules.life_modules.service import VALID_STATUSES, set_module_status
from app.shared.audit import record_audit_event
from app.shared.schemas import LifeModuleOut, ModuleBehaviorUpdate, ModuleCreate, ModuleUpdate
from app.shared.sql import apply_update, get_or_404, json_dump

router = APIRouter(prefix="/modules", tags=["modules"])

VALID_MODULE_TYPES = {
    "project",
    "habit",
    "learning",
    "recovery",
    "relationship",
    "hobby",
    "finance",
    "calendar",
    "ai_coach",
    "analytics",
    "ledger",
}


@router.get("", response_model=list[LifeModuleOut])
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


@router.post("", status_code=201, response_model=LifeModuleOut)
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


@router.get("/{module_id}", response_model=LifeModuleOut)
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


@router.patch("/{module_id}", response_model=LifeModuleOut)
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


@router.post("/{module_id}/archive", response_model=LifeModuleOut)
def archive_module(module_id: str) -> dict:
    with db_connection() as conn:
        return set_module_status(conn, module_id, "archived")


@router.post("/{module_id}/pause", response_model=LifeModuleOut)
def pause_module(module_id: str) -> dict:
    with db_connection() as conn:
        return set_module_status(conn, module_id, "paused")


@router.post("/{module_id}/resume", response_model=LifeModuleOut)
def resume_module(module_id: str) -> dict:
    with db_connection() as conn:
        return set_module_status(conn, module_id, "active")


@router.delete("/{module_id}", response_model=LifeModuleOut)
def delete_module(module_id: str) -> dict:
    """Hard delete (owner's explicit choice): the module and its OWNED rows go;
    real history (activities, goals) is kept and unlinked."""
    with db_connection() as conn:
        module = get_or_404(conn, "life_modules", module_id)

        owned_tables = ("project_items", "learning_units", "hobby_ideas", "metrics", "activity_templates")
        deleted_counts = {}
        for table in owned_tables:
            cursor = conn.execute(f"DELETE FROM {table} WHERE module_id = ?", (module_id,))
            deleted_counts[table] = cursor.rowcount

        unlinked_activities = conn.execute(
            "UPDATE activities SET module_id = NULL WHERE module_id = ?", (module_id,)
        ).rowcount
        unlinked_goals = conn.execute(
            "UPDATE goals SET module_id = NULL WHERE module_id = ?", (module_id,)
        ).rowcount

        conn.execute("DELETE FROM life_modules WHERE id = ?", (module_id,))
        record_audit_event(
            conn,
            entity_type="life_module",
            entity_id=module_id,
            action="deleted",
            summary=f"Deleted module: {module['name']}",
            changes={
                "type": module["type"],
                **{f"deleted_{table}": count for table, count in deleted_counts.items() if count},
                "unlinked_activities": unlinked_activities,
                "unlinked_goals": unlinked_goals,
            },
        )
        return module
