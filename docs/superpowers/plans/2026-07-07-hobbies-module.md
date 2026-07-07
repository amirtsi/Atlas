# Hobbies Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `hobby` life-module type with an idea backlog per hobby, a "do this next" suggestion surfaced on the kiosk dashboard, and a one-tap "Did it" that closes an idea and logs a real session.

**Architecture:** Hobby = `life_modules` row with `type='hobby'` (category in `config.category`). Sessions are ordinary `activities` rows. One new table `hobby_ideas`, one new backend module `app/modules/hobby/` (mirrors `project`), one new `hobby` branch in `build_behavior`, one new frontend feature file `features/hobbies.tsx` + pure logic in `hobby-logic.ts`. The dashboard tile reads the existing dashboard payload (`active_modules[].behavior.summary`) — no new read endpoint.

**Tech Stack:** FastAPI + SQLite (stdlib `sqlite3`), pytest; React 19 + Vite + TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-07-07-hobbies-module-design.md`

## Global Constraints

- Backend commands run from `backend/` using the existing venv: `.venv/bin/python -m pytest`, `.venv/bin/ruff check app tests`.
- Frontend commands run from `frontend/`: `npm test` (vitest run), `npm run build`.
- Tests NEVER touch the dev DB — `tests/conftest.py` autouse fixture already isolates every test in a temp SQLite DB. Do not change it.
- New table goes in `SCHEMA_SQL` only (`CREATE TABLE IF NOT EXISTS`) — per the comment block in `backend/app/core/database.py`, new tables need **no** migration entry and **no** `SCHEMA_VERSION` bump.
- UI is RTL Hebrew mixed with English labels; copy strings below are exact — use them verbatim.
- No seed/demo data anywhere. Every displayed number derives from real rows.
- Reuse existing UI primitives (`Panel`, `Modal`, `Chip` from `frontend/src/shared/ui.tsx`) and CSS tokens; professional look, no neon.
- Commit after every task with the message given in its final step.

---

### Task 1: Schema + hobby module type (backend)

**Files:**
- Modify: `backend/app/core/database.py` (add `hobby_ideas` table to `SCHEMA_SQL`, right after the `learning_units` table)
- Modify: `backend/app/modules/life_modules/router.py:15-22` (add `"hobby"` to `VALID_MODULE_TYPES`)
- Create: `backend/tests/test_hobby_ideas.py`

**Interfaces:**
- Produces: `hobby_ideas` table (columns: `id, module_id, title, notes, status, pinned, completed_at, completed_activity_id, created_at, updated_at`); `POST /api/v1/modules` accepts `type: "hobby"`; test helpers `_discipline_id(client)` and `_create_hobby(client, name=...)` used by every later backend task.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_hobby_ideas.py`:

```python
"""Hobby module + idea backlog tests. Temp DB per test via conftest."""

from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.main import app


def _discipline_id(client: TestClient) -> str:
    return client.get("/api/v1/disciplines").json()[0]["id"]


def _create_hobby(client: TestClient, name: str = "Guitar") -> dict:
    response = client.post(
        "/api/v1/modules",
        json={
            "discipline_id": _discipline_id(client),
            "type": "hobby",
            "name": name,
            "slug": name.lower().replace(" ", "-"),
            "config": {"category": "creative"},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_create_hobby_module_and_ideas_table_exists():
    with TestClient(app) as client:
        module = _create_hobby(client)
        assert module["type"] == "hobby"
    with db_connection() as conn:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hobby_ideas'"
        ).fetchone()
        assert row is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_hobby_ideas.py -v`
Expected: FAIL — `assert response.status_code == 201` fails with 422 "Unsupported module type".

- [ ] **Step 3: Add the type and the table**

In `backend/app/modules/life_modules/router.py`, add `"hobby"` to the set:

```python
VALID_MODULE_TYPES = {
    "project",
    "habit",
    "learning",
    "recovery",
    "relationship",
    "hobby",
    "finance",
    "calendar",
```

In `backend/app/core/database.py`, immediately after the `learning_units` CREATE TABLE block inside `SCHEMA_SQL`, add:

```sql
CREATE TABLE IF NOT EXISTS hobby_ideas (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  pinned INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  completed_activity_id TEXT REFERENCES activities(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_hobby_ideas.py -v`
Expected: 1 PASS

- [ ] **Step 5: Run the whole backend suite (regression guard)**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: all pass (adding a type to a set and a new table must not break anything).

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/database.py backend/app/modules/life_modules/router.py backend/tests/test_hobby_ideas.py
git commit -m "feat(hobby): hobby module type + hobby_ideas table"
```

---

### Task 2: Hobby behavior summary (suggestion picking)

**Files:**
- Modify: `backend/app/modules/life_modules/behavior.py` (two helpers + `hobby` branch in `build_behavior`, placed after the `learning` branch)
- Modify: `backend/tests/test_hobby_ideas.py` (add helper + tests)

**Interfaces:**
- Consumes: `hobby_ideas` table from Task 1; existing `module_activity_summary(conn, module_id)`.
- Produces: hobby behavior summary consumed by the dashboard payload and frontend:
  `{ weekly_activity_count: int, weekly_minutes: int, days_since_last: int|None, ideas_open: int, next_idea: {id: str, title: str}|None, category: str }`.
  Helper `_insert_idea(module_id, title, *, pinned=0, status="open", created_at)` reused by later tests.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_hobby_ideas.py`:

```python
def _insert_idea(
    module_id: str,
    title: str,
    *,
    pinned: int = 0,
    status: str = "open",
    created_at: str = "2026-01-01T00:00:00+00:00",
) -> str:
    idea_id = new_id()
    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO hobby_ideas (id, module_id, title, status, pinned, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (idea_id, module_id, title, status, pinned, created_at, created_at),
        )
    return idea_id


def _behavior_summary(client: TestClient, module_id: str) -> dict:
    response = client.get(f"/api/v1/modules/{module_id}/behavior")
    assert response.status_code == 200, response.text
    return response.json()["summary"]


def test_hobby_behavior_empty_module():
    with TestClient(app) as client:
        module = _create_hobby(client)
        summary = _behavior_summary(client, module["id"])
        assert summary["days_since_last"] is None
        assert summary["ideas_open"] == 0
        assert summary["next_idea"] is None
        assert summary["category"] == "creative"


def test_hobby_behavior_pinned_beats_oldest():
    with TestClient(app) as client:
        module = _create_hobby(client)
        _insert_idea(module["id"], "Oldest", created_at="2026-01-01T00:00:00+00:00")
        pinned_id = _insert_idea(
            module["id"], "Pinned", pinned=1, created_at="2026-06-01T00:00:00+00:00"
        )
        summary = _behavior_summary(client, module["id"])
        assert summary["next_idea"] == {"id": pinned_id, "title": "Pinned"}
        assert summary["ideas_open"] == 2


def test_hobby_behavior_oldest_open_when_no_pin_and_ignores_closed():
    with TestClient(app) as client:
        module = _create_hobby(client)
        _insert_idea(module["id"], "Done", status="done", created_at="2025-01-01T00:00:00+00:00")
        oldest_id = _insert_idea(module["id"], "Oldest open", created_at="2026-01-01T00:00:00+00:00")
        _insert_idea(module["id"], "Newer", created_at="2026-06-01T00:00:00+00:00")
        summary = _behavior_summary(client, module["id"])
        assert summary["next_idea"] == {"id": oldest_id, "title": "Oldest open"}
        assert summary["ideas_open"] == 2


def test_hobby_behavior_days_since_last_after_session():
    with TestClient(app) as client:
        module = _create_hobby(client)
        response = client.post(
            "/api/v1/activities/quick-log",
            json={
                "module_id": module["id"],
                "title": "Practice",
                "activity_type": "hobby",
                "duration_minutes": 20,
            },
        )
        assert response.status_code in (200, 201), response.text
        summary = _behavior_summary(client, module["id"])
        assert summary["days_since_last"] == 0
        assert summary["weekly_activity_count"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_hobby_ideas.py -v`
Expected: the four new tests FAIL — hobby modules fall into the placeholder branch, so `summary["days_since_last"]` raises `KeyError` (the placeholder summary has no such key). Task 1's test still passes.

- [ ] **Step 3: Implement the behavior branch**

In `backend/app/modules/life_modules/behavior.py`, add two helpers after `project_item_counts`:

```python
def hobby_days_since_last(conn: Connection, module_id: str) -> int | None:
    row = conn.execute(
        "SELECT MAX(occurred_at) AS last FROM activities WHERE module_id = ?", (module_id,)
    ).fetchone()
    if not row["last"]:
        return None
    last_day = datetime.fromisoformat(row["last"]).date()
    return max(0, (datetime.now(UTC).date() - last_day).days)


def hobby_next_idea(conn: Connection, module_id: str) -> dict | None:
    """The suggestion: pinned open idea if any, else the oldest open idea."""
    row = conn.execute(
        """
        SELECT id, title FROM hobby_ideas
        WHERE module_id = ? AND status = 'open'
        ORDER BY pinned DESC, created_at ASC
        LIMIT 1
        """,
        (module_id,),
    ).fetchone()
    return {"id": row["id"], "title": row["title"]} if row else None
```

In `build_behavior`, after the `learning` branch (line ~180) and before the `WELLBEING_TYPES` branch, add:

```python
    if module_type == "hobby":
        ideas_open = conn.execute(
            "SELECT COUNT(id) AS count FROM hobby_ideas WHERE module_id = ? AND status = 'open'",
            (module["id"],),
        ).fetchone()["count"]
        return {
            "module_id": module["id"],
            "type": module_type,
            "config": config,
            "summary": {
                **activity,
                "days_since_last": hobby_days_since_last(conn, module["id"]),
                "ideas_open": ideas_open,
                "next_idea": hobby_next_idea(conn, module["id"]),
                "category": config.get("category") or "creative",
            },
        }
```

(No `progress_percent` — hobbies don't complete; per spec the tile shows gap + suggestion.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_hobby_ideas.py -v`
Expected: all PASS (5 tests).

- [ ] **Step 5: Lint + commit**

```bash
cd backend && .venv/bin/ruff check app tests
git add backend/app/modules/life_modules/behavior.py backend/tests/test_hobby_ideas.py
git commit -m "feat(hobby): behavior summary — days-since, open ideas, next-idea suggestion"
```

---

### Task 3: Hobby router — list / create / patch ideas + wiring

**Files:**
- Modify: `backend/app/shared/schemas.py` (three new models, after `ProjectItemComplete`)
- Create: `backend/app/modules/hobby/__init__.py` (empty file)
- Create: `backend/app/modules/hobby/router.py`
- Modify: `backend/app/main.py` (import + `include_router`)
- Modify: `backend/tests/test_hobby_ideas.py` (add tests)

**Interfaces:**
- Consumes: `hobby_ideas` table (Task 1), `get_or_404`, `record_audit_event`, `new_id`, `utc_now_iso`.
- Produces: `GET/POST /api/v1/hobby/{module_id}/ideas`, `PATCH /api/v1/hobby/{module_id}/ideas/{idea_id}`; models `HobbyIdeaCreate {title, notes?}`, `HobbyIdeaUpdate {title?, notes?, pinned?}`, `HobbyIdeaComplete {log_activity=True, duration_minutes?, notes?}`; router internals `_get_hobby_module(conn, module_id, for_write=False)` and `_get_idea(conn, module_id, idea_id)` used by Task 4.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_hobby_ideas.py`:

```python
def test_ideas_crud_and_listing():
    with TestClient(app) as client:
        module = _create_hobby(client)

        created = client.post(
            f"/api/v1/hobby/{module['id']}/ideas",
            json={"title": "Learn the intro to Karma Police", "notes": "capo 2"},
        )
        assert created.status_code == 201, created.text
        idea = created.json()
        assert idea["status"] == "open"
        assert idea["pinned"] == 0

        listed = client.get(f"/api/v1/hobby/{module['id']}/ideas").json()
        assert [row["id"] for row in listed] == [idea["id"]]

        patched = client.patch(
            f"/api/v1/hobby/{module['id']}/ideas/{idea['id']}",
            json={"title": "Karma Police intro"},
        ).json()
        assert patched["title"] == "Karma Police intro"

        only_open = client.get(f"/api/v1/hobby/{module['id']}/ideas?status=open").json()
        assert len(only_open) == 1


def test_pin_is_exclusive_per_module():
    with TestClient(app) as client:
        module = _create_hobby(client)
        first = _insert_idea(module["id"], "First", pinned=1)
        second = _insert_idea(module["id"], "Second", created_at="2026-02-01T00:00:00+00:00")

        response = client.patch(
            f"/api/v1/hobby/{module['id']}/ideas/{second}", json={"pinned": True}
        )
        assert response.status_code == 200, response.text
        listed = {row["id"]: row for row in client.get(f"/api/v1/hobby/{module['id']}/ideas").json()}
        assert listed[second]["pinned"] == 1
        assert listed[first]["pinned"] == 0


def test_pinning_a_non_open_idea_is_rejected():
    with TestClient(app) as client:
        module = _create_hobby(client)
        done = _insert_idea(module["id"], "Done", status="done")
        response = client.patch(
            f"/api/v1/hobby/{module['id']}/ideas/{done}", json={"pinned": True}
        )
        assert response.status_code == 422


def test_ideas_module_guards():
    with TestClient(app) as client:
        non_hobby = client.get("/api/v1/modules").json()[0]
        assert non_hobby["type"] != "hobby"
        response = client.post(
            f"/api/v1/hobby/{non_hobby['id']}/ideas", json={"title": "Nope"}
        )
        assert response.status_code == 422

        missing = client.post("/api/v1/hobby/does-not-exist/ideas", json={"title": "Nope"})
        assert missing.status_code == 404

        hobby = _create_hobby(client, name="Chess")
        idea_404 = client.patch(
            f"/api/v1/hobby/{hobby['id']}/ideas/does-not-exist", json={"title": "x"}
        )
        assert idea_404.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_hobby_ideas.py -v`
Expected: new tests FAIL with 404 on `/api/v1/hobby/...` (router doesn't exist).

- [ ] **Step 3: Add schemas**

In `backend/app/shared/schemas.py`, after `ProjectItemComplete`:

```python
class HobbyIdeaCreate(AtlasModel):
    title: str = Field(min_length=1)
    notes: str | None = None


class HobbyIdeaUpdate(AtlasModel):
    title: str | None = None
    notes: str | None = None
    pinned: bool | None = None


class HobbyIdeaComplete(AtlasModel):
    log_activity: bool = True
    duration_minutes: int | None = None
    notes: str | None = None
```

- [ ] **Step 4: Create the router**

Create empty `backend/app/modules/hobby/__init__.py`, then `backend/app/modules/hobby/router.py`:

```python
from sqlite3 import Connection

from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, new_id, row_to_dict, rows_to_dicts
from app.core.time import utc_now_iso
from app.shared.audit import record_audit_event
from app.shared.schemas import HobbyIdeaCreate, HobbyIdeaUpdate
from app.shared.sql import get_or_404

router = APIRouter(prefix="/hobby", tags=["hobby"])

VALID_IDEA_STATUSES = {"open", "done", "dropped"}

# Pinned first, then oldest — the same order the behavior summary uses to pick "next".
_IDEAS_ORDER = """
    ORDER BY
      CASE status WHEN 'open' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
      pinned DESC,
      created_at ASC
"""


def _get_hobby_module(conn: Connection, module_id: str, *, for_write: bool = False) -> dict:
    module = get_or_404(conn, "life_modules", module_id)
    if module["type"] != "hobby":
        raise HTTPException(status_code=422, detail="Module is not a hobby")
    if for_write and module["status"] == "archived":
        raise HTTPException(status_code=422, detail="Module is archived")
    return module


def _get_idea(conn: Connection, module_id: str, idea_id: str) -> dict:
    row = conn.execute(
        "SELECT * FROM hobby_ideas WHERE id = ? AND module_id = ?", (idea_id, module_id)
    ).fetchone()
    idea = row_to_dict(row)
    if idea is None:
        raise HTTPException(status_code=404, detail="Hobby idea not found")
    return idea


@router.get("/{module_id}/ideas")
def list_ideas(module_id: str, status: str | None = None) -> list[dict]:
    with db_connection() as conn:
        _get_hobby_module(conn, module_id)
        where = ["module_id = ?"]
        params: list[object] = [module_id]
        if status:
            if status not in VALID_IDEA_STATUSES:
                raise HTTPException(status_code=422, detail="Unsupported idea status")
            where.append("status = ?")
            params.append(status)
        sql = f"SELECT * FROM hobby_ideas WHERE {' AND '.join(where)}{_IDEAS_ORDER}"
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("/{module_id}/ideas", status_code=201)
def create_idea(module_id: str, payload: HobbyIdeaCreate) -> dict:
    now = utc_now_iso()
    with db_connection() as conn:
        _get_hobby_module(conn, module_id, for_write=True)
        idea_id = new_id()
        conn.execute(
            """
            INSERT INTO hobby_ideas (id, module_id, title, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (idea_id, module_id, payload.title, payload.notes, now, now),
        )
        idea = _get_idea(conn, module_id, idea_id)
        record_audit_event(
            conn,
            entity_type="hobby_idea",
            entity_id=idea_id,
            action="created",
            summary=f"Added hobby idea: {idea['title']}",
            changes={"module_id": module_id},
        )
        return idea


@router.patch("/{module_id}/ideas/{idea_id}")
def update_idea(module_id: str, idea_id: str, payload: HobbyIdeaUpdate) -> dict:
    data = payload.model_dump(exclude_unset=True)
    now = utc_now_iso()
    with db_connection() as conn:
        _get_hobby_module(conn, module_id, for_write=True)
        idea = _get_idea(conn, module_id, idea_id)

        if data.get("pinned") and idea["status"] != "open":
            raise HTTPException(status_code=422, detail="Only open ideas can be pinned")
        if "pinned" in data and data["pinned"]:
            # Pin is exclusive per module — unpin siblings in the same transaction.
            conn.execute(
                "UPDATE hobby_ideas SET pinned = 0, updated_at = ? WHERE module_id = ? AND pinned = 1",
                (now, module_id),
            )

        updates = {key: value for key, value in data.items() if value is not None}
        if "pinned" in updates:
            updates["pinned"] = 1 if updates["pinned"] else 0
        if updates:
            assignments = ", ".join(f"{key} = ?" for key in updates)
            conn.execute(
                f"UPDATE hobby_ideas SET {assignments}, updated_at = ? WHERE id = ?",
                (*updates.values(), now, idea_id),
            )
            record_audit_event(
                conn,
                entity_type="hobby_idea",
                entity_id=idea_id,
                action="updated",
                summary=f"Updated hobby idea: {idea['title']}",
                changes=data,
            )
        return _get_idea(conn, module_id, idea_id)
```

- [ ] **Step 5: Register the router**

In `backend/app/main.py`, add the import (alphabetical, after `learning`):

```python
from app.modules.hobby.router import router as hobby_router
```

and the registration next to the others:

```python
    app.include_router(hobby_router, prefix="/api/v1")
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_hobby_ideas.py -v`
Expected: all PASS (9 tests).

- [ ] **Step 7: Lint + commit**

```bash
cd backend && .venv/bin/ruff check app tests
git add backend/app/shared/schemas.py backend/app/modules/hobby backend/app/main.py backend/tests/test_hobby_ideas.py
git commit -m "feat(hobby): ideas router — list/create/patch with exclusive pin"
```

---

### Task 4: Complete / drop / delete endpoints ("Did it")

**Files:**
- Modify: `backend/app/modules/hobby/router.py` (three endpoints + two imports)
- Modify: `backend/tests/test_hobby_ideas.py` (add tests)

**Interfaces:**
- Consumes: `insert_activity(conn, ActivityCreate)` from `app.modules.activity_ledger.service`; `HobbyIdeaComplete` from Task 3.
- Produces: `POST /api/v1/hobby/{module_id}/ideas/{idea_id}/complete`, `POST .../drop`, `DELETE .../ideas/{idea_id}` — all returning the idea dict.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_hobby_ideas.py` (also add `import json` at the top of the file):

```python
def test_complete_logs_session_and_backlinks():
    with TestClient(app) as client:
        module = _create_hobby(client)
        idea_id = _insert_idea(module["id"], "Bake a 70% loaf", pinned=1)

        response = client.post(
            f"/api/v1/hobby/{module['id']}/ideas/{idea_id}/complete",
            json={"duration_minutes": 45, "notes": "came out great"},
        )
        assert response.status_code == 200, response.text
        idea = response.json()
        assert idea["status"] == "done"
        assert idea["pinned"] == 0
        assert idea["completed_at"] is not None
        assert idea["completed_activity_id"]

    with db_connection() as conn:
        activity = conn.execute(
            "SELECT * FROM activities WHERE id = ?", (idea["completed_activity_id"],)
        ).fetchone()
        assert activity["module_id"] == module["id"]
        assert activity["activity_type"] == "hobby"
        assert activity["title"] == "Bake a 70% loaf"
        assert activity["duration_minutes"] == 45
        assert activity["source"] == "hobby_idea"
        assert json.loads(activity["metadata"])["hobby_idea_id"] == idea_id


def test_complete_without_logging_skips_activity():
    with TestClient(app) as client:
        module = _create_hobby(client)
        idea_id = _insert_idea(module["id"], "Quiet close")
        idea = client.post(
            f"/api/v1/hobby/{module['id']}/ideas/{idea_id}/complete",
            json={"log_activity": False},
        ).json()
        assert idea["status"] == "done"
        assert idea["completed_activity_id"] is None
    with db_connection() as conn:
        count = conn.execute("SELECT COUNT(id) AS count FROM activities").fetchone()["count"]
        assert count == 0


def test_complete_non_open_idea_conflicts():
    with TestClient(app) as client:
        module = _create_hobby(client)
        idea_id = _insert_idea(module["id"], "Already done", status="done")
        response = client.post(
            f"/api/v1/hobby/{module['id']}/ideas/{idea_id}/complete", json={}
        )
        assert response.status_code == 409


def test_drop_archives_without_activity_and_delete_removes():
    with TestClient(app) as client:
        module = _create_hobby(client)
        idea_id = _insert_idea(module["id"], "Meh idea", pinned=1)

        dropped = client.post(f"/api/v1/hobby/{module['id']}/ideas/{idea_id}/drop")
        assert dropped.status_code == 200, dropped.text
        assert dropped.json()["status"] == "dropped"
        assert dropped.json()["pinned"] == 0

        deleted = client.delete(f"/api/v1/hobby/{module['id']}/ideas/{idea_id}")
        assert deleted.status_code == 200
        assert client.get(f"/api/v1/hobby/{module['id']}/ideas").json() == []
    with db_connection() as conn:
        count = conn.execute("SELECT COUNT(id) AS count FROM activities").fetchone()["count"]
        assert count == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_hobby_ideas.py -v`
Expected: the four new tests FAIL with 404/405 (endpoints don't exist).

- [ ] **Step 3: Implement the endpoints**

In `backend/app/modules/hobby/router.py`, extend the imports:

```python
from app.modules.activity_ledger.service import insert_activity
from app.shared.schemas import ActivityCreate, HobbyIdeaComplete, HobbyIdeaCreate, HobbyIdeaUpdate
```

Append the three endpoints:

```python
@router.post("/{module_id}/ideas/{idea_id}/complete")
def complete_idea(module_id: str, idea_id: str, payload: HobbyIdeaComplete) -> dict:
    """Close an idea and (by default) log a real session — acting on it creates a record."""
    now = utc_now_iso()
    with db_connection() as conn:
        module = _get_hobby_module(conn, module_id, for_write=True)
        idea = _get_idea(conn, module_id, idea_id)
        if idea["status"] != "open":
            raise HTTPException(status_code=409, detail="Idea is not open")

        activity_id = None
        if payload.log_activity:
            activity = insert_activity(
                conn,
                ActivityCreate(
                    module_id=module_id,
                    discipline_id=module["discipline_id"],
                    activity_type="hobby",
                    title=idea["title"],
                    notes=payload.notes,
                    duration_minutes=payload.duration_minutes,
                    source="hobby_idea",
                    metadata={"hobby_idea_id": idea_id},
                ),
            )
            activity_id = activity["id"]

        conn.execute(
            """
            UPDATE hobby_ideas
            SET status = 'done', pinned = 0, completed_at = ?, completed_activity_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (now, activity_id, now, idea_id),
        )
        record_audit_event(
            conn,
            entity_type="hobby_idea",
            entity_id=idea_id,
            action="completed",
            summary=f"Did it: {idea['title']}",
            changes={"logged_activity": bool(activity_id)},
        )
        return _get_idea(conn, module_id, idea_id)


@router.post("/{module_id}/ideas/{idea_id}/drop")
def drop_idea(module_id: str, idea_id: str) -> dict:
    """Archive an idea without pretending it was done — no activity is logged."""
    now = utc_now_iso()
    with db_connection() as conn:
        _get_hobby_module(conn, module_id, for_write=True)
        idea = _get_idea(conn, module_id, idea_id)
        if idea["status"] != "open":
            raise HTTPException(status_code=409, detail="Idea is not open")
        conn.execute(
            "UPDATE hobby_ideas SET status = 'dropped', pinned = 0, updated_at = ? WHERE id = ?",
            (now, idea_id),
        )
        record_audit_event(
            conn,
            entity_type="hobby_idea",
            entity_id=idea_id,
            action="dropped",
            summary=f"Dropped hobby idea: {idea['title']}",
            changes={},
        )
        return _get_idea(conn, module_id, idea_id)


@router.delete("/{module_id}/ideas/{idea_id}")
def delete_idea(module_id: str, idea_id: str) -> dict:
    with db_connection() as conn:
        _get_hobby_module(conn, module_id, for_write=True)
        idea = _get_idea(conn, module_id, idea_id)
        conn.execute("DELETE FROM hobby_ideas WHERE id = ?", (idea_id,))
        record_audit_event(
            conn,
            entity_type="hobby_idea",
            entity_id=idea_id,
            action="deleted",
            summary=f"Deleted hobby idea: {idea['title']}",
            changes={"title": idea["title"]},
        )
        return idea
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_hobby_ideas.py -v`
Expected: all PASS (13 tests).

- [ ] **Step 5: Full backend suite + lint + commit**

```bash
cd backend && .venv/bin/python -m pytest -q && .venv/bin/ruff check app tests
git add backend/app/modules/hobby/router.py backend/tests/test_hobby_ideas.py
git commit -m "feat(hobby): complete/drop/delete — Did-it logs a real session in one transaction"
```

---

### Task 5: Frontend API client + hobby-logic + tests

**Files:**
- Modify: `frontend/src/api/atlas.ts` (HobbyIdea type + six functions; extend `ModulePayload` with `config`)
- Create: `frontend/src/features/hobby-logic.ts`
- Create: `frontend/src/features/hobby-logic.test.ts`

**Interfaces:**
- Consumes: `request<T>` helper, `DashboardModule` type (has `behavior: ModuleBehavior`), `Accent` type — all already in `atlas.ts`.
- Produces (used by Task 6/7):
  - atlas.ts: `HobbyIdea`, `listHobbyIdeas(moduleId, status?)`, `createHobbyIdea(moduleId, {title, notes?})`, `updateHobbyIdea(moduleId, ideaId, {title?, notes?, pinned?})`, `completeHobbyIdea(moduleId, ideaId, options?)`, `dropHobbyIdea(moduleId, ideaId)`, `deleteHobbyIdea(moduleId, ideaId)`, `ModulePayload.config?: Record<string, unknown>`.
  - hobby-logic.ts: `HobbyRow`, `HobbyCategory`, `hobbyRows(modules)`, `gapLabel(daysSince)`, `gapTone(daysSince)`, `categoryAccent(category)`, `weeklySessionsTotal(rows)`, `HOBBY_TILE_CAP = 3`, `HOBBY_GAP_WARM_DAYS = 7`, `HOBBY_CATEGORY_LABELS`, `HOBBY_CATEGORIES`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/hobby-logic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DashboardModule } from "../api/atlas";
import {
  HOBBY_TILE_CAP,
  gapLabel,
  gapTone,
  hobbyRows,
  weeklySessionsTotal
} from "./hobby-logic";

function hobbyModule(
  name: string,
  summary: Record<string, unknown>,
  overrides: Partial<DashboardModule> = {}
): DashboardModule {
  return {
    id: `id-${name}`,
    name,
    slug: name.toLowerCase(),
    type: "hobby",
    status: "active",
    priority: 3,
    discipline_name: "Play",
    discipline_slug: "play",
    behavior: { module_id: `id-${name}`, type: "hobby", config: {}, summary },
    ...overrides
  };
}

describe("hobbyRows", () => {
  it("keeps only hobby modules and maps the summary", () => {
    const rows = hobbyRows([
      hobbyModule("Guitar", {
        days_since_last: 12,
        ideas_open: 3,
        next_idea: { id: "i1", title: "Karma Police intro" },
        weekly_activity_count: 0,
        category: "creative"
      }),
      hobbyModule("Project", {}, { type: "project" })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Guitar",
      daysSince: 12,
      ideasOpen: 3,
      nextIdea: { id: "i1", title: "Karma Police intro" },
      category: "creative"
    });
  });

  it("orders most-starving first, never-logged at the very top", () => {
    const rows = hobbyRows([
      hobbyModule("Climbing", { days_since_last: 2, weekly_activity_count: 2 }),
      hobbyModule("Guitar", { days_since_last: 12, weekly_activity_count: 0 }),
      hobbyModule("Chess", { days_since_last: null, weekly_activity_count: 0 })
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Chess", "Guitar", "Climbing"]);
  });

  it("defaults malformed summaries safely", () => {
    const rows = hobbyRows([hobbyModule("Weird", { category: "banana", next_idea: "junk" })]);
    expect(rows[0].category).toBe("creative");
    expect(rows[0].nextIdea).toBeNull();
    expect(rows[0].daysSince).toBeNull();
    expect(rows[0].ideasOpen).toBe(0);
  });
});

describe("gap formatting", () => {
  it("labels gaps in Hebrew", () => {
    expect(gapLabel(null)).toBe("אין סשנים עדיין");
    expect(gapLabel(0)).toBe("היום");
    expect(gapLabel(1)).toBe("אתמול");
    expect(gapLabel(8)).toBe("לפני 8 ימים");
  });

  it("turns warm at 7 days or never-logged", () => {
    expect(gapTone(6)).toBe("ok");
    expect(gapTone(7)).toBe("warm");
    expect(gapTone(null)).toBe("warm");
  });
});

describe("tile totals", () => {
  it("caps at 3 and sums weekly sessions", () => {
    const rows = hobbyRows([
      hobbyModule("A", { days_since_last: 1, weekly_activity_count: 2 }),
      hobbyModule("B", { days_since_last: 2, weekly_activity_count: 1 }),
      hobbyModule("C", { days_since_last: 3, weekly_activity_count: 0 }),
      hobbyModule("D", { days_since_last: 4, weekly_activity_count: 1 })
    ]);
    expect(rows.length).toBe(4);
    expect(rows.slice(0, HOBBY_TILE_CAP).map((row) => row.name)).toEqual(["D", "C", "B"]);
    expect(weeklySessionsTotal(rows)).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL — `./hobby-logic` module not found. (Existing `*-logic.test.ts` suites still pass.)

- [ ] **Step 3: Add the API client functions**

In `frontend/src/api/atlas.ts`, extend `ModulePayload` (line ~165) with one field:

```ts
export type ModulePayload = {
  discipline_id: string;
  type: string;
  name: string;
  slug: string;
  description?: string;
  priority?: number;
  config?: Record<string, unknown>;
};
```

Then, next to the project item functions (after `completeProjectItem`), add:

```ts
export type HobbyIdeaStatus = "open" | "done" | "dropped";

export type HobbyIdea = {
  id: string;
  module_id: string;
  title: string;
  notes: string | null;
  status: HobbyIdeaStatus;
  pinned: number;
  completed_at: string | null;
  completed_activity_id: string | null;
  created_at: string;
  updated_at: string;
};

export function listHobbyIdeas(moduleId: string, status?: HobbyIdeaStatus): Promise<HobbyIdea[]> {
  const query = status ? `?status=${status}` : "";
  return request<HobbyIdea[]>(`/hobby/${moduleId}/ideas${query}`);
}

export function createHobbyIdea(moduleId: string, payload: { title: string; notes?: string }): Promise<HobbyIdea> {
  return request<HobbyIdea>(`/hobby/${moduleId}/ideas`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateHobbyIdea(
  moduleId: string,
  ideaId: string,
  payload: { title?: string; notes?: string; pinned?: boolean }
): Promise<HobbyIdea> {
  return request<HobbyIdea>(`/hobby/${moduleId}/ideas/${ideaId}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function completeHobbyIdea(
  moduleId: string,
  ideaId: string,
  options?: { logActivity?: boolean; durationMinutes?: number; notes?: string }
): Promise<HobbyIdea> {
  return request<HobbyIdea>(`/hobby/${moduleId}/ideas/${ideaId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      log_activity: options?.logActivity ?? true,
      duration_minutes: options?.durationMinutes,
      notes: options?.notes
    })
  });
}

export function dropHobbyIdea(moduleId: string, ideaId: string): Promise<HobbyIdea> {
  return request<HobbyIdea>(`/hobby/${moduleId}/ideas/${ideaId}/drop`, { method: "POST" });
}

export function deleteHobbyIdea(moduleId: string, ideaId: string): Promise<HobbyIdea> {
  return request<HobbyIdea>(`/hobby/${moduleId}/ideas/${ideaId}`, { method: "DELETE" });
}
```

- [ ] **Step 4: Create hobby-logic.ts**

Create `frontend/src/features/hobby-logic.ts`:

```ts
import type { Accent, DashboardModule } from "../api/atlas";

// Pure hobby-tile logic: mapping dashboard modules to rows, ordering, and
// gap formatting. Keep React out of this file — it is unit-tested directly.

export type HobbyCategory = "creative" | "physical" | "maker" | "games";

export type HobbyRow = {
  id: string;
  name: string;
  category: HobbyCategory;
  daysSince: number | null;
  ideasOpen: number;
  nextIdea: { id: string; title: string } | null;
  weeklyCount: number;
};

export const HOBBY_TILE_CAP = 3;
export const HOBBY_GAP_WARM_DAYS = 7;

export const HOBBY_CATEGORIES: HobbyCategory[] = ["creative", "physical", "maker", "games"];

export const HOBBY_CATEGORY_LABELS: Record<HobbyCategory, string> = {
  creative: "יצירה",
  physical: "גוף",
  maker: "מייקר",
  games: "משחקים"
};

const CATEGORY_ACCENTS: Record<HobbyCategory, Accent> = {
  creative: "purple",
  physical: "green",
  maker: "orange",
  games: "red"
};

export function categoryAccent(category: HobbyCategory): Accent {
  return CATEGORY_ACCENTS[category];
}

function toCategory(value: unknown): HobbyCategory {
  return value === "physical" || value === "maker" || value === "games" ? value : "creative";
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Never-logged (null gap) is the most starving; then longest gap; name as a stable tiebreak.
function starvingFirst(left: HobbyRow, right: HobbyRow): number {
  const leftGap = left.daysSince ?? Number.POSITIVE_INFINITY;
  const rightGap = right.daysSince ?? Number.POSITIVE_INFINITY;
  if (leftGap !== rightGap) {
    return rightGap - leftGap;
  }
  return left.name.localeCompare(right.name);
}

export function hobbyRows(modules: DashboardModule[]): HobbyRow[] {
  return modules
    .filter((module) => module.type === "hobby")
    .map((module) => {
      const summary = (module.behavior?.summary ?? {}) as Record<string, unknown>;
      const rawIdea = summary.next_idea as { id?: unknown; title?: unknown } | null | undefined;
      const nextIdea =
        rawIdea && typeof rawIdea === "object" && typeof rawIdea.id === "string" && typeof rawIdea.title === "string"
          ? { id: rawIdea.id, title: rawIdea.title }
          : null;
      return {
        id: module.id,
        name: module.name,
        category: toCategory(summary.category),
        daysSince: typeof summary.days_since_last === "number" ? summary.days_since_last : null,
        ideasOpen: toCount(summary.ideas_open),
        nextIdea,
        weeklyCount: toCount(summary.weekly_activity_count)
      };
    })
    .sort(starvingFirst);
}

export function gapLabel(daysSince: number | null): string {
  if (daysSince === null) {
    return "אין סשנים עדיין";
  }
  if (daysSince === 0) {
    return "היום";
  }
  if (daysSince === 1) {
    return "אתמול";
  }
  return `לפני ${daysSince} ימים`;
}

export function gapTone(daysSince: number | null): "warm" | "ok" {
  return daysSince === null || daysSince >= HOBBY_GAP_WARM_DAYS ? "warm" : "ok";
}

export function weeklySessionsTotal(rows: HobbyRow[]): number {
  return rows.reduce((sum, row) => sum + row.weeklyCount, 0);
}
```

(Verified: `Accent` in atlas.ts is `"blue" | "purple" | "green" | "orange" | "red" | "neutral"` and styles.css defines `chip-purple/green/orange/red`, so the mapping above is valid as written.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test`
Expected: all suites PASS, including `hobby-logic.test.ts` (8 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/atlas.ts frontend/src/features/hobby-logic.ts frontend/src/features/hobby-logic.test.ts
git commit -m "feat(hobby): frontend api client + pure tile logic with tests"
```

---

### Task 6: Hobbies tile + expand modal + dashboard grid

**Files:**
- Create: `frontend/src/features/hobbies.tsx`
- Modify: `frontend/src/App.tsx` (import, `has-hobbies` class on `.bento`, mount tile after `<DashboardCalendar ... />`)
- Modify: `frontend/src/styles.css` (bento 4-tile variant + hobby styles, after the `.news-panel` rules ~line 543)

**Interfaces:**
- Consumes: everything from Task 5; `Panel`, `Modal`, `Chip` from `shared/ui.tsx`; `quickLog`, `DashboardResponse` from `api/atlas.ts`.
- Produces: `HobbiesTile({ dashboard, onChanged })` — renders `null` when there are no hobby modules; `IdeaBacklog({ moduleId, onChanged })` (also used by Task 7's `HobbyBoard`).

- [ ] **Step 1: Create hobbies.tsx**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Check, Palette, Pin, Plus, Save, Trash2, X } from "lucide-react";

import {
  completeHobbyIdea,
  createHobbyIdea,
  dropHobbyIdea,
  listHobbyIdeas,
  quickLog,
  updateHobbyIdea,
  type DashboardResponse,
  type HobbyIdea
} from "../api/atlas";
import { Chip, Modal, Panel } from "../shared/ui";
import {
  HOBBY_CATEGORY_LABELS,
  HOBBY_TILE_CAP,
  categoryAccent,
  gapLabel,
  gapTone,
  hobbyRows,
  weeklySessionsTotal,
  type HobbyRow
} from "./hobby-logic";

// Hobbies feature: kiosk tile + expand modal + the modules-page board.
// All hobby UI lives here; dashboard/modules only import and mount.

export function HobbiesTile({ dashboard, onChanged }: { dashboard: DashboardResponse | null; onChanged?: () => void }) {
  const rows = hobbyRows(dashboard?.active_modules ?? []);
  const [isOpen, setIsOpen] = useState(false);

  if (!rows.length) {
    return null;
  }

  return (
    <>
      <Panel
        title="Hobbies"
        eyebrow="Idea backlog · act on it"
        icon={<Palette size={21} />}
        className="hobbies-panel"
        onOpen={() => setIsOpen(true)}
      >
        <div className="hobby-tile-rows">
          {rows.slice(0, HOBBY_TILE_CAP).map((row) => (
            <div className="hobby-tile-row" key={row.id}>
              <div className="hobby-tile-line">
                <strong dir="auto">{row.name}</strong>
                <Chip accent={categoryAccent(row.category)}>{HOBBY_CATEGORY_LABELS[row.category]}</Chip>
                <span className={`hobby-gap hobby-gap-${gapTone(row.daysSince)}`}>{gapLabel(row.daysSince)}</span>
              </div>
              <p className="hobby-next" dir="auto">
                {row.nextIdea ? (
                  <>
                    <span className="hobby-next-tag">NEXT</span>
                    {row.nextIdea.title}
                  </>
                ) : (
                  "אין רעיון פתוח — הוסף אחד"
                )}
              </p>
            </div>
          ))}
        </div>
        <footer className="hobby-tile-foot">
          <span>{weeklySessionsTotal(rows)} סשנים השבוע</span>
          {rows.length > HOBBY_TILE_CAP ? <span>+{rows.length - HOBBY_TILE_CAP} עוד</span> : null}
        </footer>
      </Panel>

      {isOpen ? (
        <Modal eyebrow="Idea backlog" title="Hobbies" onClose={() => setIsOpen(false)}>
          <div className="hobby-modal">
            {rows.map((row) => (
              <HobbyModalRow key={row.id} row={row} onChanged={onChanged} />
            ))}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function HobbyModalRow({ row, onChanged }: { row: HobbyRow; onChanged?: () => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  async function didIt() {
    if (!row.nextIdea || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await completeHobbyIdea(row.id, row.nextIdea.id);
      onChanged?.();
    } finally {
      setIsBusy(false);
    }
  }

  async function logSession() {
    if (isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await quickLog({ module_id: row.id, title: `סשן ${row.name}`, activity_type: "hobby" });
      onChanged?.();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <article className="hobby-modal-row">
      <div className="hobby-modal-head">
        <strong dir="auto">{row.name}</strong>
        <Chip accent={categoryAccent(row.category)}>{HOBBY_CATEGORY_LABELS[row.category]}</Chip>
        <span className="spacer" />
        <button className="hobby-action primary" type="button" disabled={!row.nextIdea || isBusy} onClick={didIt}>
          <Check size={14} />
          עשיתי את זה
        </button>
        <button className="hobby-action" type="button" disabled={isBusy} onClick={logSession}>
          לוג סשן
        </button>
        <button className="hobby-action" type="button" onClick={() => setIsExpanded((value) => !value)}>
          {isExpanded ? "סגור" : "רעיונות"}
        </button>
      </div>
      <p className="hobby-modal-stats" dir="auto">
        {gapLabel(row.daysSince)} · {row.weeklyCount} סשנים השבוע · {row.ideasOpen} רעיונות פתוחים
        {row.nextIdea ? <> · הבא: {row.nextIdea.title}</> : null}
      </p>
      {isExpanded ? <IdeaBacklog moduleId={row.id} onChanged={onChanged} /> : null}
    </article>
  );
}

export function IdeaBacklog({ moduleId, onChanged }: { moduleId: string; onChanged?: () => void }) {
  const [ideas, setIdeas] = useState<HobbyIdea[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(() => {
    setIsLoading(true);
    listHobbyIdeas(moduleId)
      .then(setIdeas)
      .finally(() => setIsLoading(false));
  }, [moduleId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await action();
      reload();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  async function addIdea(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      return;
    }
    await createHobbyIdea(moduleId, { title });
    setNewTitle("");
    reload();
    onChanged?.();
  }

  async function saveEdit(id: string) {
    const title = editTitle.trim();
    if (!title) {
      return;
    }
    await run(id, () => updateHobbyIdea(moduleId, id, { title }));
    setEditId(null);
  }

  const openIdeas = ideas.filter((idea) => idea.status === "open");
  const closedIdeas = ideas.filter((idea) => idea.status !== "open");

  return (
    <div className="hobby-backlog">
      <span className="hobby-backlog-title">רעיונות</span>
      {isLoading ? <p className="hobby-backlog-empty">טוען…</p> : null}
      {!isLoading && !openIdeas.length ? <p className="hobby-backlog-empty">אין רעיון פתוח — הוסף אחד</p> : null}

      {openIdeas.map((idea) => (
        <div className="hobby-idea" key={idea.id}>
          {idea.pinned ? <span className="hobby-idea-pin">NEXT</span> : null}
          {editId === idea.id ? (
            <>
              <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} dir="auto" />
              <button className="hobby-action" type="button" onClick={() => saveEdit(idea.id)}>
                <Save size={13} />
              </button>
              <button className="hobby-action" type="button" onClick={() => setEditId(null)}>
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              <span className="title" dir="auto">{idea.title}</span>
              <button
                className="hobby-action"
                type="button"
                disabled={busyId === idea.id}
                onClick={() => run(idea.id, () => completeHobbyIdea(moduleId, idea.id))}
                title="עשיתי את זה — סוגר ורושם סשן"
              >
                <Check size={13} />
              </button>
              {!idea.pinned ? (
                <button
                  className="hobby-action"
                  type="button"
                  disabled={busyId === idea.id}
                  onClick={() => run(idea.id, () => updateHobbyIdea(moduleId, idea.id, { pinned: true }))}
                  title="הצמד כרעיון הבא"
                >
                  <Pin size={13} />
                </button>
              ) : null}
              <button
                className="hobby-action"
                type="button"
                onClick={() => {
                  setEditId(idea.id);
                  setEditTitle(idea.title);
                }}
                title="עריכה"
              >
                עריכה
              </button>
              <button
                className="hobby-action danger"
                type="button"
                disabled={busyId === idea.id}
                onClick={() => run(idea.id, () => dropHobbyIdea(moduleId, idea.id))}
                title="ויתור — בלי לרשום סשן"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      ))}

      {closedIdeas.slice(0, 3).map((idea) => (
        <div className="hobby-idea hobby-idea-closed" key={idea.id}>
          <span className="title" dir="auto">{idea.title}</span>
          <small>{idea.status === "done" ? "בוצע" : "ירד"}</small>
        </div>
      ))}

      <form className="hobby-idea-add" onSubmit={addIdea}>
        <input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder="רעיון חדש…"
          dir="auto"
        />
        <button className="hobby-action" type="submit">
          <Plus size={13} />
          הוסף
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Mount in App.tsx**

In `frontend/src/App.tsx`:
- Add the import next to the widgets import: `import { HobbiesTile } from "./features/hobbies";`
- Compute the grid variant just above the `return` of the dashboard view (near where `todayLabel` is used):

```tsx
const hasHobbies = (dashboard?.active_modules ?? []).some((module) => module.type === "hobby");
```

- Change `<section className="bento" aria-label="Atlas dashboard">` to:

```tsx
<section className={`bento${hasHobbies ? " has-hobbies" : ""}`} aria-label="Atlas dashboard">
```

- Mount the tile between `<DashboardCalendar ... />` and `<NewsTile />`:

```tsx
<HobbiesTile dashboard={dashboard} onChanged={refreshDashboard} />
```

- [ ] **Step 3: Add the CSS**

In `frontend/src/styles.css`, after the `.news-panel { grid-area: news; }` rule (~line 543), add:

```css
/* ---- Hobbies tile (middle bento row becomes 4 tiles) ------------ */

.bento.has-hobbies {
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-areas:
    "hero hero hero hero hero hero hero hero pulse pulse pulse pulse"
    "missions missions missions timeline timeline timeline calendar calendar calendar hobbies hobbies hobbies"
    "news news news news news news news news news news news news";
}

.hobbies-panel {
  grid-area: hobbies;
}

.hobby-tile-rows {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.hobby-tile-row {
  padding: var(--sp-2) 0;
  border-top: 1px solid var(--border-subtle);
}

.hobby-tile-row:first-child {
  border-top: 0;
}

.hobby-tile-line {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.hobby-tile-line strong {
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
}

.hobby-gap {
  margin-inline-start: auto;
  font-size: var(--fs-xs);
  white-space: nowrap;
}

.hobby-gap-warm {
  color: var(--orange);
}

.hobby-gap-ok {
  color: var(--text-secondary);
}

.hobby-next {
  margin: 2px 0 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hobby-next-tag {
  color: var(--accent);
  font-weight: var(--fw-bold);
  font-size: 10px;
  letter-spacing: 0.08em;
  margin-inline-end: 6px;
}

.hobby-tile-foot {
  margin-top: auto;
  padding-top: var(--sp-2);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

/* ---- Hobbies modal + backlog ------------------------------------ */

.hobby-modal-row {
  border-top: 1px solid var(--border-subtle);
  padding: var(--sp-3) 0;
}

.hobby-modal-row:first-child {
  border-top: 0;
}

.hobby-modal-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.hobby-modal-head .spacer {
  flex: 1;
}

.hobby-modal-stats {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}

.hobby-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: var(--fs-xs);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-sm);
  padding: 4px 10px;
  cursor: pointer;
}

.hobby-action:hover {
  border-color: var(--border-accent);
}

.hobby-action:disabled {
  opacity: 0.45;
  cursor: default;
}

.hobby-action.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.hobby-action.danger:hover {
  border-color: var(--red);
  color: var(--red);
}

.hobby-backlog {
  margin-top: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  background: var(--surface-soft);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.hobby-backlog-title {
  display: block;
  font-size: var(--fs-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  font-weight: var(--fw-semibold);
  margin-bottom: var(--sp-2);
}

.hobby-backlog-empty {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}

.hobby-idea {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 6px 0;
  border-top: 1px solid var(--border-subtle);
  font-size: var(--fs-sm);
}

.hobby-idea:first-of-type {
  border-top: 0;
}

.hobby-idea .title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hobby-idea-closed .title {
  color: var(--text-muted);
  text-decoration: line-through;
}

.hobby-idea-closed small {
  color: var(--text-muted);
  font-size: var(--fs-xs);
}

.hobby-idea-pin {
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--border-accent);
  border-radius: var(--r-pill);
  font-size: 10px;
  font-weight: var(--fw-bold);
  letter-spacing: 0.08em;
  padding: 1px 7px;
}

.hobby-idea input,
.hobby-idea-add input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: var(--fs-sm);
  color: var(--text-primary);
  background: var(--bg-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  padding: 6px 10px;
}

.hobby-idea-add {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}

/* ---- Hobby board (modules page) ---------------------------------- */

.hobby-stat-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
}

.hobby-stat {
  background: var(--surface-soft);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
  padding: var(--sp-3);
}

.hobby-stat strong {
  display: block;
  font-size: var(--fs-xl);
  font-variant-numeric: tabular-nums;
}

.hobby-stat span {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
```

- [ ] **Step 4: Verify it compiles and tests pass**

Run: `cd frontend && npm test && npm run build`
Expected: vitest PASS, build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/hobbies.tsx frontend/src/App.tsx frontend/src/styles.css
git commit -m "feat(hobby): dashboard tile + expand modal, middle bento row goes 3->4 tiles"
```

---

### Task 7: Modules page — create with category + HobbyBoard

**Files:**
- Modify: `frontend/src/features/modules.tsx` (add `"hobby"` to `moduleTypes` line ~549; category picker in ModulesView create form; `HobbyBoard` branch in the behavior panel ~line 856)
- Modify: `frontend/src/features/hobbies.tsx` (add `HobbyBoard` export)
- Modify: `frontend/src/shared/format.ts` (`moduleTypeLabel` gains `hobby: "Hobby"`)

**Interfaces:**
- Consumes: `IdeaBacklog` from Task 6; `getModuleBehavior(moduleId)` (already in atlas.ts); `HOBBY_CATEGORIES`, `HOBBY_CATEGORY_LABELS`, `gapLabel` from hobby-logic.
- Produces: `HobbyBoard({ moduleId, onChanged })` mounted in the modules-page behavior panel; hobby creation persists `config.category`.

- [ ] **Step 1: Add HobbyBoard to hobbies.tsx**

Append to `frontend/src/features/hobbies.tsx` (add `getModuleBehavior, type ModuleBehavior` to the existing atlas import and `gapLabel` is already imported):

```tsx
export function HobbyBoard({ moduleId, onChanged }: { moduleId: string; onChanged: () => void }) {
  const [behavior, setBehavior] = useState<ModuleBehavior | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    getModuleBehavior(moduleId).then((next) => {
      if (active) {
        setBehavior(next);
      }
    });
    return () => {
      active = false;
    };
  }, [moduleId, refreshKey]);

  const summary = (behavior?.summary ?? {}) as Record<string, unknown>;
  const daysSince = typeof summary.days_since_last === "number" ? summary.days_since_last : null;

  function handleChanged() {
    setRefreshKey((value) => value + 1);
    onChanged();
  }

  return (
    <div className="hobby-board">
      <div className="hobby-stat-row">
        <div className="hobby-stat">
          <strong>{daysSince ?? "—"}</strong>
          <span>ימים מאז</span>
        </div>
        <div className="hobby-stat">
          <strong>{Number(summary.weekly_activity_count ?? 0)}</strong>
          <span>סשנים השבוע</span>
        </div>
        <div className="hobby-stat">
          <strong>{Number(summary.weekly_minutes ?? 0)}</strong>
          <span>דקות השבוע</span>
        </div>
        <div className="hobby-stat">
          <strong>{Number(summary.ideas_open ?? 0)}</strong>
          <span>רעיונות פתוחים</span>
        </div>
      </div>
      <IdeaBacklog moduleId={moduleId} onChanged={handleChanged} />
    </div>
  );
}
```

- [ ] **Step 2: Wire the modules page**

In `frontend/src/features/modules.tsx`:

1. Extend the type list (line ~549):

```ts
export const moduleTypes = ["project", "habit", "learning", "recovery", "relationship", "hobby", "finance", "calendar"] as const;
```

2. Import at the top: `import { HobbyBoard } from "./hobbies";` and `import { HOBBY_CATEGORIES, HOBBY_CATEGORY_LABELS, type HobbyCategory } from "./hobby-logic";`

3. In `ModulesView`, add category state next to the other form state:

```ts
const [category, setCategory] = useState<HobbyCategory>("creative");
```

4. In the create form, right after the type `<select>`, add a conditional picker (mirror the surrounding label markup style):

```tsx
{type === "hobby" ? (
  <label>
    קטגוריה
    <select value={category} onChange={(event) => setCategory(event.target.value as HobbyCategory)}>
      {HOBBY_CATEGORIES.map((option) => (
        <option key={option} value={option}>
          {HOBBY_CATEGORY_LABELS[option]}
        </option>
      ))}
    </select>
  </label>
) : null}
```

5. Where `ModulesView` calls `onCreateModule({...})`, add the config field:

```ts
config: type === "hobby" ? { category } : undefined,
```

(`ModulePayload` gained `config?` in Task 5; the backend create endpoint already persists `payload.config`.)

6. In the behavior panel branching (~line 856), add a hobby branch after the `learning` branch:

```tsx
) : selectedModule?.type === "hobby" ? (
  <HobbyBoard moduleId={selectedModule.id} onChanged={onChanged} />
```

7. Also update the panel eyebrow ternary (~line 843) so hobby reads properly — add before the recovery/relationship case:

```tsx
: selectedModule?.type === "hobby"
  ? "Hobby board · live"
```

- [ ] **Step 3: Label the type**

In `frontend/src/shared/format.ts`, inside `moduleTypeLabel`'s `labels` map, add:

```ts
hobby: "Hobby",
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm test && npm run build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/modules.tsx frontend/src/features/hobbies.tsx frontend/src/shared/format.ts
git commit -m "feat(hobby): modules page — create with category, live hobby board"
```

---

### Task 8: End-to-end verification

**Files:**
- No new files. Full-suite runs + live API smoke on a throwaway port/DB.

- [ ] **Step 1: Full backend suite + lint**

Run: `cd backend && .venv/bin/python -m pytest -q && .venv/bin/ruff check app tests`
Expected: all tests pass, no lint errors.

- [ ] **Step 2: Full frontend suite + build**

Run: `cd frontend && npm test && npm run build`
Expected: all tests pass, build clean.

- [ ] **Step 3: Live API smoke (throwaway DB + port — never the dev DB, never :8000)**

```bash
cd backend
ATLAS_DATABASE_PATH=$(mktemp -d)/smoke.sqlite .venv/bin/uvicorn app.main:app --port 8010 &
sleep 2
DISC=$(curl -s localhost:8010/api/v1/disciplines | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
MOD=$(curl -s -X POST localhost:8010/api/v1/modules -H 'Content-Type: application/json' \
  -d "{\"discipline_id\":\"$DISC\",\"type\":\"hobby\",\"name\":\"Guitar\",\"slug\":\"guitar\",\"config\":{\"category\":\"creative\"}}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
IDEA=$(curl -s -X POST localhost:8010/api/v1/hobby/$MOD/ideas -H 'Content-Type: application/json' \
  -d '{"title":"Karma Police intro"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s -X POST localhost:8010/api/v1/hobby/$MOD/ideas/$IDEA/complete -H 'Content-Type: application/json' -d '{"duration_minutes":20}'
curl -s localhost:8010/api/v1/dashboard | python3 -c "
import sys, json
data = json.load(sys.stdin)
hobby = [m for m in data['active_modules'] if m['type'] == 'hobby'][0]
print(json.dumps(hobby['behavior']['summary'], ensure_ascii=False, indent=2))
"
kill %1
```

Expected in the final output: `days_since_last: 0`, `ideas_open: 0`, `next_idea: null`, `category: "creative"`, `weekly_activity_count: 1` — proving idea → Did it → session → dashboard summary end-to-end.

- [ ] **Step 4: Visual check (only if a dev environment is already running)**

If the Desktop dev stack is up (`./scripts/dev.sh` — never the Documents copy), open the dashboard: with at least one hobby module the middle bento row shows four tiles including Hobbies; with none, the layout is unchanged. Confirm no scrolling on the kiosk viewport.

- [ ] **Step 5: Final commit (if any stragglers) and wrap-up**

```bash
git status --short   # should be clean; commit anything intentional that remains
```

Done — hand back for user testing. Follow-ups deliberately out of v1 (per spec): idea photos/artifacts, WhatsApp daily-brief hobby suggestions, per-category analytics.
