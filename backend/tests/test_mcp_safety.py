import asyncio
from pathlib import Path

from app import mcp_server

ALLOWED = {
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
}
FORBIDDEN_SUBSTRINGS = ("accept", "dismiss", "delete", "apply", "sql", "drop", "truncate", "remove")


def test_tool_set_is_exactly_the_allowed_surface():
    assert set(mcp_server.TOOL_NAMES) == ALLOWED


def test_no_forbidden_mutating_tools_exposed():
    for name in mcp_server.TOOL_NAMES:
        assert not any(bad in name for bad in FORBIDDEN_SUBSTRINGS), name


def test_registry_matches_declared_tool_names():
    # Harden the guard: assert against what FastMCP actually registered, not just
    # the declared lists — catches a tool added via a direct @server.tool()
    # decorator that bypassed READ_TOOLS/WRITE_TOOLS.
    registered = {tool.name for tool in asyncio.run(mcp_server.server.list_tools())}
    assert registered == ALLOWED


def test_main_module_does_not_import_mcp_server():
    # The core app must stay importable without the optional `mcp` dependency,
    # so main.py must not import the MCP server module.
    main_src = Path(mcp_server.__file__).with_name("main.py").read_text()
    assert "mcp_server" not in main_src
