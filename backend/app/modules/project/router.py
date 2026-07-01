from sqlite3 import Connection

from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, new_id, row_to_dict, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.activity_ledger.service import insert_activity
from app.modules.life_modules.behavior import build_behavior
from app.shared.audit import record_audit_event
from app.shared.schemas import ActivityCreate, ProjectItemComplete, ProjectItemCreate, ProjectItemUpdate
from app.shared.sql import get_or_404

router = APIRouter(prefix="/project", tags=["project"])

VALID_ITEM_TYPES = {"task", "bug", "feature"}
VALID_ITEM_STATUSES = {"todo", "in_progress", "done"}

# Open items first, in-progress above todo, done last; then by priority, then oldest first.
_ITEMS_ORDER = """
    ORDER BY
      CASE status WHEN 'done' THEN 2 WHEN 'in_progress' THEN 0 ELSE 1 END,
      priority ASC,
      created_at ASC
"""


def _get_project_module(conn: Connection, module_id: str) -> dict:
    module = get_or_404(conn, "life_modules", module_id)
    if module["type"] != "project":
        raise HTTPException(status_code=422, detail="Module is not a project")
    return module


def _get_item(conn: Connection, module_id: str, item_id: str) -> dict:
    row = conn.execute(
        "SELECT * FROM project_items WHERE id = ? AND module_id = ?", (item_id, module_id)
    ).fetchone()
    item = row_to_dict(row)
    if item is None:
        raise HTTPException(status_code=404, detail="Project item not found")
    return item


def _list_items(conn: Connection, module_id: str) -> list[dict]:
    return rows_to_dicts(
        conn.execute(f"SELECT * FROM project_items WHERE module_id = ?{_ITEMS_ORDER}", (module_id,)).fetchall()
    )


@router.get("/{module_id}/overview")
def project_overview(module_id: str) -> dict:
    with db_connection() as conn:
        module = _get_project_module(conn, module_id)
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
            "items": _list_items(conn, module_id),
            "recent_activities": recent_activities,
        }


@router.get("/{module_id}/items")
def list_items(module_id: str, item_type: str | None = None, status: str | None = None) -> list[dict]:
    with db_connection() as conn:
        _get_project_module(conn, module_id)
        where = ["module_id = ?"]
        params: list[object] = [module_id]
        if item_type:
            where.append("item_type = ?")
            params.append(item_type)
        if status:
            where.append("status = ?")
            params.append(status)
        sql = f"SELECT * FROM project_items WHERE {' AND '.join(where)}{_ITEMS_ORDER}"
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("/{module_id}/items", status_code=201)
def create_item(module_id: str, payload: ProjectItemCreate) -> dict:
    if payload.item_type not in VALID_ITEM_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported item type")
    if payload.status not in VALID_ITEM_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported item status")

    now = utc_now_iso()
    with db_connection() as conn:
        _get_project_module(conn, module_id)
        item_id = new_id()
        completed_at = now if payload.status == "done" else None
        conn.execute(
            """
            INSERT INTO project_items
              (id, module_id, item_type, title, description, status, priority, due_date,
               completed_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                module_id,
                payload.item_type,
                payload.title,
                payload.description,
                payload.status,
                payload.priority,
                payload.due_date,
                completed_at,
                now,
                now,
            ),
        )
        item = _get_item(conn, module_id, item_id)
        record_audit_event(
            conn,
            entity_type="project_item",
            entity_id=item_id,
            action="created",
            summary=f"Added {item['item_type']}: {item['title']}",
            changes={"item_type": item["item_type"], "status": item["status"], "module_id": module_id},
        )
        return item


@router.patch("/{module_id}/items/{item_id}")
def update_item(module_id: str, item_id: str, payload: ProjectItemUpdate) -> dict:
    data = payload.model_dump(exclude_unset=True)
    if "item_type" in data and data["item_type"] not in VALID_ITEM_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported item type")
    if "status" in data and data["status"] not in VALID_ITEM_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported item status")

    now = utc_now_iso()
    with db_connection() as conn:
        _get_project_module(conn, module_id)
        item = _get_item(conn, module_id, item_id)

        updates = {key: value for key, value in data.items() if value is not None}
        # Keep completed_at honest with the status transition.
        if "status" in updates:
            if updates["status"] == "done" and item["status"] != "done":
                updates["completed_at"] = now
            elif updates["status"] != "done" and item["status"] == "done":
                updates["completed_at"] = None

        if updates:
            assignments = ", ".join(f"{key} = ?" for key in updates)
            conn.execute(
                f"UPDATE project_items SET {assignments}, updated_at = ? WHERE id = ?",
                (*updates.values(), now, item_id),
            )
            record_audit_event(
                conn,
                entity_type="project_item",
                entity_id=item_id,
                action="updated",
                summary=f"Updated {item['item_type']}: {item['title']}",
                changes=data,
            )
        return _get_item(conn, module_id, item_id)


@router.post("/{module_id}/items/{item_id}/complete")
def complete_item(module_id: str, item_id: str, payload: ProjectItemComplete) -> dict:
    """Close an item and (by default) log a real activity — closing work creates a record."""
    now = utc_now_iso()
    with db_connection() as conn:
        module = _get_project_module(conn, module_id)
        item = _get_item(conn, module_id, item_id)
        if item["status"] == "done":
            raise HTTPException(status_code=409, detail="Item is already done")

        activity_id = None
        if payload.log_activity:
            activity = insert_activity(
                conn,
                ActivityCreate(
                    module_id=module_id,
                    discipline_id=module["discipline_id"],
                    activity_type="project",
                    title=f"Closed {item['item_type']}: {item['title']}",
                    notes=payload.notes,
                    duration_minutes=payload.duration_minutes,
                    source="quick_log",
                    metadata={"project_item_id": item_id, "item_type": item["item_type"]},
                ),
            )
            activity_id = activity["id"]

        conn.execute(
            "UPDATE project_items SET status = 'done', completed_at = ?, completed_activity_id = ?, updated_at = ? WHERE id = ?",
            (now, activity_id, now, item_id),
        )
        record_audit_event(
            conn,
            entity_type="project_item",
            entity_id=item_id,
            action="completed",
            summary=f"Completed {item['item_type']}: {item['title']}",
            changes={"item_type": item["item_type"], "logged_activity": bool(activity_id)},
        )
        return _get_item(conn, module_id, item_id)


@router.delete("/{module_id}/items/{item_id}")
def delete_item(module_id: str, item_id: str) -> dict:
    with db_connection() as conn:
        _get_project_module(conn, module_id)
        item = _get_item(conn, module_id, item_id)
        conn.execute("DELETE FROM project_items WHERE id = ?", (item_id,))
        record_audit_event(
            conn,
            entity_type="project_item",
            entity_id=item_id,
            action="deleted",
            summary=f"Deleted {item['item_type']}: {item['title']}",
            changes={"title": item["title"]},
        )
        return item
