from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, new_id, row_to_dict, rows_to_dicts
from app.core.time import utc_now_iso
from app.shared.schemas import DisciplineCreate, DisciplineOut, DisciplineUpdate
from app.shared.sql import apply_update, get_or_404

router = APIRouter(prefix="/disciplines", tags=["disciplines"])


@router.get("", response_model=list[DisciplineOut])
def list_disciplines(include_inactive: bool = False) -> list[dict]:
    sql = "SELECT * FROM disciplines"
    if not include_inactive:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY sort_order ASC, name ASC"
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql).fetchall())


@router.post("", status_code=201, response_model=DisciplineOut)
def create_discipline(payload: DisciplineCreate) -> dict:
    now = utc_now_iso()
    with db_connection() as conn:
        existing = conn.execute("SELECT id FROM disciplines WHERE slug = ?", (payload.slug,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Discipline slug already exists")
        discipline_id = new_id()
        conn.execute(
            """
            INSERT INTO disciplines
              (id, name, slug, description, color, icon, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                discipline_id,
                payload.name,
                payload.slug,
                payload.description,
                payload.color,
                payload.icon,
                payload.sort_order,
                now,
                now,
            ),
        )
        return get_or_404(conn, "disciplines", discipline_id)


@router.get("/{discipline_id}", response_model=DisciplineOut)
def get_discipline(discipline_id: str) -> dict:
    with db_connection() as conn:
        return get_or_404(conn, "disciplines", discipline_id)


@router.patch("/{discipline_id}", response_model=DisciplineOut)
def update_discipline(discipline_id: str, payload: DisciplineUpdate) -> dict:
    with db_connection() as conn:
        return apply_update(
            conn,
            "disciplines",
            discipline_id,
            payload.model_dump(exclude_unset=True),
            {"name", "description", "color", "icon", "sort_order", "is_active"},
        )


@router.delete("/{discipline_id}", response_model=DisciplineOut)
def deactivate_discipline(discipline_id: str) -> dict:
    with db_connection() as conn:
        get_or_404(conn, "disciplines", discipline_id)
        conn.execute("UPDATE disciplines SET is_active = 0, updated_at = ? WHERE id = ?", (utc_now_iso(), discipline_id))
        return row_to_dict(conn.execute("SELECT * FROM disciplines WHERE id = ?", (discipline_id,)).fetchone())
