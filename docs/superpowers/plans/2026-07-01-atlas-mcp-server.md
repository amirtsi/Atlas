# Atlas MCP Server (P4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stdio MCP server exposing Atlas as a read + propose-only surface to an external agent — real-state reads and `pending` proposals (`created_by="hermes"`) through the existing validated paths, with no accept/apply/delete/raw-SQL tool.

**Architecture:** New `backend/app/mcp_server.py` on the official `mcp` SDK (FastMCP), added as an OPTIONAL dependency. In-process: reuses `db_connection()` + the service layer (`get_today_dashboard`, `get_goal_plan`, `create_proposal`, `propose_plan_for_goal`, `generate_replan_proposal`). Each tool is a plain module-level function (registered in a loop, enumerated in `TOOL_NAMES`) so tests call them directly against the per-test temp DB. `app.main` never imports `mcp_server`, so the core app stays importable without `mcp`.

**Tech Stack:** Python 3.12, FastAPI service layer, SQLite, `mcp>=1.2.0` (FastMCP), pytest.

## Global Constraints

- **Two-plane / propose-only:** the tool set is EXACTLY the ten in this plan — six reads + four propose-only writes. NO accept/dismiss/apply/delete/raw-SQL tool, ever. Every write produces a `pending` proposal via `create_proposal` / the planning service; nothing mutates fact-plane state.
- **`created_by="hermes"`** on the two module-proposal tools.
- **Honest core:** reads return real DB rows / existing derivations only. Plan tools are LLM-key-gated — without the key they return `{"error": <detail>, "status_code": 422}`, never a fabricated plan. No tool invents data.
- **Never the live DB in tests:** all tests use the conftest per-test temp DB; schema via `with TestClient(app):`.
- **Core app stays clean:** `backend/app/main.py` must NOT import `mcp_server` (verified by a test). Do not name the module `mcp` (it would shadow the SDK).
- Reuse service functions via aliased imports (`_get_goal_plan`, etc.) to avoid name collisions with the public tool names.
- Gate each task on the commands in its steps (pytest + ruff), run from `backend/` using `.venv/bin/...`.

---

### Task 1: Dependency + server skeleton + read tools

**Files:**
- Modify: `backend/pyproject.toml` (add the `mcp` optional extra)
- Create: `backend/app/mcp_server.py`
- Create: `backend/tests/test_mcp_reads.py`

**Interfaces:**
- Consumes: `db_connection`, `rows_to_dicts` from `app.core.database`; `get_today_dashboard` from `app.modules.dashboard.service`; `get_goal_plan` from `app.modules.planning.service`.
- Produces: module `app.mcp_server` with `server` (FastMCP), read tools `atlas_snapshot`, `list_modules`, `list_goals`, `get_goal_plan`, `recent_activities`, `list_proposals`, the `READ_TOOLS` list, and `main()`. (Write tools + full `TOOL_NAMES` land in Tasks 2–3.)

- [ ] **Step 1: Add the optional dependency**

In `backend/pyproject.toml`, replace the empty optional-dependencies section:

```toml
[project.optional-dependencies]
```

with:

```toml
[project.optional-dependencies]
mcp = ["mcp>=1.2.0"]
```

- [ ] **Step 2: Install it into the backend venv**

Run: `cd backend && .venv/bin/pip install "mcp>=1.2.0"`
Expected: installs `mcp` and its deps; `.venv/bin/python -c "import mcp.server.fastmcp"` exits 0.

- [ ] **Step 3: Write the failing read test**

Create `backend/tests/test_mcp_reads.py`:

```python
from fastapi.testclient import TestClient

from app import mcp_server
from app.main import app


def _create_module(client: TestClient) -> str:
    disciplines = client.get("/api/v1/disciplines").json()
    discipline_id = disciplines[0]["id"]
    resp = client.post(
        "/api/v1/modules",
        json={"discipline_id": discipline_id, "type": "project", "name": "MCP Read Target"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_atlas_snapshot_returns_real_signals():
    with TestClient(app):
        snap = mcp_server.atlas_snapshot()
    assert "real_signals" in snap


def test_list_modules_returns_seeded_module():
    with TestClient(app) as client:
        _create_module(client)
        mods = mcp_server.list_modules()
    assert any(m["name"] == "MCP Read Target" for m in mods)


def test_list_modules_filters_by_status():
    with TestClient(app) as client:
        _create_module(client)
        active = mcp_server.list_modules(status="active")
        archived = mcp_server.list_modules(status="archived")
    assert any(m["name"] == "MCP Read Target" for m in active)
    assert all(m["name"] != "MCP Read Target" for m in archived)


def test_get_goal_plan_without_plan_returns_error():
    with TestClient(app) as client:
        disciplines = client.get("/api/v1/disciplines").json()
        goal = client.post(
            "/api/v1/planning/goals",
            json={"title": "Read goal", "discipline_id": disciplines[0]["id"]},
        ).json()
        result = mcp_server.get_goal_plan(goal["id"])
    assert "error" in result


def test_recent_activities_caps_limit():
    with TestClient(app):
        acts = mcp_server.recent_activities(limit=9999)
    assert isinstance(acts, list)


def test_list_proposals_defaults_to_pending():
    with TestClient(app):
        props = mcp_server.list_proposals()
    assert isinstance(props, list)
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_mcp_reads.py -q`
Expected: FAIL — `app.mcp_server` does not exist yet (ImportError).

- [ ] **Step 5: Create the server module with read tools**

Create `backend/app/mcp_server.py`:

```python
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_mcp_reads.py -q`
Expected: PASS (6 tests). Then `.venv/bin/ruff check app tests` → clean.

- [ ] **Step 7: Commit**

```bash
git add backend/pyproject.toml backend/app/mcp_server.py backend/tests/test_mcp_reads.py
git commit -m "feat(mcp): Atlas MCP server skeleton + read tools (optional mcp dep)"
```

---

### Task 2: Propose-only write tools

**Files:**
- Modify: `backend/app/mcp_server.py` (add write tools + `WRITE_TOOLS`; register them)
- Create: `backend/tests/test_mcp_proposals.py`

**Interfaces:**
- Consumes: `create_proposal` from `app.modules.proposals.service`; `propose_plan_for_goal`, `generate_replan_proposal` from `app.modules.planning.service`; `decompose_goal` (monkeypatched in tests) from `app.modules.planning.service`.
- Produces: tools `propose_module_status`, `propose_module_priority`, `propose_plan`, `request_replan`; the `WRITE_TOOLS` list (registered).

- [ ] **Step 1: Write the failing proposal test**

Create `backend/tests/test_mcp_proposals.py`:

```python
from fastapi.testclient import TestClient

from app import mcp_server
from app.main import app


def _create_module(client: TestClient) -> str:
    disciplines = client.get("/api/v1/disciplines").json()
    resp = client.post(
        "/api/v1/modules",
        json={"discipline_id": disciplines[0]["id"], "type": "project", "name": "MCP Write Target"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_propose_module_status_creates_pending_hermes_proposal():
    with TestClient(app) as client:
        module_id = _create_module(client)
        result = mcp_server.propose_module_status(module_id, "archived", "stale for 30d")
        assert result["status"] == "pending"
        assert result["created_by"] == "hermes"
        assert result["type"] == "set_module_status"
        # module itself is unchanged until the owner accepts
        module = client.get(f"/api/v1/modules/{module_id}").json()
        assert module["status"] == "active"


def test_propose_module_priority_creates_pending_proposal():
    with TestClient(app) as client:
        module_id = _create_module(client)
        result = mcp_server.propose_module_priority(module_id, 1, "focus here")
        assert result["status"] == "pending"
        assert result["type"] == "set_module_priority"
        assert result["payload"]["priority"] == 1


def test_propose_module_status_unknown_module_returns_error():
    with TestClient(app):
        result = mcp_server.propose_module_status("does-not-exist", "archived", "x")
    assert result["status_code"] == 404


def test_propose_plan_without_ai_key_returns_error(monkeypatch):
    # decompose returns falsy -> service raises 422 (honest, no fabricated plan)
    monkeypatch.setattr("app.modules.planning.service.decompose_goal", lambda goal, context=None: None)
    with TestClient(app) as client:
        disciplines = client.get("/api/v1/disciplines").json()
        module_id = _create_module(client)
        goal = client.post(
            "/api/v1/planning/goals",
            json={"title": "Plan goal", "module_id": module_id},
        ).json()
        result = mcp_server.propose_plan(goal["id"])
    assert result["status_code"] == 422


def test_propose_plan_with_stubbed_decompose_creates_proposal(monkeypatch):
    monkeypatch.setattr(
        "app.modules.planning.service.decompose_goal",
        lambda goal, context=None: {
            "rationale": "stub",
            "steps": [{"kind": "topic", "title": "Study AD", "sequence": 0, "unit": "minutes", "target": 60}],
        },
    )
    with TestClient(app) as client:
        disciplines = client.get("/api/v1/disciplines").json()
        module_id = _create_module(client)
        goal = client.post(
            "/api/v1/planning/goals",
            json={"title": "Plan goal 2", "module_id": module_id},
        ).json()
        result = mcp_server.propose_plan(goal["id"])
    assert result.get("type") == "activate_plan"
    assert result.get("status") == "pending"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_mcp_proposals.py -q`
Expected: FAIL — `mcp_server.propose_module_status` etc. do not exist.

- [ ] **Step 3: Add the write tools**

In `backend/app/mcp_server.py`, add these imports near the top (after the existing service imports):

```python
from app.modules.planning.service import generate_replan_proposal as _generate_replan_proposal
from app.modules.planning.service import propose_plan_for_goal as _propose_plan_for_goal
from app.modules.proposals.service import create_proposal as _create_proposal
```

Add the write tools AFTER the read tools (before the `READ_TOOLS` list):

```python
# --- Propose-only write tools (create PENDING proposals; never apply) -------

def propose_module_status(module_id: str, status: str, rationale: str) -> dict:
    """Propose setting a module's status (pending; owner must accept to apply)."""
    from fastapi import HTTPException

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
    from fastapi import HTTPException

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
    from fastapi import HTTPException

    try:
        with db_connection() as conn:
            return _propose_plan_for_goal(conn, goal_id)
    except HTTPException as exc:
        return {"error": exc.detail, "status_code": exc.status_code}


def request_replan(goal_id: str) -> dict:
    """Request a drift-driven re-plan proposal for a goal (pending; key-gated)."""
    from fastapi import HTTPException

    try:
        with db_connection() as conn:
            result = _generate_replan_proposal(conn, goal_id)
    except HTTPException as exc:
        return {"error": exc.detail, "status_code": exc.status_code}
    return result if result is not None else {"status": "on_track"}
```

Add the `WRITE_TOOLS` list and its registration immediately after the `READ_TOOLS`
registration loop:

```python
WRITE_TOOLS = [
    propose_module_status,
    propose_module_priority,
    propose_plan,
    request_replan,
]

for _tool in WRITE_TOOLS:
    server.tool()(_tool)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_mcp_proposals.py -q`
Expected: PASS (5 tests). Then `.venv/bin/ruff check app tests` → clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/mcp_server.py backend/tests/test_mcp_proposals.py
git commit -m "feat(mcp): propose-only write tools (module status/priority, plan, re-plan)"
```

---

### Task 3: Safety test, main-import isolation, `TOOL_NAMES`, setup doc

**Files:**
- Modify: `backend/app/mcp_server.py` (add `TOOL_NAMES`)
- Create: `backend/tests/test_mcp_safety.py`
- Create: `docs/atlas-mcp-setup.md`

**Interfaces:**
- Consumes: `READ_TOOLS`, `WRITE_TOOLS` (Tasks 1–2).
- Produces: `TOOL_NAMES` (sorted names of all registered tools).

- [ ] **Step 1: Add `TOOL_NAMES` to the module**

In `backend/app/mcp_server.py`, after the `WRITE_TOOLS` registration loop, add:

```python
TOOL_NAMES = sorted(_tool.__name__ for _tool in [*READ_TOOLS, *WRITE_TOOLS])
```

- [ ] **Step 2: Write the safety + isolation test**

Create `backend/tests/test_mcp_safety.py`:

```python
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


def test_main_module_does_not_import_mcp_server():
    # The core app must stay importable without the optional `mcp` dependency,
    # so main.py must not import the MCP server module.
    main_src = Path(mcp_server.__file__).with_name("main.py").read_text()
    assert "mcp_server" not in main_src
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_mcp_safety.py -q`
Expected: PASS (3 tests). (`test_main_module_does_not_import_mcp_server` passes because `main.py` never references `mcp_server`.)

- [ ] **Step 4: Write the setup doc**

Create `docs/atlas-mcp-setup.md`:

```markdown
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

Propose-only writes (create `pending` proposals, `created_by="hermes"`):
`propose_module_status`, `propose_module_priority`, `propose_plan`, `request_replan`.
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/mcp_server.py backend/tests/test_mcp_safety.py docs/atlas-mcp-setup.md
git commit -m "feat(mcp): safety test (exact tool surface) + main-import isolation + setup doc"
```

---

## Verification (whole feature)

- `cd backend && .venv/bin/python -m pytest -q` → all tests green (existing + new MCP tests).
- `.venv/bin/ruff check app tests` → clean.
- `.venv/bin/python -c "import app.main"` succeeds; `python -m app.mcp_server` starts a stdio server exposing exactly the ten tools.
- Manual: an MCP client reads real state and creates a `pending` `created_by="hermes"` proposal that appears in the Coach inbox; accepting it applies the change; `propose_plan` without a key returns an error object, not a plan.
