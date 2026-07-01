# Atlas MCP Server — Design Spec (P4a)

- **Date:** 2026-07-01
- **Status:** Approved (design); ready for planning
- **Roadmap phase:** P4a — the MCP seam (`docs/superpowers/2026-07-01-smart-atlas-roadmap.md`; P4 = Hermes runtime, split into P4a server / P4b install).
- **Basis:** P1 proposal inbox + handler registry, P2a/P2b planning engine, `docs/planning-engine.md` (the MCP seam).

## 1. Summary

P4a exposes Atlas to an external agent (Hermes, or any MCP client) through a **stdio
MCP server** that runs **in-process against Atlas's own service layer + `db_connection()`**
— same SQLite DB, same validated functions, no HTTP hop. It is the seam the whole
"Atlas reasons behind the front door" thrust was built toward.

The server is a **read + propose-only** surface. It can read real state and create
**pending** proposals (`created_by="hermes"`), but it deliberately exposes **no accept /
dismiss / apply tool, no delete, no raw-SQL tool**. Every "write" funnels through
`create_proposal` (or the planning service) as a `pending` proposal — so an external agent
can *suggest* but never *act*. The owner still approves everything in the existing inbox.
This enforces the two-plane model (fact plane vs judgment plane) **at the tool boundary**.

## 2. Goals / Non-goals

**Goals**
- A stdio MCP server module (`backend/app/mcp_server.py`) built on the official `mcp` Python
  SDK (FastMCP), added as an **optional** dependency so the core app never requires it.
- **Read tools** over real data: `atlas_snapshot`, `list_modules`, `list_goals`,
  `get_goal_plan`, `recent_activities`, `list_proposals`.
- **Propose-only write tools**: `propose_module_status`, `propose_module_priority`,
  `propose_plan`, `request_replan` — all create `pending` proposals via the existing
  validated paths, `created_by="hermes"`. Plan tools are LLM-key-gated: without the key they
  return the honest "needs AI key" error, never a fabricated plan.
- Testable: each tool is a plain module-level function (registered with the server) that
  tests call directly against a **per-test temp DB** (existing isolation) — never the live DB.
- A stdio entrypoint (`python -m app.mcp_server`) and a short setup doc (config snippet).

**Non-goals (P4b / later)**
- No accept / dismiss / apply / delete / raw-SQL tools — ever (safety spine).
- No Hermes install, no cron/autonomous cadence, no HTTP/SSE transport (stdio only for P4a).
- No new proposal *types* and no backend schema changes — reuse the registered types.
- No auth beyond the local stdio boundary (single-user, local process).

## 3. Current state (build on)

- `proposals/service.py::create_proposal(conn, type, title, rationale, payload,
  created_by="system") -> dict` — validates `type` against the **live** `_HANDLERS`
  registry (422 unknown), validates `payload.module_id` exists (404), inserts `pending`,
  audits. Registered types today: `set_module_status`, `set_module_priority`, `activate_plan`.
- `planning/service.py`: `get_goal_plan(conn, goal_id) -> dict | None` (plan + steps + real
  per-step progress + drift); `propose_plan_for_goal(conn, goal_id) -> dict` (LLM decompose →
  proposed plan + `activate_plan` proposal; **422** if module-less / no AI key);
  `generate_replan_proposal(conn, goal_id) -> dict | None` (proposal, or `{status:...}`, 404).
- `dashboard/service.py::get_today_dashboard() -> dict` (real_signals snapshot; opens its own
  `db_connection`).
- `core/database.py::db_connection()` (context manager, WAL; DB path from settings) +
  `rows_to_dicts`. `core/database.py::initialize_database()` builds the schema.
- Read lists elsewhere are inline SELECTs in routers (modules/goals/activities/proposals) —
  P4a adds small **read-only** SELECT helpers in the MCP module (duplicating a SELECT is
  acceptable; it avoids reaching into routers).
- **Test isolation:** `tests/conftest.py` autouse fixture points every test at a fresh temp
  SQLite and clears the settings cache; `with TestClient(app):` runs the lifespan →
  `initialize_database()` on that temp path. MCP tests reuse this to get a schema'd temp DB.

## 4. Dependency + module layout

- `pyproject.toml` → `[project.optional-dependencies]` add:
  ```toml
  mcp = ["mcp>=1.2.0"]
  ```
  The core app (`app.main`) must remain importable **without** `mcp` installed — `main.py`
  never imports `mcp_server`. Only the MCP entrypoint and its tests import it.
- New file `backend/app/mcp_server.py` (single module; do **not** name it `mcp` — that would
  shadow the SDK package). It imports `from mcp.server.fastmcp import FastMCP` at module top
  (so its tests require `mcp`, which the plan installs).

## 5. Tools

Each tool is a plain typed function, registered on a module-level `FastMCP("atlas")` server.
All return JSON-serializable data (dicts/lists/str). All reads are real queries; no fabrication.

**Reads**

| Tool | Signature | Returns |
|---|---|---|
| `atlas_snapshot` | `() -> dict` | `get_today_dashboard()` (real_signals, today_focus, active modules) |
| `list_modules` | `(status: str \| None = None) -> list[dict]` | `SELECT * FROM life_modules` (+ `WHERE status=?`), ordered by priority |
| `list_goals` | `(status: str \| None = None) -> list[dict]` | `SELECT * FROM goals` (+ `WHERE status=?`), newest first |
| `get_goal_plan` | `(goal_id: str) -> dict` | `get_goal_plan(conn, goal_id)`; `{"error":"no plan"}` if None |
| `recent_activities` | `(limit: int = 20) -> list[dict]` | `SELECT * FROM activities ORDER BY occurred_at DESC LIMIT ?` (cap 100) |
| `list_proposals` | `(status: str = "pending") -> list[dict]` | proposals (`status="all"` for all) |

**Propose-only writes** (all `created_by="hermes"`, all produce a `pending` proposal)

| Tool | Signature | Effect |
|---|---|---|
| `propose_module_status` | `(module_id: str, status: str, rationale: str) -> dict` | `create_proposal(type="set_module_status", payload={module_id,status}, created_by="hermes")` |
| `propose_module_priority` | `(module_id: str, priority: int, rationale: str) -> dict` | `create_proposal(type="set_module_priority", payload={module_id,priority}, created_by="hermes")` |
| `propose_plan` | `(goal_id: str) -> dict` | `propose_plan_for_goal(conn, goal_id)` → the `activate_plan` proposal; key-gated |
| `request_replan` | `(goal_id: str) -> dict` | `generate_replan_proposal(conn, goal_id)` → proposal or `{status:...}`; key-gated |

Notes:
- `propose_module_*` set `created_by="hermes"` explicitly; the existing `create_proposal`
  already validates the module exists and the type is registered.
- `propose_plan_for_goal`/`generate_replan_proposal` do **not** take `created_by`; the plans
  they create carry the proposal via the planning path. That is acceptable for P4a (the
  proposal's origin is still auditable via the audit log); a `created_by` passthrough is a
  noted fast-follow, not required here.

## 6. Error handling (honest boundary)

Service functions raise `fastapi.HTTPException`. MCP tools must not leak HTTP semantics —
each write tool wraps the call: `except HTTPException as e: return {"error": e.detail,
"status_code": e.status_code}`. So:
- No AI key / module-less goal on `propose_plan` → `{"error": "Plan decomposition
  unavailable (needs AI key)", "status_code": 422}` — never a fabricated plan.
- `request_replan` with no active plan → `{"error": "...", "status_code": 404}`; on-track →
  `{"status": "on_track"}` (passed through from the service).
- Unknown module on `propose_module_*` → `{"error": "...", "status_code": 404}`.
- `get_goal_plan` with no plan → `{"error": "no plan for this goal yet"}`.

## 7. Safety guarantees (the point of P4a)

- **Propose-only:** the tool set contains no accept/dismiss/apply/delete/raw-SQL tool.
  Nothing an external agent does changes fact-plane state without the owner accepting a
  proposal in the inbox. This is verified by an explicit test asserting the registered tool
  names are exactly the ten in §5.
- **Validated paths only:** every write goes through `create_proposal` / the planning service
  — type-checked against the live registry, module existence enforced, audited.
- **`created_by="hermes"`:** module proposals are tagged so the inbox/audit show the origin.
- **Real data only:** reads are direct SELECTs / existing derivations; no invented values.
- **Never the live DB in tests:** all tests use the per-test temp DB (conftest); the spec's
  test task asserts nothing writes outside it.

## 8. Run + configure

- Entrypoint: `python -m app.mcp_server` (stdio) — `main()` builds/serves the FastMCP server.
- `docs/atlas-mcp-setup.md`: how to install the extra (`pip install -e ".[mcp]"`) and the
  MCP client config snippet (command + args + cwd) for a stdio client (Claude Desktop /
  Hermes). No secrets in the doc.

## 9. Testing (pytest + temp DB; LLM monkeypatched)

- **Reads:** seed via the service/TestClient, then call each read tool → returns the real
  rows (e.g. `list_modules` returns seeded modules; `get_goal_plan` returns real progress).
- **Propose (module):** `propose_module_status`/`priority` create a `pending` proposal with
  `created_by="hermes"` and the right payload; the module is unchanged until accepted;
  unknown module → `{"error":..., "status_code":404}`.
- **Propose (plan):** monkeypatch `decompose_goal` → `propose_plan` creates a plan proposal;
  with decomposition unavailable → `{"error":..., "status_code":422}` and no plan created.
- **Re-plan:** behind + monkeypatched decompose → proposal; on-track → `{"status":"on_track"}`.
- **Safety:** assert the server's registered tool names == the exact allowed set (no
  accept/apply/delete). Assert there is no tool whose name contains `accept`/`dismiss`/
  `delete`/`sql`.
- **Isolation:** each test uses the conftest temp DB; schema via `with TestClient(app):`.
- **Regression:** all existing backend tests still pass; `app.main` still imports with `mcp`
  absent (guarded by not importing `mcp_server` from `main`).

## 10. Success criteria

- `python -m app.mcp_server` starts a stdio MCP server exposing exactly the §5 tools.
- An MCP client can read real Atlas state and create `pending` proposals that appear in the
  Coach inbox (`created_by="hermes"`), which the owner accepts to apply — nothing applies
  without acceptance.
- Plan/re-plan tools return the honest 422 without an AI key; no fabricated plans.
- ruff clean, all tests green, `app.main` imports without `mcp` installed.

## 11. How P4b builds on this

- **P4b (Hermes install):** run Hermes, point it at `python -m app.mcp_server`, provide the
  AI key so `propose_plan`/`request_replan` produce real plans. Add cadence (a cron that asks
  Hermes to review drift and propose), and — as fast-follows — a `created_by` passthrough for
  plan proposals and (optionally) an HTTP/SSE transport.
