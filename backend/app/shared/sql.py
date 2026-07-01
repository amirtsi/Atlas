import json
import sqlite3
from typing import Any

from fastapi import HTTPException

from app.core.database import row_to_dict
from app.core.time import utc_now_iso


def get_or_404(conn: sqlite3.Connection, table: str, item_id: str) -> dict:
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone()
    item = row_to_dict(row)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


def json_dump(value: dict[str, Any] | None) -> str:
    return json.dumps(value or {}, separators=(",", ":"))


def apply_update(
    conn: sqlite3.Connection,
    table: str,
    item_id: str,
    payload: dict[str, Any],
    allowed_fields: set[str],
) -> dict:
    updates = {key: value for key, value in payload.items() if key in allowed_fields and value is not None}
    if not updates:
        return get_or_404(conn, table, item_id)

    assignments = ", ".join(f"{key} = ?" for key in updates)
    values = [json_dump(value) if isinstance(value, dict) else value for value in updates.values()]
    # tz-aware UTC ISO, consistent with utc_now_iso() everywhere else (SQLite's
    # datetime('now') produces a naive, space-separated UTC string instead).
    conn.execute(f"UPDATE {table} SET {assignments}, updated_at = ? WHERE id = ?", (*values, utc_now_iso(), item_id))
    return get_or_404(conn, table, item_id)
