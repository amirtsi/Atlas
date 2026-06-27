from fastapi import APIRouter

from app.core.database import db_connection, new_id, rows_to_dicts
from app.core.time import utc_now_iso
from app.shared.schemas import MetricCreate
from app.shared.sql import get_or_404

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("")
def list_metrics(
    discipline_id: str | None = None,
    module_id: str | None = None,
    activity_id: str | None = None,
    metric_key: str | None = None,
    limit: int = 100,
) -> list[dict]:
    where: list[str] = []
    params: list[object] = []
    if discipline_id:
        where.append("discipline_id = ?")
        params.append(discipline_id)
    if module_id:
        where.append("module_id = ?")
        params.append(module_id)
    if activity_id:
        where.append("activity_id = ?")
        params.append(activity_id)
    if metric_key:
        where.append("metric_key = ?")
        params.append(metric_key)
    sql = "SELECT * FROM metrics"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY recorded_at DESC LIMIT ?"
    params.append(limit)
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("", status_code=201)
def create_metric(payload: MetricCreate) -> dict:
    now = utc_now_iso()
    recorded_at = payload.recorded_at or now
    with db_connection() as conn:
        if payload.discipline_id:
            get_or_404(conn, "disciplines", payload.discipline_id)
        if payload.module_id:
            get_or_404(conn, "life_modules", payload.module_id)
        if payload.activity_id:
            get_or_404(conn, "activities", payload.activity_id)
        metric_id = new_id()
        conn.execute(
            """
            INSERT INTO metrics
              (id, discipline_id, module_id, activity_id, metric_key, value_number,
               value_text, scale_min, scale_max, unit, recorded_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                metric_id,
                payload.discipline_id,
                payload.module_id,
                payload.activity_id,
                payload.metric_key,
                payload.value_number,
                payload.value_text,
                payload.scale_min,
                payload.scale_max,
                payload.unit,
                recorded_at,
                now,
            ),
        )
        return get_or_404(conn, "metrics", metric_id)
