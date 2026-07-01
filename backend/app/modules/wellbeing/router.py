from sqlite3 import Connection

from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, new_id, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.activity_ledger.service import insert_activity
from app.modules.life_modules.behavior import WELLBEING_TYPES, build_behavior
from app.shared.audit import record_audit_event
from app.shared.schemas import ActivityCreate, WellbeingSessionCreate
from app.shared.sql import get_or_404

router = APIRouter(prefix="/wellbeing", tags=["wellbeing"])


def _get_wellbeing_module(conn: Connection, module_id: str) -> dict:
    module = get_or_404(conn, "life_modules", module_id)
    if module["type"] not in WELLBEING_TYPES:
        raise HTTPException(status_code=422, detail="Module does not track wellbeing sessions")
    return module


@router.get("/{module_id}/overview")
def wellbeing_overview(module_id: str) -> dict:
    with db_connection() as conn:
        module = _get_wellbeing_module(conn, module_id)
        config = WELLBEING_TYPES[module["type"]]
        recent_sessions = rows_to_dicts(
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
        trends: dict[str, list[float]] = {}
        for definition in config["metrics"]:
            rows = conn.execute(
                """
                SELECT value_number FROM metrics
                WHERE module_id = ? AND metric_key = ? AND value_number IS NOT NULL
                ORDER BY recorded_at DESC LIMIT 12
                """,
                (module_id, definition["key"]),
            ).fetchall()
            trends[definition["key"]] = [row["value_number"] for row in rows][::-1]
        return {
            "module": module,
            "metric_defs": config["metrics"],
            "summary": build_behavior(conn, module)["summary"],
            "recent_sessions": recent_sessions,
            "trends": trends,
        }


@router.post("/{module_id}/session", status_code=201)
def log_session(module_id: str, payload: WellbeingSessionCreate) -> dict:
    """Log a real session: an activity in the ledger plus the metrics recorded for it."""
    now = utc_now_iso()
    with db_connection() as conn:
        module = _get_wellbeing_module(conn, module_id)
        config = WELLBEING_TYPES[module["type"]]
        definitions = {definition["key"]: definition for definition in config["metrics"]}

        activity = insert_activity(
            conn,
            ActivityCreate(
                module_id=module_id,
                discipline_id=module["discipline_id"],
                activity_type=config["activity_type"],
                title=config["session_title"],
                notes=payload.notes,
                duration_minutes=payload.duration_minutes,
                source="quick_log",
                metadata={"wellbeing": True},
            ),
        )

        recorded: list[str] = []
        for key, value in payload.values.items():
            definition = definitions.get(key)
            if definition is None or value is None:
                continue
            conn.execute(
                """
                INSERT INTO metrics
                  (id, discipline_id, module_id, activity_id, metric_key, value_number,
                   scale_min, scale_max, recorded_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id(),
                    module["discipline_id"],
                    module_id,
                    activity["id"],
                    key,
                    value,
                    definition["min"],
                    definition["max"],
                    activity["occurred_at"],
                    now,
                ),
            )
            recorded.append(key)

        record_audit_event(
            conn,
            entity_type="activity",
            entity_id=activity["id"],
            action="wellbeing_session",
            summary=f"Logged {config['session_title']}",
            changes={"module_id": module_id, "metrics": recorded},
        )
        return {"activity": activity, "metrics_recorded": recorded}
