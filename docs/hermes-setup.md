# Hermes Setup (P4b) — wiring Nous Hermes to Atlas

This guide connects **Nous Research Hermes Agent** to Atlas as the forward-planning /
coaching brain, through the **Atlas MCP server** (P4a). Hermes reads real Atlas state and
files **proposals**; you approve them in the Coach inbox. Hermes never changes fact-plane
state directly — the MCP surface is read + propose-only (see `docs/atlas-mcp-setup.md`).

> Status: the Atlas side is fully built and merged (P0–P4a). This is the operational
> step — installing/running Hermes and providing the API key — which is done on your
> machine. Nothing below writes to Atlas without your approval.

## Architecture recap

```
Hermes (own process, cron, memory)         Atlas
  │  MCP client                              │
  └───────────►  python -m app.mcp_server ───┤  read: snapshot / modules / goals /
                 (stdio, read + propose-only) │        plan+drift / activities / proposals
                                              │  propose (→ pending, created_by="hermes"):
                                              │        module status/priority, plan, re-plan
                                              ▼
                                      Coach inbox  ──►  you accept  ──►  applied via
                                                                        validated service
```

- Hermes is an **MCP client only** (no REST API, can't be an MCP server). Atlas exposes the
  server; Hermes consumes it. See [[atlas-hermes-coach-architecture]] for the full rationale.
- Hermes runs its own WhatsApp bridge that **conflicts** with Atlas's Evolution number — do
  not point both at the same number. Use a separate channel for Hermes (Telegram is the
  recommended additive channel; keep the Evolution/WhatsApp line as Atlas's quick-log).

## Prerequisites

1. Atlas backend working with its venv (`backend/.venv`) and a real database
   (`ATLAS_DATABASE_PATH`). Note the **Desktop** copy is the active one (see
   [[atlas-two-backends-gotcha]]).
2. The MCP extra installed: from `backend/`, `.venv/bin/pip install -e ".[mcp]"`.
3. Confirm the server starts: `cd backend && .venv/bin/python -m app.mcp_server`
   (it serves over stdio; Ctrl-C to stop). If it imports and waits, it's healthy.

## Step 1 — provide the AI key (for plan/re-plan)

The plan tools (`propose_plan`, `request_replan`) call Atlas's LLM decomposition, which is
gated on `ATLAS_ANTHROPIC_API_KEY`. Without it those tools return an honest error object
(never a fabricated plan); reads and module proposals work regardless.

Set the key in the environment that runs the MCP server (e.g. your shell profile or the MCP
client's `env` block below) — **do not commit it**:

```bash
export ATLAS_ANTHROPIC_API_KEY="<your key>"
```

## Step 2 — register the Atlas MCP server with Hermes

Add Atlas to Hermes's MCP server configuration (adjust to Hermes's actual config format;
this is the standard stdio-server shape most MCP clients use). Use **absolute paths** and
the backend directory as `cwd`:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "/absolute/path/to/Atlas/backend/.venv/bin/python",
      "args": ["-m", "app.mcp_server"],
      "cwd": "/absolute/path/to/Atlas/backend",
      "env": {
        "ATLAS_DATABASE_PATH": "/absolute/path/to/Atlas/backend/atlas.sqlite",
        "ATLAS_ANTHROPIC_API_KEY": "<your key>"
      }
    }
  }
}
```

Point `ATLAS_DATABASE_PATH` at the **same** database the Atlas API uses, so Hermes reads
your real state and its proposals show up in the running cockpit.

### Atlas on the Raspberry Pi (current deployment)

When Atlas runs on the Pi (see `docs/deploy-pi.md`), don't point the client at a local
venv/DB copy — run the MCP server **inside the Pi's backend container**, over SSH-wrapped
stdio. The backend image bakes in the `[mcp]` extra, and the container already carries
`ATLAS_DATABASE_PATH` and `ATLAS_ANTHROPIC_API_KEY`, so no `env` block is needed:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "ssh",
      "args": ["-o", "BatchMode=yes", "amir@atlas.local",
               "docker", "exec", "-i", "atlas-backend",
               "python", "-m", "app.mcp_server"]
    }
  }
}
```

Prerequisite: passwordless SSH to the Pi (`ssh-copy-id amir@atlas.local`). Verify the
transport with a raw JSON-RPC handshake, or simply `claude mcp add atlas -- ssh -o
BatchMode=yes amir@atlas.local docker exec -i atlas-backend python -m app.mcp_server`
and check `claude mcp list` reports it Connected.

## Step 3 — give Hermes its operating brief

Tell Hermes (in its own system/config prompt) the rules of engagement. Suggested brief:

> You are Atlas's planning coach. Use the `atlas` MCP tools. Read real state
> (`atlas_snapshot`, `list_goals`, `get_goal_plan`, `recent_activities`, `list_modules`,
> `list_proposals`) before suggesting anything. You may **propose** changes only:
> `propose_module_status` / `propose_module_priority` for module focus,
> `propose_plan` for a goal that has no plan, `request_replan` when a goal's plan is
> behind. Never invent progress — it comes only from logged activities. Do not create a
> duplicate proposal if one is already pending for the same goal/module. Everything you
> propose waits for the owner's approval in the inbox.

## Step 4 — verify the loop end to end

1. Ask Hermes to review your goals; confirm it calls the read tools.
2. Ask it to propose a module priority or a plan; a **pending** proposal tagged
   `created_by="hermes"` should appear in the Coach tile/modal.
3. Accept it in the Coach inbox → the change applies through the validated service and is
   audited. Dismiss → nothing changes.

## Cadence (optional, later)

For proactive coaching, schedule a periodic Hermes run (its own cron) that reviews drift and
files at most one re-plan proposal per behind goal. Atlas already guards against duplicate
open re-plan proposals per goal, so a daily pass is safe. A native Atlas-side scheduler hook
for this is a future increment.

## Safety notes

- The MCP surface has **no** accept/apply/delete/raw-SQL tool — enforced by a test that
  pins the exact tool set. An external agent can suggest but never act.
- Keep the API key out of the repo and out of any committed config.
- If you later expose the server beyond localhost, add transport auth first (P4a is
  local stdio only).
