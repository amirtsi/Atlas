from sqlite3 import Connection

from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, new_id, row_to_dict, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.activity_ledger.service import insert_activity
from app.modules.life_modules.behavior import build_behavior
from app.shared.audit import record_audit_event
from app.shared.schemas import ActivityCreate, LearningUnitComplete, LearningUnitCreate, LearningUnitUpdate
from app.shared.sql import get_or_404

router = APIRouter(prefix="/learning", tags=["learning"])

VALID_UNIT_TYPES = {"topic", "lab", "machine"}
VALID_UNIT_STATUSES = {"not_started", "in_progress", "completed"}

# Open units first (in-progress above not-started), completed last; then by sort_order, oldest first.
_UNITS_ORDER = """
    ORDER BY
      CASE status WHEN 'completed' THEN 2 WHEN 'in_progress' THEN 0 ELSE 1 END,
      sort_order ASC,
      created_at ASC
"""


def _get_learning_module(conn: Connection, module_id: str) -> dict:
    module = get_or_404(conn, "life_modules", module_id)
    if module["type"] != "learning":
        raise HTTPException(status_code=422, detail="Module is not a learning module")
    return module


def _get_unit(conn: Connection, module_id: str, unit_id: str) -> dict:
    row = conn.execute(
        "SELECT * FROM learning_units WHERE id = ? AND module_id = ?", (unit_id, module_id)
    ).fetchone()
    unit = row_to_dict(row)
    if unit is None:
        raise HTTPException(status_code=404, detail="Learning unit not found")
    return unit


def _list_units(conn: Connection, module_id: str) -> list[dict]:
    return rows_to_dicts(
        conn.execute(f"SELECT * FROM learning_units WHERE module_id = ?{_UNITS_ORDER}", (module_id,)).fetchall()
    )


@router.get("/{module_id}/overview")
def learning_overview(module_id: str) -> dict:
    with db_connection() as conn:
        module = _get_learning_module(conn, module_id)
        recent_activities = rows_to_dicts(
            conn.execute(
                """
                SELECT a.*, d.name AS discipline_name, d.slug AS discipline_slug, d.color AS discipline_color
                FROM activities a
                LEFT JOIN disciplines d ON d.id = a.discipline_id
                WHERE a.module_id = ?
                ORDER BY a.occurred_at DESC
                LIMIT 8
                """,
                (module_id,),
            ).fetchall()
        )
        return {
            "module": module,
            "summary": build_behavior(conn, module)["summary"],
            "units": _list_units(conn, module_id),
            "recent_activities": recent_activities,
        }


@router.get("/{module_id}/units")
def list_units(module_id: str, unit_type: str | None = None, status: str | None = None) -> list[dict]:
    with db_connection() as conn:
        _get_learning_module(conn, module_id)
        where = ["module_id = ?"]
        params: list[object] = [module_id]
        if unit_type:
            where.append("unit_type = ?")
            params.append(unit_type)
        if status:
            where.append("status = ?")
            params.append(status)
        sql = f"SELECT * FROM learning_units WHERE {' AND '.join(where)}{_UNITS_ORDER}"
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("/{module_id}/units", status_code=201)
def create_unit(module_id: str, payload: LearningUnitCreate) -> dict:
    if payload.unit_type not in VALID_UNIT_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported unit type")
    if payload.status not in VALID_UNIT_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported unit status")

    now = utc_now_iso()
    with db_connection() as conn:
        _get_learning_module(conn, module_id)
        next_sort = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM learning_units WHERE module_id = ?", (module_id,)
        ).fetchone()["next"]
        unit_id = new_id()
        completed_at = now if payload.status == "completed" else None
        conn.execute(
            """
            INSERT INTO learning_units
              (id, module_id, unit_type, title, status, sort_order, completed_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (unit_id, module_id, payload.unit_type, payload.title, payload.status, next_sort, completed_at, now, now),
        )
        unit = _get_unit(conn, module_id, unit_id)
        record_audit_event(
            conn,
            entity_type="learning_unit",
            entity_id=unit_id,
            action="created",
            summary=f"Added {unit['unit_type']}: {unit['title']}",
            changes={"unit_type": unit["unit_type"], "status": unit["status"], "module_id": module_id},
        )
        return unit


@router.patch("/{module_id}/units/{unit_id}")
def update_unit(module_id: str, unit_id: str, payload: LearningUnitUpdate) -> dict:
    data = payload.model_dump(exclude_unset=True)
    if "unit_type" in data and data["unit_type"] not in VALID_UNIT_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported unit type")
    if "status" in data and data["status"] not in VALID_UNIT_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported unit status")

    now = utc_now_iso()
    with db_connection() as conn:
        _get_learning_module(conn, module_id)
        unit = _get_unit(conn, module_id, unit_id)

        updates = {key: value for key, value in data.items() if value is not None}
        # Keep completed_at honest with the status transition.
        if "status" in updates:
            if updates["status"] == "completed" and unit["status"] != "completed":
                updates["completed_at"] = now
            elif updates["status"] != "completed" and unit["status"] == "completed":
                updates["completed_at"] = None

        if updates:
            assignments = ", ".join(f"{key} = ?" for key in updates)
            conn.execute(
                f"UPDATE learning_units SET {assignments}, updated_at = ? WHERE id = ?",
                (*updates.values(), now, unit_id),
            )
            record_audit_event(
                conn,
                entity_type="learning_unit",
                entity_id=unit_id,
                action="updated",
                summary=f"Updated {unit['unit_type']}: {unit['title']}",
                changes=data,
            )
        return _get_unit(conn, module_id, unit_id)


@router.post("/{module_id}/units/{unit_id}/complete")
def complete_unit(module_id: str, unit_id: str, payload: LearningUnitComplete) -> dict:
    """Complete a unit and (by default) log a real study activity — progress comes from real work."""
    now = utc_now_iso()
    with db_connection() as conn:
        module = _get_learning_module(conn, module_id)
        unit = _get_unit(conn, module_id, unit_id)
        if unit["status"] == "completed":
            raise HTTPException(status_code=409, detail="Unit is already completed")

        activity_id = None
        if payload.log_activity:
            activity = insert_activity(
                conn,
                ActivityCreate(
                    module_id=module_id,
                    discipline_id=module["discipline_id"],
                    activity_type="study",
                    title=f"Completed {unit['unit_type']}: {unit['title']}",
                    notes=payload.notes,
                    duration_minutes=payload.duration_minutes,
                    source="quick_log",
                    metadata={"learning_unit_id": unit_id, "unit_type": unit["unit_type"]},
                ),
            )
            activity_id = activity["id"]

        conn.execute(
            "UPDATE learning_units SET status = 'completed', completed_at = ?, completed_activity_id = ?, updated_at = ? WHERE id = ?",
            (now, activity_id, now, unit_id),
        )
        record_audit_event(
            conn,
            entity_type="learning_unit",
            entity_id=unit_id,
            action="completed",
            summary=f"Completed {unit['unit_type']}: {unit['title']}",
            changes={"unit_type": unit["unit_type"], "logged_activity": bool(activity_id)},
        )
        return _get_unit(conn, module_id, unit_id)


@router.delete("/{module_id}/units/{unit_id}")
def delete_unit(module_id: str, unit_id: str) -> dict:
    with db_connection() as conn:
        _get_learning_module(conn, module_id)
        unit = _get_unit(conn, module_id, unit_id)
        conn.execute("DELETE FROM learning_units WHERE id = ?", (unit_id,))
        record_audit_event(
            conn,
            entity_type="learning_unit",
            entity_id=unit_id,
            action="deleted",
            summary=f"Deleted {unit['unit_type']}: {unit['title']}",
            changes={"title": unit["title"]},
        )
        return unit
