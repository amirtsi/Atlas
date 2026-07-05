"""Atlas MCP server (P4a + coach bridge).

A stdio MCP server exposing Atlas as a READ + PROPOSE + NOTIFY surface for an
external agent (e.g. Hermes). It reuses Atlas's own db_connection() and service
layer in-process. It can read real state, create PENDING proposals, and queue
rate-limited messages to the owner (message_owner -> outbox; the app-side
dispatcher sends them, enforcing quiet hours and a daily cap). By design it
exposes no accept/dismiss/apply/delete/raw-SQL tool — nothing changes
fact-plane state without the owner accepting a proposal in the inbox.

Run: python -m app.mcp_server   (stdio transport)

NOTE: app.main must never import this module, so the core app stays importable
without the optional `mcp` dependency.
"""

from datetime import date, timedelta

from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP

from app.core.config import get_settings
from app.core.database import db_connection, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.communication.outbox import coach_quota_remaining, enqueue
from app.modules.dashboard.service import get_today_dashboard as _get_today_dashboard
from app.modules.planning.service import generate_replan_proposal as _generate_replan_proposal
from app.modules.planning.service import get_goal_plan as _get_goal_plan
from app.modules.planning.service import propose_plan_for_goal as _propose_plan_for_goal
from app.modules.proposals.service import create_proposal as _create_proposal

server = FastMCP("atlas")


# --- Read tools (real data only) -------------------------------------------

def atlas_snapshot() -> dict:
    """Real-signals dashboard snapshot (today/week counts, active modules, focus)."""
    return _get_today_dashboard()


def list_modules(status: str | None = None) -> list[dict]:
    """List life modules, optionally filtered by status; ordered by priority."""
    sql = "SELECT * FROM life_modules"
    params: list[object] = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY priority, name"
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


def list_goals(status: str | None = None) -> list[dict]:
    """List goals, optionally filtered by status; newest first."""
    sql = "SELECT * FROM goals"
    params: list[object] = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


def get_goal_plan(goal_id: str) -> dict:
    """Active/latest plan for a goal with real per-step progress and drift."""
    try:
        with db_connection() as conn:
            result = _get_goal_plan(conn, goal_id)
    except HTTPException as exc:
        return {"error": exc.detail, "status_code": exc.status_code}
    return result if result is not None else {"error": "no plan for this goal yet"}


def recent_activities(limit: int = 20) -> list[dict]:
    """Most recent real activities (limit capped to 1..100)."""
    capped = max(1, min(limit, 100))
    with db_connection() as conn:
        return rows_to_dicts(
            conn.execute(
                "SELECT * FROM activities ORDER BY occurred_at DESC LIMIT ?", (capped,)
            ).fetchall()
        )


def list_proposals(status: str = "pending") -> list[dict]:
    """List proposals; status='all' returns every proposal, newest first."""
    sql = "SELECT * FROM proposals"
    params: list[object] = []
    if status != "all":
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


# --- Propose-only write tools (create PENDING proposals; never apply) -------

def propose_module_status(module_id: str, status: str, rationale: str) -> dict:
    """Propose setting a module's status (pending; owner must accept to apply)."""
    try:
        with db_connection() as conn:
            return _create_proposal(
                conn,
                type="set_module_status",
                title=f"Set module status → {status}",
                rationale=rationale,
                payload={"module_id": module_id, "status": status},
                created_by="hermes",
            )
    except HTTPException as exc:
        return {"error": exc.detail, "status_code": exc.status_code}


def propose_module_priority(module_id: str, priority: int, rationale: str) -> dict:
    """Propose setting a module's priority (pending; owner must accept to apply)."""
    try:
        with db_connection() as conn:
            return _create_proposal(
                conn,
                type="set_module_priority",
                title=f"Set module priority → {priority}",
                rationale=rationale,
                payload={"module_id": module_id, "priority": priority},
                created_by="hermes",
            )
    except HTTPException as exc:
        return {"error": exc.detail, "status_code": exc.status_code}


def propose_plan(goal_id: str) -> dict:
    """Propose an LLM-decomposed plan for a goal (pending activate_plan proposal).

    Key-gated: without an AI key the planning service raises 422 and this returns
    an error object — never a fabricated plan.
    """
    try:
        with db_connection() as conn:
            return _propose_plan_for_goal(conn, goal_id, created_by="hermes")
    except HTTPException as exc:
        return {"error": exc.detail, "status_code": exc.status_code}


def request_replan(goal_id: str) -> dict:
    """Request a drift-driven re-plan proposal for a goal (pending; key-gated)."""
    try:
        with db_connection() as conn:
            result = _generate_replan_proposal(conn, goal_id, created_by="hermes")
    except HTTPException as exc:
        return {"error": exc.detail, "status_code": exc.status_code}
    return result if result is not None else {"status": "on_track"}


def message_owner(text: str) -> dict:
    """Queue a short WhatsApp message to the owner (rate-limited; never sends
    directly — Atlas's dispatcher sends it, enforcing quiet hours + daily cap)."""
    cleaned = (text or "").strip()
    if not cleaned:
        return {"error": "text must not be empty", "status_code": 422}
    if len(cleaned) > 1000:
        return {"error": "text too long (max 1000 characters)", "status_code": 422}
    with db_connection() as conn:
        remaining = coach_quota_remaining(conn, "coach_message")
        if remaining <= 0:
            resets = f"{date.fromisoformat(utc_now_iso()[:10]) + timedelta(days=1)}T00:00:00+00:00"
            return {"error": "quota_exhausted", "cap": get_settings().coach_message_daily_cap, "resets": resets}
        row = enqueue(conn, kind="coach_message", body=cleaned, created_by="hermes")
    return {"status": "queued", "outbox_id": row["id"], "quota_remaining_today": remaining - 1}


READ_TOOLS = [
    atlas_snapshot,
    list_modules,
    list_goals,
    get_goal_plan,
    recent_activities,
    list_proposals,
]

for _tool in READ_TOOLS:
    server.tool()(_tool)

WRITE_TOOLS = [
    propose_module_status,
    propose_module_priority,
    propose_plan,
    request_replan,
    message_owner,
]

for _tool in WRITE_TOOLS:
    server.tool()(_tool)

TOOL_NAMES = sorted(_tool.__name__ for _tool in [*READ_TOOLS, *WRITE_TOOLS])


def main() -> None:
    """Serve the MCP server over stdio."""
    server.run()


if __name__ == "__main__":
    main()
