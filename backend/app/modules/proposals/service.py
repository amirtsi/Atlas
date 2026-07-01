"""Proposal inbox service — advisory create / accept / dismiss.

Nothing changes until the owner accepts. Accept dispatches by type through a
handler registry (OCP: new types register a handler, no dispatcher edit) to the
validated life_modules service. Every transition is audited.
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from sqlite3 import Connection

from fastapi import HTTPException

from app.core.database import new_id
from app.core.time import utc_now_iso
from app.modules.life_modules.service import set_module_priority, set_module_status
from app.shared.audit import record_audit_event
from app.shared.sql import get_or_404, json_dump

ProposalHandler = Callable[[Connection, dict], dict]


def _apply_set_module_priority(conn: Connection, payload: dict) -> dict:
    return set_module_priority(conn, payload["module_id"], int(payload["priority"]))


def _apply_set_module_status(conn: Connection, payload: dict) -> dict:
    return set_module_status(conn, payload["module_id"], str(payload["status"]))


_HANDLERS: dict[str, ProposalHandler] = {
    "set_module_priority": _apply_set_module_priority,
    "set_module_status": _apply_set_module_status,
}


def register_proposal_handler(proposal_type: str, handler: ProposalHandler) -> None:
    """Let other domains add proposal types without proposals importing them (avoids
    an import cycle and keeps this module closed to modification — OCP)."""
    _HANDLERS[proposal_type] = handler


class _KnownTypes:
    def __contains__(self, item: object) -> bool:
        return item in _HANDLERS

    def __iter__(self):
        return iter(_HANDLERS)


KNOWN_TYPES = _KnownTypes()


def create_proposal(
    conn: Connection, type: str, title: str, rationale: str | None, payload: dict, created_by: str = "system"
) -> dict:
    if type not in _HANDLERS:
        raise HTTPException(status_code=422, detail="Unknown proposal type")
    module_id = payload.get("module_id")
    if module_id:
        get_or_404(conn, "life_modules", module_id)
    proposal_id = new_id()
    now = utc_now_iso()
    conn.execute(
        """
        INSERT INTO proposals (id, type, title, rationale, payload, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        """,
        (proposal_id, type, title, rationale, json_dump(payload), created_by, now),
    )
    proposal = get_or_404(conn, "proposals", proposal_id)
    record_audit_event(
        conn,
        entity_type="proposal",
        entity_id=proposal_id,
        action="created",
        summary=f"Proposal created: {title}",
        changes={"type": type, "created_by": created_by},
    )
    return proposal


def accept_proposal(conn: Connection, proposal_id: str) -> dict:
    proposal = get_or_404(conn, "proposals", proposal_id)
    if proposal["status"] != "pending":
        raise HTTPException(status_code=409, detail="Proposal already resolved")
    handler = _HANDLERS.get(proposal["type"])
    if handler is None:
        raise HTTPException(status_code=422, detail="Unknown proposal type")
    handler(conn, proposal["payload"])
    now = utc_now_iso()
    conn.execute(
        "UPDATE proposals SET status = 'accepted', resolved_at = ? WHERE id = ?",
        (now, proposal_id),
    )
    updated = get_or_404(conn, "proposals", proposal_id)
    record_audit_event(
        conn,
        entity_type="proposal",
        entity_id=proposal_id,
        action="accepted",
        summary=f"Proposal accepted: {updated['title']}",
        changes={"type": updated["type"]},
    )
    return updated


def dismiss_proposal(conn: Connection, proposal_id: str) -> dict:
    proposal = get_or_404(conn, "proposals", proposal_id)
    if proposal["status"] != "pending":
        raise HTTPException(status_code=409, detail="Proposal already resolved")
    now = utc_now_iso()
    conn.execute(
        "UPDATE proposals SET status = 'dismissed', resolved_at = ? WHERE id = ?",
        (now, proposal_id),
    )
    updated = get_or_404(conn, "proposals", proposal_id)
    record_audit_event(
        conn,
        entity_type="proposal",
        entity_id=proposal_id,
        action="dismissed",
        summary=f"Proposal dismissed: {updated['title']}",
        changes={},
    )
    return updated


def _has_pending(conn: Connection, type: str, module_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM proposals WHERE status = 'pending' AND type = ? "
        "AND json_extract(payload, '$.module_id') = ? LIMIT 1",
        (type, module_id),
    ).fetchone()
    return row is not None


def generate_module_proposals(conn: Connection) -> list[dict]:
    """Honest heuristic: an active module with no activity in 14 days -> propose archive.
    Idempotent (skips modules that already have a pending archive proposal)."""
    cutoff = (datetime.now(UTC) - timedelta(days=14)).replace(microsecond=0).isoformat()
    stale = conn.execute(
        """
        SELECT lm.id, lm.name FROM life_modules lm
        WHERE lm.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM activities a WHERE a.module_id = lm.id AND a.occurred_at >= ?
          )
        ORDER BY lm.name
        """,
        (cutoff,),
    ).fetchall()
    created: list[dict] = []
    for module in stale:
        if _has_pending(conn, "set_module_status", module["id"]):
            continue
        created.append(
            create_proposal(
                conn,
                "set_module_status",
                f"Archive {module['name']}? No activity in 14 days",
                "No logged activity in the last 14 days — archive to keep the active set focused.",
                {"module_id": module["id"], "status": "archived"},
            )
        )
    return created
