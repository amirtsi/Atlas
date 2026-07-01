from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.core.database import db_connection, new_id, row_to_dict, rows_to_dicts
from app.core.time import to_utc_iso, utc_now_iso

# The validated write path lives in the service layer; the routes below call it.
from app.modules.activity_ledger.service import insert_activity
from app.shared.audit import record_audit_event
from app.shared.schemas import (
    ActivityCreate,
    ActivityTemplateCreate,
    ActivityTemplateUpdate,
    ActivityUpdate,
    QuickLogCreate,
)
from app.shared.sql import apply_update, get_or_404, json_dump

router = APIRouter(tags=["activity-ledger"])


@router.get("/activities")
def list_activities(
    discipline_id: str | None = None,
    module_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    where: list[str] = []
    params: list[object] = []
    if discipline_id:
        where.append("a.discipline_id = ?")
        params.append(discipline_id)
    if module_id:
        where.append("a.module_id = ?")
        params.append(module_id)
    if date_from:
        where.append("a.occurred_at >= ?")
        params.append(date_from)
    if date_to:
        where.append("a.occurred_at <= ?")
        params.append(date_to)
    sql = """
    SELECT
      a.*,
      d.name AS discipline_name,
      d.slug AS discipline_slug,
      d.color AS discipline_color,
      lm.name AS module_name,
      lm.slug AS module_slug,
      lm.type AS module_type
    FROM activities a
    LEFT JOIN disciplines d ON d.id = a.discipline_id
    LEFT JOIN life_modules lm ON lm.id = a.module_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY a.occurred_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("/activities", status_code=201)
def create_activity(payload: ActivityCreate) -> dict:
    with db_connection() as conn:
        return insert_activity(conn, payload)


@router.post("/activities/quick-log", status_code=201)
def quick_log(payload: QuickLogCreate) -> dict:
    with db_connection() as conn:
        if payload.template_id:
            template = get_or_404(conn, "activity_templates", payload.template_id)
            activity = ActivityCreate(
                discipline_id=template["discipline_id"],
                module_id=template["module_id"],
                activity_type=template["activity_type"],
                title=template["title"],
                duration_minutes=payload.duration_minutes or template["default_duration_minutes"],
                notes=payload.notes,
                source="quick_log",
                metadata={**(template.get("default_metadata") or {}), **payload.metadata},
            )
            return insert_activity(conn, activity)

        if not payload.title or not payload.activity_type:
            raise HTTPException(status_code=422, detail="title and activity_type are required without template_id")
        activity = ActivityCreate(
            discipline_id=payload.discipline_id,
            module_id=payload.module_id,
            activity_type=payload.activity_type,
            title=payload.title,
            duration_minutes=payload.duration_minutes,
            notes=payload.notes,
            source="quick_log",
            metadata=payload.metadata,
        )
        return insert_activity(conn, activity)


@router.get("/activities/{activity_id}")
def get_activity(activity_id: str) -> dict:
    with db_connection() as conn:
        return get_or_404(conn, "activities", activity_id)


_ACTIVITY_UPDATE_FIELDS = {
    "discipline_id",
    "module_id",
    "activity_type",
    "title",
    "notes",
    "occurred_at",
    "duration_minutes",
    "energy_level",
    "mood_level",
    "metadata",
}


@router.patch("/activities/{activity_id}")
def update_activity(activity_id: str, payload: ActivityUpdate) -> dict:
    # Only explicitly-sent fields are applied; an explicit null IS applied (so an
    # activity can be moved back to "no module"). This is why we don't reuse
    # apply_update here — it drops None values.
    data = {key: value for key, value in payload.model_dump(exclude_unset=True).items() if key in _ACTIVITY_UPDATE_FIELDS}
    if data.get("occurred_at"):
        data["occurred_at"] = to_utc_iso(data["occurred_at"], assume_tz=get_settings().timezone)
    with db_connection() as conn:
        get_or_404(conn, "activities", activity_id)
        # Reassigning the module must keep discipline consistent (Life Pulse and
        # weekly balance group by discipline), unless the caller set one explicitly.
        if "module_id" in data:
            if data["module_id"]:
                module = get_or_404(conn, "life_modules", data["module_id"])
                data.setdefault("discipline_id", module["discipline_id"])
            else:
                data.setdefault("discipline_id", None)
        if not data:
            return get_or_404(conn, "activities", activity_id)

        assignments = ", ".join(f"{key} = ?" for key in data)
        values = [json_dump(value) if isinstance(value, dict) else value for value in data.values()]
        conn.execute(
            f"UPDATE activities SET {assignments}, updated_at = ? WHERE id = ?",
            (*values, utc_now_iso(), activity_id),
        )
        updated = get_or_404(conn, "activities", activity_id)
        record_audit_event(
            conn,
            entity_type="activity",
            entity_id=activity_id,
            action="updated",
            summary=f"Updated activity: {updated['title']}",
            changes=data,
        )
        return updated


@router.delete("/activities/{activity_id}")
def delete_activity(activity_id: str) -> dict:
    with db_connection() as conn:
        activity = get_or_404(conn, "activities", activity_id)
        conn.execute("DELETE FROM activities WHERE id = ?", (activity_id,))
        record_audit_event(
            conn,
            entity_type="activity",
            entity_id=activity_id,
            action="deleted",
            summary=f"Deleted activity: {activity['title']}",
            changes={"title": activity["title"]},
        )
        return activity


@router.get("/activity-templates")
def list_templates(include_inactive: bool = False) -> list[dict]:
    sql = """
    SELECT
      at.*,
      d.name AS discipline_name,
      d.slug AS discipline_slug,
      d.color AS discipline_color,
      lm.name AS module_name,
      lm.slug AS module_slug,
      lm.type AS module_type
    FROM activity_templates at
    LEFT JOIN disciplines d ON d.id = at.discipline_id
    LEFT JOIN life_modules lm ON lm.id = at.module_id
    """
    if not include_inactive:
        sql += " WHERE at.is_active = 1"
    sql += " ORDER BY at.sort_order ASC, at.title ASC"
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql).fetchall())


@router.post("/activity-templates", status_code=201)
def create_template(payload: ActivityTemplateCreate) -> dict:
    now = utc_now_iso()
    with db_connection() as conn:
        if payload.discipline_id:
            get_or_404(conn, "disciplines", payload.discipline_id)
        if payload.module_id:
            get_or_404(conn, "life_modules", payload.module_id)
        template_id = new_id()
        conn.execute(
            """
            INSERT INTO activity_templates
              (id, discipline_id, module_id, title, activity_type, default_duration_minutes,
               default_metadata, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                template_id,
                payload.discipline_id,
                payload.module_id,
                payload.title,
                payload.activity_type,
                payload.default_duration_minutes,
                json_dump(payload.default_metadata),
                payload.sort_order,
                now,
                now,
            ),
        )
        template = get_or_404(conn, "activity_templates", template_id)
        record_audit_event(
            conn,
            entity_type="activity_template",
            entity_id=template_id,
            action="created",
            summary=f"Created quick-log shortcut: {template['title']}",
            changes={"title": template["title"], "module_id": template["module_id"]},
        )
        return template


@router.patch("/activity-templates/{template_id}")
def update_template(template_id: str, payload: ActivityTemplateUpdate) -> dict:
    with db_connection() as conn:
        updated = apply_update(
            conn,
            "activity_templates",
            template_id,
            payload.model_dump(exclude_unset=True),
            {
                "discipline_id",
                "module_id",
                "title",
                "activity_type",
                "default_duration_minutes",
                "default_metadata",
                "sort_order",
                "is_active",
            },
        )
        record_audit_event(
            conn,
            entity_type="activity_template",
            entity_id=template_id,
            action="updated",
            summary=f"Updated quick-log shortcut: {updated['title']}",
            changes=payload.model_dump(exclude_unset=True),
        )
        return updated


@router.delete("/activity-templates/{template_id}")
def deactivate_template(template_id: str) -> dict:
    with db_connection() as conn:
        get_or_404(conn, "activity_templates", template_id)
        conn.execute("UPDATE activity_templates SET is_active = 0, updated_at = ? WHERE id = ?", (utc_now_iso(), template_id))
        template = row_to_dict(conn.execute("SELECT * FROM activity_templates WHERE id = ?", (template_id,)).fetchone())
        record_audit_event(
            conn,
            entity_type="activity_template",
            entity_id=template_id,
            action="deactivated",
            summary=f"Deactivated quick-log shortcut: {template['title']}",
            changes={"is_active": False},
        )
        return template
