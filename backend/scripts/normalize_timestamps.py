"""One-time migration: normalize every stored timestamp to tz-aware UTC ISO.

Rules (matching how the data was produced):
  * already-aware values (``+HH:MM`` / ``Z``)         -> left untouched (idempotent)
  * naive, space-separated (SQLite ``datetime('now')``) -> read as UTC
  * naive, ``T``-separated (seeded wall-clock)          -> read as the configured
                                                          timezone, then -> UTC

The frontend renders timestamps in the browser's local zone, so converting the
seeded ``T`` values from local->UTC preserves the wall-clock the user sees.

Backs the database up first. Re-runnable; only non-aware values are rewritten.

    cd backend && .venv/bin/python -m scripts.normalize_timestamps
"""

import shutil
import sqlite3
from datetime import UTC, datetime

from app.core.config import get_settings
from app.core.time import to_utc_iso


def _is_aware(value: str) -> bool:
    return ("+" in value[10:]) or value.endswith("Z")


def _classify(value) -> str:
    if not isinstance(value, str) or not value.strip():
        return "empty"
    if _is_aware(value):
        return "aware"
    return "naive_space" if " " in value else "naive_T"


def main() -> None:
    settings = get_settings()
    db_path = settings.resolved_database_path
    tz = settings.timezone

    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup = db_path.parent / f"{db_path.name}.bak-{stamp}"
    shutil.copy2(db_path, backup)

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]

    changed = 0
    for table in tables:
        cols = [c[1] for c in con.execute(f"PRAGMA table_info({table})").fetchall()]
        ts_cols = [c for c in cols if c.endswith("_at")]
        if not ts_cols or "id" not in cols:
            continue
        rows = con.execute(f"SELECT id, {', '.join(ts_cols)} FROM {table}").fetchall()
        for row in rows:
            updates: dict[str, str] = {}
            for col in ts_cols:
                value = row[col]
                kind = _classify(value)
                if kind == "naive_space":
                    new_value = to_utc_iso(value, assume_tz="UTC")
                elif kind == "naive_T":
                    new_value = to_utc_iso(value, assume_tz=tz)
                else:
                    continue
                if new_value and new_value != value:
                    updates[col] = new_value
            if updates:
                assignments = ", ".join(f"{col} = ?" for col in updates)
                con.execute(f"UPDATE {table} SET {assignments} WHERE id = ?", (*updates.values(), row["id"]))
                changed += len(updates)
                for col, new_value in updates.items():
                    print(f"  {table}.{col} [{row['id'][:8]}]: {row[col]} -> {new_value}")

    con.commit()
    con.close()
    print(f"\nBackup written: {backup}")
    print(f"Normalized {changed} timestamp value(s) across {len(tables)} tables.")


if __name__ == "__main__":
    main()
