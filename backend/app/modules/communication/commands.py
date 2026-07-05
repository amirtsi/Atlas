"""Owner reply commands for the proposal inbox ("accept a1b2c3" / "דחה a1b2c3").

Anchored whole-message matching (^...$ after trim) so ordinary logged messages
("accept the offer from Dana") never match and fall through to the classifier.
Refs are uuid prefixes (>=4 hex chars; pings use the first 6) resolved against
PENDING proposals only. Every reply starts with ✅ so the webhook loop-guard
(_looks_like_atlas_reply) skips our own bounced confirmations.
"""
from __future__ import annotations

import re
from sqlite3 import Connection

from fastapi import HTTPException

from app.core.database import rows_to_dicts
from app.modules.communication.outbox import short_ref
from app.modules.proposals.service import accept_proposal, dismiss_proposal

_ACCEPT = r"accept|approve|yes|ok|אשר|קבל|כן"
_DISMISS = r"dismiss|reject|no|דחה|לא"
_COMMAND_RE = re.compile(
    rf"^(?:(?P<accept>{_ACCEPT})|(?P<dismiss>{_DISMISS}))\s*#?(?P<ref>[0-9a-fA-F-]{{4,36}})?$",
    re.IGNORECASE,
)


def parse_proposal_command(text: str | None) -> dict | None:
    match = _COMMAND_RE.match((text or "").strip())
    if not match:
        return None
    action = "accept" if match.group("accept") else "dismiss"
    ref = match.group("ref")
    return {"action": action, "ref": ref.lower() if ref else None}


def _pending(conn: Connection) -> list[dict]:
    return rows_to_dicts(
        conn.execute("SELECT * FROM proposals WHERE status = 'pending' ORDER BY created_at DESC").fetchall()
    )


def _pending_list_reply(pending: list[dict]) -> str:
    lines = ["✅ הצעות ממתינות:"]
    lines += [f"• {short_ref(p['id'])} — {p['title']}" for p in pending]
    lines.append("Reply: accept <id> / dismiss <id> (אשר / דחה)")
    return "\n".join(lines)


def execute_proposal_command(conn: Connection, command: dict) -> str:
    pending = _pending(conn)
    ref = command["ref"]
    if ref:
        matches = [p for p in pending if p["id"].lower().startswith(ref)]
        if not matches:
            return f"✅ לא נמצאה הצעה ממתינה שמתחילה ב-{ref}. (No pending proposal matching {ref}.)"
        if len(matches) > 1:
            return _pending_list_reply(matches)
    else:
        if not pending:
            return "✅ אין הצעות ממתינות. (No pending proposals.)"
        if len(pending) > 1:
            return _pending_list_reply(pending)
        matches = pending

    proposal = matches[0]
    try:
        if command["action"] == "accept":
            updated = accept_proposal(conn, proposal["id"])
            return f"✅ אושר: {updated['title']}"
        updated = dismiss_proposal(conn, proposal["id"])
        return f"✅ נדחה: {updated['title']}"
    except HTTPException as exc:
        return f"✅ לא בוצע: {exc.detail}"
