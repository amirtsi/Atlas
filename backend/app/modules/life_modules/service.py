"""Life-modules mutation service.

The validated write paths for a module's status and priority, callable from the
router AND from other modules (e.g. the proposal accept-handler) without reaching
into the router. Mirrors the activity_ledger/dashboard service-layer pattern.
"""
from __future__ import annotations

from sqlite3 import Connection

from fastapi import HTTPException

from app.core.database import row_to_dict
from app.core.time import utc_now_iso
from app.shared.audit import record_audit_event
from app.shared.sql import get_or_404

VALID_STATUSES = {"active", "paused", "completed", "archived"}


def set_module_status(conn: Connection, module_id: str, status: str) -> dict:
    if status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported module status")
    now = utc_now_iso()
    get_or_404(conn, "life_modules", module_id)
    archived_at = now if status == "archived" else None
    conn.execute(
        "UPDATE life_modules SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?",
        (status, archived_at, now, module_id),
    )
    module = row_to_dict(conn.execute("SELECT * FROM life_modules WHERE id = ?", (module_id,)).fetchone())
    record_audit_event(
        conn,
        entity_type="life_module",
        entity_id=module_id,
        action=f"status_{status}",
        summary=f"Set module {module['name']} to {status}",
        changes={"status": status},
    )
    return module


def set_module_priority(conn: Connection, module_id: str, priority: int) -> dict:
    now = utc_now_iso()
    get_or_404(conn, "life_modules", module_id)
    conn.execute(
        "UPDATE life_modules SET priority = ?, updated_at = ? WHERE id = ?",
        (priority, now, module_id),
    )
    updated = get_or_404(conn, "life_modules", module_id)
    record_audit_event(
        conn,
        entity_type="life_module",
        entity_id=module_id,
        action="priority_changed",
        summary=f"Set {updated['name']} priority to {priority}",
        changes={"priority": priority},
    )
    return updated
