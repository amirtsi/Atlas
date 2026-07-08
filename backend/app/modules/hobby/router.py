from sqlite3 import Connection

from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, new_id, row_to_dict, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.activity_ledger.service import insert_activity
from app.shared.audit import record_audit_event
from app.shared.schemas import ActivityCreate, HobbyIdeaComplete, HobbyIdeaCreate, HobbyIdeaUpdate
from app.shared.sql import get_or_404

router = APIRouter(prefix="/hobby", tags=["hobby"])

VALID_IDEA_STATUSES = {"open", "done", "dropped"}

# Deck order — the same order the behavior summary uses to pick "next":
# pinned first, then oldest; a deferred idea's deferred_at replaces created_at.
_IDEAS_ORDER = """
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
      pinned DESC,
      COALESCE(deferred_at, created_at) ASC
"""


def _get_hobby_module(conn: Connection, module_id: str, *, for_write: bool = False) -> dict:
    module = get_or_404(conn, "life_modules", module_id)
    if module["type"] != "hobby":
        raise HTTPException(status_code=422, detail="Module is not a hobby")
    if for_write and module["status"] == "archived":
        raise HTTPException(status_code=422, detail="Module is archived")
    return module


def _get_idea(conn: Connection, module_id: str, idea_id: str) -> dict:
    row = conn.execute(
        "SELECT * FROM hobby_ideas WHERE id = ? AND module_id = ?", (idea_id, module_id)
    ).fetchone()
    idea = row_to_dict(row)
    if idea is None:
        raise HTTPException(status_code=404, detail="Hobby idea not found")
    return idea


@router.get("/{module_id}/ideas")
def list_ideas(module_id: str, status: str | None = None) -> list[dict]:
    with db_connection() as conn:
        _get_hobby_module(conn, module_id)
        where = ["module_id = ?"]
        params: list[object] = [module_id]
        if status:
            if status not in VALID_IDEA_STATUSES:
                raise HTTPException(status_code=422, detail="Unsupported idea status")
            where.append("status = ?")
            params.append(status)
        sql = f"SELECT * FROM hobby_ideas WHERE {' AND '.join(where)}{_IDEAS_ORDER}"
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("/{module_id}/ideas", status_code=201)
def create_idea(module_id: str, payload: HobbyIdeaCreate) -> dict:
    now = utc_now_iso()
    with db_connection() as conn:
        _get_hobby_module(conn, module_id, for_write=True)
        idea_id = new_id()
        conn.execute(
            """
            INSERT INTO hobby_ideas (id, module_id, title, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (idea_id, module_id, payload.title, payload.notes, now, now),
        )
        idea = _get_idea(conn, module_id, idea_id)
        record_audit_event(
            conn,
            entity_type="hobby_idea",
            entity_id=idea_id,
            action="created",
            summary=f"Added hobby idea: {idea['title']}",
            changes={"module_id": module_id},
        )
        return idea


@router.patch("/{module_id}/ideas/{idea_id}")
def update_idea(module_id: str, idea_id: str, payload: HobbyIdeaUpdate) -> dict:
    data = payload.model_dump(exclude_unset=True)
    now = utc_now_iso()
    with db_connection() as conn:
        _get_hobby_module(conn, module_id, for_write=True)
        idea = _get_idea(conn, module_id, idea_id)

        if data.get("pinned") and idea["status"] != "open":
            raise HTTPException(status_code=422, detail="Only open ideas can be pinned")
        if "pinned" in data and data["pinned"]:
            # Pin is exclusive per module — unpin siblings in the same transaction.
            conn.execute(
                "UPDATE hobby_ideas SET pinned = 0, updated_at = ? WHERE module_id = ? AND pinned = 1",
                (now, module_id),
            )

        updates = {key: value for key, value in data.items() if value is not None}
        if "pinned" in updates:
            updates["pinned"] = 1 if updates["pinned"] else 0
        if updates:
            assignments = ", ".join(f"{key} = ?" for key in updates)
            conn.execute(
                f"UPDATE hobby_ideas SET {assignments}, updated_at = ? WHERE id = ?",
                (*updates.values(), now, idea_id),
            )
            record_audit_event(
                conn,
                entity_type="hobby_idea",
                entity_id=idea_id,
                action="updated",
                summary=f"Updated hobby idea: {idea['title']}",
                changes=data,
            )
        return _get_idea(conn, module_id, idea_id)


@router.post("/{module_id}/ideas/{idea_id}/complete")
def complete_idea(module_id: str, idea_id: str, payload: HobbyIdeaComplete) -> dict:
    """Close an idea and (by default) log a real session — acting on it creates a record."""
    now = utc_now_iso()
    with db_connection() as conn:
        module = _get_hobby_module(conn, module_id, for_write=True)
        idea = _get_idea(conn, module_id, idea_id)
        if idea["status"] != "open":
            raise HTTPException(status_code=409, detail="Idea is not open")

        activity_id = None
        if payload.log_activity:
            activity = insert_activity(
                conn,
                ActivityCreate(
                    module_id=module_id,
                    discipline_id=module["discipline_id"],
                    activity_type="hobby",
                    title=idea["title"],
                    notes=payload.notes,
                    duration_minutes=payload.duration_minutes,
                    source="hobby_idea",
                    metadata={"hobby_idea_id": idea_id},
                ),
            )
            activity_id = activity["id"]

        conn.execute(
            """
            UPDATE hobby_ideas
            SET status = 'done', pinned = 0, completed_at = ?, completed_activity_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (now, activity_id, now, idea_id),
        )
        record_audit_event(
            conn,
            entity_type="hobby_idea",
            entity_id=idea_id,
            action="completed",
            summary=f"Did it: {idea['title']}",
            changes={"logged_activity": bool(activity_id)},
        )
        return _get_idea(conn, module_id, idea_id)


@router.post("/{module_id}/ideas/{idea_id}/defer")
def defer_idea(module_id: str, idea_id: str) -> dict:
    """Send the idea to the back of the deck ("דלג") — stays open, loses its pin."""
    now = utc_now_iso()
    with db_connection() as conn:
        _get_hobby_module(conn, module_id, for_write=True)
        idea = _get_idea(conn, module_id, idea_id)
        if idea["status"] != "open":
            raise HTTPException(status_code=409, detail="Idea is not open")
        conn.execute(
            "UPDATE hobby_ideas SET deferred_at = ?, pinned = 0, updated_at = ? WHERE id = ?",
            (now, now, idea_id),
        )
        record_audit_event(
            conn,
            entity_type="hobby_idea",
            entity_id=idea_id,
            action="deferred",
            summary=f"Deferred hobby idea: {idea['title']}",
            changes={},
        )
        return _get_idea(conn, module_id, idea_id)


@router.post("/{module_id}/ideas/{idea_id}/drop")
def drop_idea(module_id: str, idea_id: str) -> dict:
    """Archive an idea without pretending it was done — no activity is logged."""
    now = utc_now_iso()
    with db_connection() as conn:
        _get_hobby_module(conn, module_id, for_write=True)
        idea = _get_idea(conn, module_id, idea_id)
        if idea["status"] != "open":
            raise HTTPException(status_code=409, detail="Idea is not open")
        conn.execute(
            "UPDATE hobby_ideas SET status = 'dropped', pinned = 0, updated_at = ? WHERE id = ?",
            (now, idea_id),
        )
        record_audit_event(
            conn,
            entity_type="hobby_idea",
            entity_id=idea_id,
            action="dropped",
            summary=f"Dropped hobby idea: {idea['title']}",
            changes={},
        )
        return _get_idea(conn, module_id, idea_id)


@router.delete("/{module_id}/ideas/{idea_id}")
def delete_idea(module_id: str, idea_id: str) -> dict:
    with db_connection() as conn:
        _get_hobby_module(conn, module_id, for_write=True)
        idea = _get_idea(conn, module_id, idea_id)
        conn.execute("DELETE FROM hobby_ideas WHERE id = ?", (idea_id,))
        record_audit_event(
            conn,
            entity_type="hobby_idea",
            entity_id=idea_id,
            action="deleted",
            summary=f"Deleted hobby idea: {idea['title']}",
            changes={"title": idea["title"]},
        )
        return idea
