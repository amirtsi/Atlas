# Atlas MCP Server — Setup (P4a)

The Atlas MCP server exposes Atlas to an external MCP client (e.g. Hermes) as a
**read + propose-only** surface: it can read real state and create **pending**
proposals, but never accepts/applies/deletes anything. The owner approves every
proposal in the Coach inbox.

## Install

From `backend/`:

```bash
.venv/bin/pip install -e ".[mcp]"
```

## Run (stdio)

```bash
cd backend && .venv/bin/python -m app.mcp_server
```

The server uses the same SQLite database as the Atlas API (via `ATLAS_DATABASE_PATH`).
Plan tools (`propose_plan`, `request_replan`) require `ATLAS_ANTHROPIC_API_KEY`;
without it they return an error object, never a fabricated plan.

## Client config (stdio)

Point your MCP client at the module entrypoint. Example config shape:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "/absolute/path/to/backend/.venv/bin/python",
      "args": ["-m", "app.mcp_server"],
      "cwd": "/absolute/path/to/backend",
      "env": { "ATLAS_DATABASE_PATH": "/absolute/path/to/atlas.sqlite" }
    }
  }
}
```

## Tools

Reads: `atlas_snapshot`, `list_modules`, `list_goals`, `get_goal_plan`,
`recent_activities`, `list_proposals`.

Propose-only writes (create `pending` proposals, `created_by="hermes"`; nothing
applies until you accept): `propose_module_status`, `propose_module_priority`,
`propose_plan`, `request_replan`. Plan/re-plan proposals are also tagged
`created_by="hermes"` (the planning service takes a `created_by` passthrough); the
`/planning/**` REST endpoints still default to `created_by="system"`.
