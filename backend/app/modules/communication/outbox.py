"""Outbound coach-communication queue (the "outbox").

Producers — the proposal-creation hook, the message_owner MCP tool, and the
nudge pass — only ENQUEUE rows here; nothing sends at enqueue time. One
dispatcher (scheduler.run_outbox_dispatcher) drains the queue through the
existing bridge send path, so quiet hours, daily caps and retry backoff are
enforced in exactly one place, and messages survive restarts.

Dependency-light on purpose: sqlite + config + time only. The MCP server runs
as a separate process and imports this module; it must not drag in FastAPI.
Router helpers are lazy-imported inside dispatch to avoid an import cycle.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from sqlite3 import Connection

from app.core.config import get_settings
from app.core.database import db_connection, new_id, rows_to_dicts
from app.core.time import utc_now_iso

logger = logging.getLogger("atlas.outbox")

KINDS = ("proposal", "coach_message", "nudge")
MAX_ATTEMPTS = 5


def short_ref(proposal_id: str) -> str:
    """Human-typeable reference for a WhatsApp reply (uuid prefix)."""
    return proposal_id[:6]


def in_quiet_hours(now_local: datetime, start_hour: int, end_hour: int) -> bool:
    if start_hour == end_hour:
        return False
    if start_hour < end_hour:
        return start_hour <= now_local.hour < end_hour
    return now_local.hour >= start_hour or now_local.hour < end_hour


def enqueue(
    conn: Connection,
    *,
    kind: str,
    body: str,
    ref_type: str | None = None,
    ref_id: str | None = None,
    created_by: str = "atlas",
) -> dict:
    if kind not in KINDS:
        raise ValueError(f"unknown outbox kind: {kind}")
    row_id = new_id()
    conn.execute(
        "INSERT INTO outbox (id, kind, body, ref_type, ref_id, created_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (row_id, kind, body, ref_type, ref_id, created_by, utc_now_iso()),
    )
    row = conn.execute("SELECT * FROM outbox WHERE id = ?", (row_id,)).fetchone()
    return rows_to_dicts([row])[0]


def enqueue_proposal_ping(conn: Connection, proposal: dict) -> dict | None:
    """Queue the owner ping for a new proposal. Exactly one ping per proposal
    (idempotent); the row's created_by mirrors the proposal's origin."""
    existing = conn.execute(
        "SELECT 1 FROM outbox WHERE ref_type = 'proposal' AND ref_id = ? LIMIT 1",
        (proposal["id"],),
    ).fetchone()
    if existing:
        return None
    ref = short_ref(proposal["id"])
    lines = [f"🤖 הצעה {ref} — {proposal['title']}"]
    rationale = (proposal.get("rationale") or "").strip()
    if rationale:
        lines.append(rationale)
    lines.append(f"Reply: accept {ref} / dismiss {ref} (אשר {ref} / דחה {ref})")
    return enqueue(
        conn,
        kind="proposal",
        body="\n".join(lines),
        ref_type="proposal",
        ref_id=proposal["id"],
        created_by=proposal.get("created_by") or "system",
    )


def _count_created_today(conn: Connection, kind: str) -> int:
    today = utc_now_iso()[:10]
    row = conn.execute(
        "SELECT COUNT(*) FROM outbox WHERE kind = ? AND status != 'failed' "
        "AND substr(created_at, 1, 10) = ?",
        (kind, today),
    ).fetchone()
    return int(row[0])


def _daily_cap(kind: str) -> int | None:
    settings = get_settings()
    return {
        "coach_message": settings.coach_message_daily_cap,
        "nudge": settings.nudge_daily_cap,
    }.get(kind)


def coach_quota_remaining(conn: Connection, kind: str) -> int:
    cap = _daily_cap(kind)
    if cap is None:
        raise ValueError(f"kind has no daily cap: {kind}")
    return max(0, cap - _count_created_today(conn, kind))


def _sent_today(conn: Connection, kind: str) -> int:
    today = utc_now_iso()[:10]
    row = conn.execute(
        "SELECT COUNT(*) FROM outbox WHERE kind = ? AND status = 'sent' "
        "AND substr(sent_at, 1, 10) = ?",
        (kind, today),
    ).fetchone()
    return int(row[0])


def dispatch_pending(conn: Connection, *, now_local: datetime | None = None) -> list[dict]:
    """Send eligible queued rows through the existing bridge send path.

    ALL policy lives here: quiet hours, per-kind daily caps, retry backoff.
    Returns one result dict per row acted on (for logging/tests)."""
    from zoneinfo import ZoneInfo

    from app.modules.communication.evolution import normalize_whatsapp_number
    from app.modules.communication.router import _active_evolution_provider, _send_and_store_reply

    settings = get_settings()
    now_local = now_local or datetime.now(ZoneInfo(settings.timezone))
    if in_quiet_hours(now_local, settings.quiet_hours_start, settings.quiet_hours_end):
        return []

    provider = _active_evolution_provider(conn)
    if provider is None:
        logger.warning("Outbox: no active WhatsApp provider; queued rows are held.")
        return []
    recipient = normalize_whatsapp_number(
        str((provider.get("config") or {}).get("default_recipient") or "")
    )
    if not recipient:
        logger.warning("Outbox: active provider has no default_recipient; queued rows are held.")
        return []

    rows = rows_to_dicts(
        conn.execute(
            "SELECT * FROM outbox WHERE status = 'queued' "
            "AND (next_attempt_at IS NULL OR next_attempt_at <= ?) "
            "ORDER BY created_at",
            (utc_now_iso(),),
        ).fetchall()
    )
    results: list[dict] = []
    for row in rows:
        cap = _daily_cap(row["kind"])
        if cap is not None and _sent_today(conn, row["kind"]) >= cap:
            results.append({"outbox_id": row["id"], "status": "held_daily_cap"})
            continue
        message_id = _send_and_store_reply(conn, provider, recipient, row["body"])
        message = conn.execute(
            "SELECT status, error FROM communication_messages WHERE id = ?", (message_id,)
        ).fetchone()
        if message["status"] == "failed":
            attempts = row["attempts"] + 1
            if attempts >= MAX_ATTEMPTS:
                conn.execute(
                    "UPDATE outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?",
                    (attempts, message["error"], row["id"]),
                )
                results.append({"outbox_id": row["id"], "status": "failed"})
            else:
                next_attempt = (
                    (datetime.now(UTC) + timedelta(minutes=2**attempts))
                    .replace(microsecond=0)
                    .isoformat()
                )
                conn.execute(
                    "UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?",
                    (attempts, message["error"], next_attempt, row["id"]),
                )
                results.append({"outbox_id": row["id"], "status": "retry_scheduled"})
        else:
            conn.execute(
                "UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?",
                (utc_now_iso(), row["id"]),
            )
            results.append({"outbox_id": row["id"], "status": "sent", "message_id": message_id})
    return results


def run_dispatch_tick() -> list[dict]:
    """One dispatcher heartbeat (opens its own connection; scheduler calls this)."""
    with db_connection() as conn:
        return dispatch_pending(conn)
