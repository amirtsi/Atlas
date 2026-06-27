from typing import Any

from app.core.database import new_id
from app.core.time import utc_now_iso
from app.shared.sql import json_dump


def record_audit_event(
    conn,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    summary: str,
    changes: dict[str, Any] | None = None,
    actor: str = "local_user",
) -> None:
    now = utc_now_iso()
    conn.execute(
        """
        INSERT INTO audit_events
          (id, entity_type, entity_id, action, summary, changes, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (new_id(), entity_type, entity_id, action, summary, json_dump(changes), actor, now),
    )
