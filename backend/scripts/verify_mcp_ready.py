"""Verify the Atlas MCP server is ready to receive an external agent (P4b).

Drives `python -m app.mcp_server` over REAL stdio exactly as Hermes will: performs
the MCP handshake, checks the exact 11-tool surface, calls a read tool and a
propose-only write tool, and confirms the proposal lands in the pending inbox.

Runs entirely against a throwaway TEMP database — it never touches your real Atlas
data. Prints "MCP READY" and exits 0 on success; prints the failure and exits 1
otherwise.

Usage (from anywhere):
    backend/.venv/bin/python backend/scripts/verify_mcp_ready.py
"""

import asyncio
import json
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

EXPECTED_TOOLS = {
    "atlas_snapshot",
    "list_modules",
    "list_goals",
    "get_goal_plan",
    "recent_activities",
    "list_proposals",
    "propose_module_status",
    "propose_module_priority",
    "propose_plan",
    "request_replan",
    "message_owner",
}


def _payload(result):
    """Read a FastMCP tool result: structuredContent when present (list returns
    are wrapped as {"result": [...]}), else fall back to parsing text content."""
    sc = result.structuredContent
    if sc is not None:
        if isinstance(sc, dict) and set(sc.keys()) == {"result"}:
            return sc["result"]
        return sc
    if len(result.content) == 1:
        return json.loads(result.content[0].text)
    return [json.loads(c.text) for c in result.content]


async def _run(env: dict) -> None:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "app.mcp_server"],
        env=env,
        cwd=str(BACKEND),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            names = {t.name for t in (await session.list_tools()).tools}
            assert names == EXPECTED_TOOLS, f"tool surface drift: {names ^ EXPECTED_TOOLS}"
            print(f"  handshake OK; {len(names)} tools (exact allowed surface)")

            modules = _payload(await session.call_tool("list_modules", {}))
            assert isinstance(modules, list) and modules, "no modules returned"
            print(f"  read OK; list_modules -> {len(modules)} modules")

            snap = _payload(await session.call_tool("atlas_snapshot", {}))
            assert "real_signals" in snap, "snapshot missing real_signals"
            print("  read OK; atlas_snapshot -> real_signals present")

            proposal = _payload(
                await session.call_tool(
                    "propose_module_priority",
                    {"module_id": modules[0]["id"], "priority": 1, "rationale": "readiness check"},
                )
            )
            assert proposal.get("status") == "pending", "proposal not pending"
            assert proposal.get("created_by") == "hermes", "proposal not attributed to hermes"
            print("  propose OK; pending proposal created_by=hermes (nothing applied)")

            pending = _payload(await session.call_tool("list_proposals", {}))
            assert any(p["id"] == proposal["id"] for p in pending), "proposal missing from inbox"
            print("  inbox OK; proposal visible in the pending inbox")

            note = _payload(await session.call_tool("message_owner", {"text": "readiness check"}))
            assert note.get("status") == "queued", "message_owner did not queue"
            print("  notify OK; message_owner queued (app-side dispatcher sends it)")


def main() -> int:
    import os

    from app.core.database import initialize_database

    tmpdir = tempfile.mkdtemp(prefix="atlas-mcp-ready-")
    try:
        db_path = str(Path(tmpdir) / "atlas.sqlite")
        # Child server inherits the full env with the temp DB path overridden.
        env = {**os.environ, "ATLAS_DATABASE_PATH": db_path}
        # Parent process builds+seeds the same temp DB the child server will read.
        os.environ["ATLAS_DATABASE_PATH"] = db_path
        initialize_database()
        asyncio.run(_run(env))
    except Exception as exc:  # noqa: BLE001 - readiness check reports any failure
        print(f"\nMCP NOT READY: {type(exc).__name__}: {exc}")
        return 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    print("\nMCP READY — the Atlas MCP server serves over stdio and the propose loop works.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
