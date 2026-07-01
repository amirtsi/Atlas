"""Atlas MCP server (P4a).

A stdio MCP server exposing Atlas as a READ + PROPOSE-ONLY surface for an
external agent (e.g. Hermes). It reuses Atlas's own db_connection() and service
layer in-process. It can read real state and create PENDING proposals, but by
design exposes no accept/dismiss/apply/delete/raw-SQL tool — nothing changes
fact-plane state without the owner accepting a proposal in the inbox.

Run: python -m app.mcp_server   (stdio transport)

NOTE: app.main must never import this module, so the core app stays importable
without the optional `mcp` dependency.
"""

from mcp.server.fastmcp import FastMCP

from app.core.database import db_connection, rows_to_dicts
from app.modules.dashboard.service import get_today_dashboard as _get_today_dashboard
from app.modules.planning.service import get_goal_plan as _get_goal_plan

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
    from fastapi import HTTPException

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


def main() -> None:
    """Serve the MCP server over stdio."""
    server.run()


if __name__ == "__main__":
    main()
