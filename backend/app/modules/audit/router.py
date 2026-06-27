from fastapi import APIRouter

from app.core.database import db_connection, rows_to_dicts

router = APIRouter(prefix="/audit-events", tags=["audit"])


@router.get("")
def list_audit_events(
    entity_type: str | None = None,
    entity_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    where: list[str] = []
    params: list[object] = []
    if entity_type:
        where.append("entity_type = ?")
        params.append(entity_type)
    if entity_id:
        where.append("entity_id = ?")
        params.append(entity_id)

    sql = "SELECT * FROM audit_events"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())
