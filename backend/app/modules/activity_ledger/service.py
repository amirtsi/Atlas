"""Activity-ledger service layer.

The one validated path for writing a real activity to the fact plane. Kept out of
the router so it can be called by any entry point — HTTP routes, the WhatsApp
classifier, the daily-brief flow, and (soon) the MCP/Hermes layer — without any
module reaching into another module's route handler.
"""

from __future__ import annotations

from sqlite3 import Connection

from app.core.config import get_settings
from app.core.database import new_id
from app.core.time import to_utc_iso, utc_now_iso
from app.shared.audit import record_audit_event
from app.shared.schemas import ActivityCreate
from app.shared.sql import get_or_404, json_dump


def insert_activity(conn: Connection, payload: ActivityCreate) -> dict:
    now = utc_now_iso()
    activity_id = new_id()
    # Normalize to tz-aware UTC; a naive client value is read as the local timezone.
    occurred_at = to_utc_iso(payload.occurred_at, assume_tz=get_settings().timezone) or now
    if payload.discipline_id:
        get_or_404(conn, "disciplines", payload.discipline_id)
    if payload.module_id:
        module = get_or_404(conn, "life_modules", payload.module_id)
        if payload.discipline_id is None:
            payload.discipline_id = module["discipline_id"]
    conn.execute(
        """
        INSERT INTO activities
          (id, discipline_id, module_id, activity_type, title, notes, occurred_at,
           duration_minutes, energy_level, mood_level, source, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            activity_id,
            payload.discipline_id,
            payload.module_id,
            payload.activity_type,
            payload.title,
            payload.notes,
            occurred_at,
            payload.duration_minutes,
            payload.energy_level,
            payload.mood_level,
            payload.source,
            json_dump(payload.metadata),
            now,
            now,
        ),
    )
    activity = get_or_404(conn, "activities", activity_id)
    record_audit_event(
        conn,
        entity_type="activity",
        entity_id=activity_id,
        action="created",
        summary=f"Logged activity: {activity['title']}",
        changes={"title": activity["title"], "source": activity["source"], "module_id": activity["module_id"]},
    )
    return activity
