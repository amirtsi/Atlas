# Proposal Inbox (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An advisory Proposal Inbox — suggested module changes are created `pending`, surfaced on the dashboard, and applied only when the owner accepts them.

**Architecture:** New `proposals` domain (table + service + router). Accept dispatches by type through a **handler registry** to a small extracted `life_modules` service; nothing mutates until accepted; everything audited. A dashboard "Coach" tile lists pending proposals.

**Tech Stack:** Python 3.12, FastAPI, SQLite; React 19 + Vite frontend. Tests: pytest + FastAPI TestClient; frontend `tsc`/`vite build`.

## Global Constraints

- Python `>=3.12`; no new runtime dependencies.
- **Honest core:** proposals change nothing until accepted; accept applies **only** through the `life_modules` service (validated: module existence, status whitelist) — no raw mutation, no fabrication. The generator cites real activity data. Every create/accept/dismiss writes an `audit_events` row.
- Reuse existing patterns: service layer, `record_audit_event`, `get_or_404`, `AtlasModel`/`AtlasResponse`, per-test temp DB (`tests/conftest.py`).
- New table lands via `SCHEMA_SQL` `IF NOT EXISTS` (no `user_version` bump).
- Backend commands run from `backend/`; venv Python `.venv/bin/python`. Must pass `.venv/bin/ruff check app tests` and the full `pytest`. Frontend from `frontend/`: `npm run build` (tsc + vite) must pass.

---

### Task 1: Extract `life_modules` service

**Files:**
- Create: `backend/app/modules/life_modules/service.py`
- Modify: `backend/app/modules/life_modules/router.py`
- Test: `backend/tests/test_life_modules_service.py`

**Interfaces:**
- Produces: `VALID_STATUSES: set[str]`; `set_module_status(conn, module_id: str, status: str) -> dict`; `set_module_priority(conn, module_id: str, priority: int) -> dict`.

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_life_modules_service.py`:

```python
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import db_connection
from app.main import app
from app.modules.life_modules.service import set_module_priority, set_module_status


def _a_module_id() -> str:
    with TestClient(app) as client:
        return client.get("/api/v1/modules").json()[0]["id"]


def test_set_module_status_archives_and_audits():
    module_id = _a_module_id()
    with db_connection() as conn:
        updated = set_module_status(conn, module_id, "archived")
    assert updated["status"] == "archived"
    assert updated["archived_at"] is not None


def test_set_module_status_rejects_unknown_status():
    module_id = _a_module_id()
    with db_connection() as conn, pytest.raises(HTTPException) as exc:
        set_module_status(conn, module_id, "banana")
    assert exc.value.status_code == 422


def test_set_module_priority_updates():
    module_id = _a_module_id()
    with db_connection() as conn:
        updated = set_module_priority(conn, module_id, 5)
    assert updated["priority"] == 5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_life_modules_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.modules.life_modules.service'`.

- [ ] **Step 3: Write the service** — create `backend/app/modules/life_modules/service.py` with EXACTLY:

```python
"""Life-modules mutation service.

The validated write paths for a module's status and priority, callable from the
router AND from other modules (e.g. the proposal accept-handler) without reaching
into the router. Mirrors the activity_ledger/dashboard service-layer pattern.
"""
from __future__ import annotations

from sqlite3 import Connection

from fastapi import HTTPException

from app.core.database import row_to_dict
from app.core.time import utc_now_iso
from app.shared.audit import record_audit_event
from app.shared.sql import get_or_404

VALID_STATUSES = {"active", "paused", "completed", "archived"}


def set_module_status(conn: Connection, module_id: str, status: str) -> dict:
    if status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported module status")
    now = utc_now_iso()
    get_or_404(conn, "life_modules", module_id)
    archived_at = now if status == "archived" else None
    conn.execute(
        "UPDATE life_modules SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?",
        (status, archived_at, now, module_id),
    )
    module = row_to_dict(conn.execute("SELECT * FROM life_modules WHERE id = ?", (module_id,)).fetchone())
    record_audit_event(
        conn,
        entity_type="life_module",
        entity_id=module_id,
        action=f"status_{status}",
        summary=f"Set module {module['name']} to {status}",
        changes={"status": status},
    )
    return module


def set_module_priority(conn: Connection, module_id: str, priority: int) -> dict:
    now = utc_now_iso()
    get_or_404(conn, "life_modules", module_id)
    conn.execute(
        "UPDATE life_modules SET priority = ?, updated_at = ? WHERE id = ?",
        (priority, now, module_id),
    )
    updated = get_or_404(conn, "life_modules", module_id)
    record_audit_event(
        conn,
        entity_type="life_module",
        entity_id=module_id,
        action="priority_changed",
        summary=f"Set {updated['name']} priority to {priority}",
        changes={"priority": priority},
    )
    return updated
```

- [ ] **Step 4: Refactor the router to use the service**

In `backend/app/modules/life_modules/router.py`:
1. Add import: `from app.modules.life_modules.service import VALID_STATUSES, set_module_priority, set_module_status`
2. Delete the local `VALID_STATUSES = {...}` definition (now imported).
3. Delete the local `def _set_status(...)` function.
4. Replace the three status endpoints' bodies to call the service:

```python
@router.post("/{module_id}/archive", response_model=LifeModuleOut)
def archive_module(module_id: str) -> dict:
    with db_connection() as conn:
        return set_module_status(conn, module_id, "archived")


@router.post("/{module_id}/pause", response_model=LifeModuleOut)
def pause_module(module_id: str) -> dict:
    with db_connection() as conn:
        return set_module_status(conn, module_id, "paused")


@router.post("/{module_id}/resume", response_model=LifeModuleOut)
def resume_module(module_id: str) -> dict:
    with db_connection() as conn:
        return set_module_status(conn, module_id, "active")
```

(`update_module` keeps using the imported `VALID_STATUSES` unchanged.)

- [ ] **Step 5: Run tests + full suite + ruff**

Run: `.venv/bin/python -m pytest tests/test_life_modules_service.py -v` → 3 pass.
Run: `.venv/bin/python -m pytest -q` → all pass (regression: existing module tests still green).
Run: `.venv/bin/ruff check app tests` → clean (use `--fix` if only import-order).

- [ ] **Step 6: Commit**

```bash
git add backend/app/modules/life_modules/service.py backend/app/modules/life_modules/router.py backend/tests/test_life_modules_service.py
git commit -m "refactor(modules): extract life_modules service (set_status/set_priority)"
```

---

### Task 2: Proposals table + schemas + service

**Files:**
- Modify: `backend/app/core/database.py` (add table to `SCHEMA_SQL`; add `"payload"` to `row_to_dict` parse list)
- Modify: `backend/app/shared/schemas.py` (add `ProposalCreate`, `ProposalOut`)
- Create: `backend/app/modules/proposals/__init__.py` (empty)
- Create: `backend/app/modules/proposals/service.py`
- Test: `backend/tests/test_proposals_service.py`

**Interfaces:**
- Consumes: `life_modules.service.set_module_status` / `set_module_priority` (Task 1); `get_or_404`, `record_audit_event`, `new_id`, `utc_now_iso`, `json_dump`.
- Produces: `create_proposal(conn, type, title, rationale, payload, created_by="system") -> dict`; `accept_proposal(conn, proposal_id) -> dict`; `dismiss_proposal(conn, proposal_id) -> dict`; `KNOWN_TYPES: set[str]`.

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_proposals_service.py`:

```python
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import db_connection
from app.main import app
from app.modules.proposals import service


def _module(slug: str = "gym") -> dict:
    with TestClient(app) as client:
        return {m["slug"]: m for m in client.get("/api/v1/modules").json()}[slug]


def test_accept_priority_proposal_changes_module():
    module = _module("gym")
    with db_connection() as conn:
        proposal = service.create_proposal(
            conn, "set_module_priority", "Bump Gym", "focus", {"module_id": module["id"], "priority": 1}
        )
        accepted = service.accept_proposal(conn, proposal["id"])
        row = conn.execute("SELECT priority FROM life_modules WHERE id = ?", (module["id"],)).fetchone()
    assert accepted["status"] == "accepted"
    assert row["priority"] == 1


def test_accept_status_proposal_archives_module():
    module = _module("recovery")
    with db_connection() as conn:
        proposal = service.create_proposal(
            conn, "set_module_status", "Archive Recovery", "stale", {"module_id": module["id"], "status": "archived"}
        )
        service.accept_proposal(conn, proposal["id"])
        row = conn.execute("SELECT status FROM life_modules WHERE id = ?", (module["id"],)).fetchone()
    assert row["status"] == "archived"


def test_dismiss_changes_nothing():
    module = _module("gym")
    with db_connection() as conn:
        before = conn.execute("SELECT priority FROM life_modules WHERE id = ?", (module["id"],)).fetchone()["priority"]
        proposal = service.create_proposal(
            conn, "set_module_priority", "Bump", "x", {"module_id": module["id"], "priority": 5}
        )
        dismissed = service.dismiss_proposal(conn, proposal["id"])
        after = conn.execute("SELECT priority FROM life_modules WHERE id = ?", (module["id"],)).fetchone()["priority"]
    assert dismissed["status"] == "dismissed"
    assert after == before


def test_accept_already_resolved_is_409():
    module = _module("gym")
    with db_connection() as conn:
        proposal = service.create_proposal(
            conn, "set_module_priority", "Bump", "x", {"module_id": module["id"], "priority": 2}
        )
        service.accept_proposal(conn, proposal["id"])
        with pytest.raises(HTTPException) as exc:
            service.accept_proposal(conn, proposal["id"])
    assert exc.value.status_code == 409


def test_create_unknown_type_is_422():
    with db_connection() as conn, pytest.raises(HTTPException) as exc:
        service.create_proposal(conn, "delete_everything", "nope", "x", {})
    assert exc.value.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_proposals_service.py -v`
Expected: FAIL — no `app.modules.proposals` package.

- [ ] **Step 3a: Add the table + payload parsing** in `backend/app/core/database.py`.

Add this block inside `SCHEMA_SQL` (after the `communication_webhook_events` table, before the closing `"""`):

```sql
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
```

In `row_to_dict`, add `"payload"` to the parsed-keys tuple, so it reads:

```python
    for key in ("config", "metadata", "default_metadata", "classification_json", "changes", "payload"):
```

- [ ] **Step 3b: Add schemas** in `backend/app/shared/schemas.py` (append after the response models):

```python
class ProposalCreate(AtlasModel):
    type: str = Field(min_length=1)
    title: str = Field(min_length=1)
    rationale: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    created_by: str = "system"


class ProposalOut(AtlasResponse):
    id: str
    type: str | None = None
    title: str | None = None
    rationale: str | None = None
    payload: dict[str, Any] | None = None
    status: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    resolved_at: str | None = None
```

- [ ] **Step 3c: Write the service** — create empty `backend/app/modules/proposals/__init__.py`, then `backend/app/modules/proposals/service.py`:

```python
"""Proposal inbox service — advisory create / accept / dismiss.

Nothing changes until the owner accepts. Accept dispatches by type through a
handler registry (OCP: new types register a handler, no dispatcher edit) to the
validated life_modules service. Every transition is audited.
"""
from __future__ import annotations

from collections.abc import Callable
from sqlite3 import Connection

from fastapi import HTTPException

from app.core.database import new_id
from app.core.time import utc_now_iso
from app.modules.life_modules.service import set_module_priority, set_module_status
from app.shared.audit import record_audit_event
from app.shared.sql import get_or_404, json_dump

ProposalHandler = Callable[[Connection, dict], dict]


def _apply_set_module_priority(conn: Connection, payload: dict) -> dict:
    return set_module_priority(conn, payload["module_id"], int(payload["priority"]))


def _apply_set_module_status(conn: Connection, payload: dict) -> dict:
    return set_module_status(conn, payload["module_id"], str(payload["status"]))


_HANDLERS: dict[str, ProposalHandler] = {
    "set_module_priority": _apply_set_module_priority,
    "set_module_status": _apply_set_module_status,
}

KNOWN_TYPES = set(_HANDLERS)


def create_proposal(
    conn: Connection, type: str, title: str, rationale: str | None, payload: dict, created_by: str = "system"
) -> dict:
    if type not in KNOWN_TYPES:
        raise HTTPException(status_code=422, detail="Unknown proposal type")
    module_id = payload.get("module_id")
    if module_id:
        get_or_404(conn, "life_modules", module_id)
    proposal_id = new_id()
    now = utc_now_iso()
    conn.execute(
        """
        INSERT INTO proposals (id, type, title, rationale, payload, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        """,
        (proposal_id, type, title, rationale, json_dump(payload), created_by, now),
    )
    proposal = get_or_404(conn, "proposals", proposal_id)
    record_audit_event(
        conn,
        entity_type="proposal",
        entity_id=proposal_id,
        action="created",
        summary=f"Proposal created: {title}",
        changes={"type": type, "created_by": created_by},
    )
    return proposal


def accept_proposal(conn: Connection, proposal_id: str) -> dict:
    proposal = get_or_404(conn, "proposals", proposal_id)
    if proposal["status"] != "pending":
        raise HTTPException(status_code=409, detail="Proposal already resolved")
    handler = _HANDLERS.get(proposal["type"])
    if handler is None:
        raise HTTPException(status_code=422, detail="Unknown proposal type")
    handler(conn, proposal["payload"])  # applies via life_modules service (may raise 404/422)
    now = utc_now_iso()
    conn.execute(
        "UPDATE proposals SET status = 'accepted', resolved_at = ? WHERE id = ?",
        (now, proposal_id),
    )
    updated = get_or_404(conn, "proposals", proposal_id)
    record_audit_event(
        conn,
        entity_type="proposal",
        entity_id=proposal_id,
        action="accepted",
        summary=f"Proposal accepted: {updated['title']}",
        changes={"type": updated["type"]},
    )
    return updated


def dismiss_proposal(conn: Connection, proposal_id: str) -> dict:
    proposal = get_or_404(conn, "proposals", proposal_id)
    if proposal["status"] != "pending":
        raise HTTPException(status_code=409, detail="Proposal already resolved")
    now = utc_now_iso()
    conn.execute(
        "UPDATE proposals SET status = 'dismissed', resolved_at = ? WHERE id = ?",
        (now, proposal_id),
    )
    updated = get_or_404(conn, "proposals", proposal_id)
    record_audit_event(
        conn,
        entity_type="proposal",
        entity_id=proposal_id,
        action="dismissed",
        summary=f"Proposal dismissed: {updated['title']}",
        changes={},
    )
    return updated
```

- [ ] **Step 4: Run tests + ruff**

Run: `.venv/bin/python -m pytest tests/test_proposals_service.py -v` → 5 pass.
Run: `.venv/bin/python -m pytest -q` → all pass. Run: `.venv/bin/ruff check app tests` → clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/database.py backend/app/shared/schemas.py backend/app/modules/proposals/__init__.py backend/app/modules/proposals/service.py backend/tests/test_proposals_service.py
git commit -m "feat(proposals): proposals table + schemas + create/accept/dismiss service"
```

---

### Task 3: Proposals router + generator + wiring

**Files:**
- Create: `backend/app/modules/proposals/router.py`
- Modify: `backend/app/modules/proposals/service.py` (add `generate_module_proposals`)
- Modify: `backend/app/main.py` (register router)
- Test: `backend/tests/test_proposals_api.py`

**Interfaces:**
- Consumes: Task 2 service functions.
- Produces: HTTP `GET/POST /api/v1/proposals`, `POST /api/v1/proposals/{id}/accept|dismiss`, `POST /api/v1/proposals/generate`; `generate_module_proposals(conn) -> list[dict]`.

- [ ] **Step 1: Write the failing test** — create `backend/tests/test_proposals_api.py`:

```python
from fastapi.testclient import TestClient

from app.main import app


def test_create_list_accept_flow():
    with TestClient(app) as client:
        module = {m["slug"]: m for m in client.get("/api/v1/modules").json()}["gym"]
        created = client.post(
            "/api/v1/proposals",
            json={
                "type": "set_module_priority",
                "title": "Bump Gym to 1",
                "rationale": "focus",
                "payload": {"module_id": module["id"], "priority": 1},
            },
        )
        assert created.status_code == 201, created.text
        pid = created.json()["id"]

        pending = client.get("/api/v1/proposals").json()
        assert any(p["id"] == pid for p in pending)

        accepted = client.post(f"/api/v1/proposals/{pid}/accept")
        assert accepted.status_code == 200
        assert accepted.json()["status"] == "accepted"

        module_after = client.get(f"/api/v1/modules/{module['id']}").json()
        assert module_after["priority"] == 1
        # resolved proposals drop out of the default pending list
        assert all(p["id"] != pid for p in client.get("/api/v1/proposals").json())


def test_generate_proposes_only_stale_modules():
    with TestClient(app) as client:
        # Seeded modules have zero activity => all are "stale" => each gets one archive proposal.
        generated = client.post("/api/v1/proposals/generate").json()
        assert len(generated) >= 1
        assert all(p["type"] == "set_module_status" for p in generated)
        # Idempotent: a second run adds nothing (pending archive proposal already exists).
        again = client.post("/api/v1/proposals/generate").json()
        assert again == []


def test_generate_skips_modules_with_recent_activity():
    with TestClient(app) as client:
        modules = {m["slug"]: m for m in client.get("/api/v1/modules").json()}
        oscp = modules["oscp"]
        client.post(
            "/api/v1/activities",
            json={"module_id": oscp["id"], "activity_type": "study", "title": "OSCP", "duration_minutes": 30},
        )
        generated = client.post("/api/v1/proposals/generate").json()
        assert all(p["payload"]["module_id"] != oscp["id"] for p in generated)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_proposals_api.py -v`
Expected: FAIL — 404s (router not registered).

- [ ] **Step 3a: Add the generator** to `backend/app/modules/proposals/service.py` (append; add `timedelta`/`datetime`/`UTC` + `db_connection`-free — it takes `conn`):

Add these imports at the top of the file:

```python
from datetime import UTC, datetime, timedelta
```

Append this function:

```python
def _has_pending(conn: Connection, type: str, module_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM proposals WHERE status = 'pending' AND type = ? "
        "AND json_extract(payload, '$.module_id') = ? LIMIT 1",
        (type, module_id),
    ).fetchone()
    return row is not None


def generate_module_proposals(conn: Connection) -> list[dict]:
    """Honest heuristic: an active module with no activity in 14 days -> propose archive.
    Idempotent (skips modules that already have a pending archive proposal)."""
    cutoff = (datetime.now(UTC) - timedelta(days=14)).replace(microsecond=0).isoformat()
    stale = conn.execute(
        """
        SELECT lm.id, lm.name FROM life_modules lm
        WHERE lm.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM activities a WHERE a.module_id = lm.id AND a.occurred_at >= ?
          )
        ORDER BY lm.name
        """,
        (cutoff,),
    ).fetchall()
    created: list[dict] = []
    for module in stale:
        if _has_pending(conn, "set_module_status", module["id"]):
            continue
        created.append(
            create_proposal(
                conn,
                "set_module_status",
                f"Archive {module['name']}? No activity in 14 days",
                "No logged activity in the last 14 days — archive to keep the active set focused.",
                {"module_id": module["id"], "status": "archived"},
            )
        )
    return created
```

- [ ] **Step 3b: Write the router** — create `backend/app/modules/proposals/router.py`:

```python
from fastapi import APIRouter

from app.core.database import db_connection, rows_to_dicts
from app.modules.proposals.service import (
    accept_proposal,
    create_proposal,
    dismiss_proposal,
    generate_module_proposals,
)
from app.shared.schemas import ProposalCreate, ProposalOut

router = APIRouter(prefix="/proposals", tags=["proposals"])


@router.get("", response_model=list[ProposalOut])
def list_proposals(status: str = "pending") -> list[dict]:
    sql = "SELECT * FROM proposals"
    params: list[object] = []
    if status != "all":
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("", status_code=201, response_model=ProposalOut)
def create(payload: ProposalCreate) -> dict:
    with db_connection() as conn:
        return create_proposal(
            conn, payload.type, payload.title, payload.rationale, payload.payload, payload.created_by
        )


@router.post("/{proposal_id}/accept", response_model=ProposalOut)
def accept(proposal_id: str) -> dict:
    with db_connection() as conn:
        return accept_proposal(conn, proposal_id)


@router.post("/{proposal_id}/dismiss", response_model=ProposalOut)
def dismiss(proposal_id: str) -> dict:
    with db_connection() as conn:
        return dismiss_proposal(conn, proposal_id)


@router.post("/generate", response_model=list[ProposalOut])
def generate() -> list[dict]:
    with db_connection() as conn:
        return generate_module_proposals(conn)
```

- [ ] **Step 3c: Register the router** in `backend/app/main.py`:
1. Add import (with the other module router imports): `from app.modules.proposals.router import router as proposals_router`
2. Add registration (with the other `include_router` calls): `app.include_router(proposals_router, prefix="/api/v1")`

- [ ] **Step 4: Run tests + full suite + ruff**

Run: `.venv/bin/python -m pytest tests/test_proposals_api.py -v` → 3 pass.
Run: `.venv/bin/python -m pytest -q` → all pass. Run: `.venv/bin/ruff check app tests` → clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/proposals/router.py backend/app/modules/proposals/service.py backend/app/main.py backend/tests/test_proposals_api.py
git commit -m "feat(proposals): REST endpoints + stale-module generator + wiring"
```

---

### Task 4: Frontend — Coach inbox tile

**Files:**
- Modify: `frontend/src/api/atlas.ts` (types + calls)
- Create: `frontend/src/features/coach-inbox.tsx`
- Modify: `frontend/src/App.tsx` (render the tile in the dashboard view)

**Interfaces:**
- Consumes: `GET/POST /proposals`, `POST /proposals/{id}/accept|dismiss` (Task 3).
- Produces: `CoachInbox` component; `getProposals`, `acceptProposal`, `dismissProposal`, `Proposal` in the API client.

- [ ] **Step 1: Add the API client calls.** Open `frontend/src/api/atlas.ts`, read the existing request helper (the internal `fetch(\`${API_BASE}${path}\`, ...)` wrapper the other functions use — e.g. how `getModules`/`updateModule` call it). Add, mirroring that exact helper:

```ts
export type Proposal = {
  id: string;
  type: string;
  title: string;
  rationale: string | null;
  payload: Record<string, unknown>;
  status: string;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
};

export function getProposals(status = "pending"): Promise<Proposal[]> {
  return request<Proposal[]>(`/proposals?status=${encodeURIComponent(status)}`);
}

export function acceptProposal(id: string): Promise<Proposal> {
  return request<Proposal>(`/proposals/${id}/accept`, { method: "POST" });
}

export function dismissProposal(id: string): Promise<Proposal> {
  return request<Proposal>(`/proposals/${id}/dismiss`, { method: "POST" });
}
```

> If the internal helper is not named `request`, use whatever name/signature the other exported functions in this file use (read them first) — do not invent a new fetch pattern.

- [ ] **Step 2: Create the component** — `frontend/src/features/coach-inbox.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import { type Proposal, acceptProposal, dismissProposal, getProposals } from "../api/atlas";
import { Panel } from "../shared/ui";

export function CoachInbox({ onChanged }: { onChanged?: () => void }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);

  async function load() {
    try {
      setProposals(await getProposals("pending"));
    } catch {
      setProposals([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function resolve(id: string, action: "accept" | "dismiss") {
    if (action === "accept") {
      await acceptProposal(id);
    } else {
      await dismissProposal(id);
    }
    await load();
    onChanged?.();
  }

  return (
    <Panel title="Coach" eyebrow="Proposals — you approve" className="coach-inbox-panel">
      {proposals.length ? (
        <div className="coach-inbox-list">
          {proposals.slice(0, 4).map((proposal) => (
            <article className="coach-proposal" key={proposal.id}>
              <div className="coach-proposal-body">
                <strong dir="auto">{proposal.title}</strong>
                {proposal.rationale ? <p dir="auto">{proposal.rationale}</p> : null}
              </div>
              <div className="coach-proposal-actions">
                <button className="icon-button small" type="button" aria-label="אשר" onClick={() => resolve(proposal.id, "accept")}>
                  <Check size={15} />
                </button>
                <button className="icon-button small" type="button" aria-label="דחה" onClick={() => resolve(proposal.id, "dismiss")}>
                  <X size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-panel-copy">אין הצעות ממתינות. הקואוץ' יציע צעדים מתוך נתונים אמיתיים.</p>
      )}
    </Panel>
  );
}
```

- [ ] **Step 3: Render it in the dashboard.** In `frontend/src/App.tsx`:
1. Add import: `import { CoachInbox } from "./features/coach-inbox";`
2. In the dashboard view's panel grid (where `LifePulse`, `MissionCenter`, etc. are rendered), add `<CoachInbox onChanged={refreshDashboard} />` — use the existing dashboard-refresh callback the other panels use (read App.tsx to find its name; if none, pass no prop). Place it as one more tile in the bento grid.

- [ ] **Step 4: Verify the build**

Run (from `frontend/`): `npm run build`
Expected: `tsc --noEmit` passes and `vite build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/atlas.ts frontend/src/features/coach-inbox.tsx frontend/src/App.tsx
git commit -m "feat(proposals): dashboard Coach inbox tile (accept/dismiss)"
```

---

## Self-Review

**Spec coverage:** proposals table (T2) · two types + payloads (T2 handlers) · create/list/accept/dismiss (T2/T3) · handler registry OCP (T2 `_HANDLERS`) · life_modules service extraction (T1) · generator, honest + idempotent (T3) · endpoints + wiring (T3) · frontend inbox (T4) · honest-core (accept-only mutation via service, audited) · error table: unknown type 422 (T2 create + accept), bad module 404 (T2 create via get_or_404; accept via service), non-pending 409 (T2) · tests per §13 (T1–T4). All covered.

**Placeholder scan:** No placeholders — every backend step carries complete code. Frontend T4 Steps 1/3 instruct reading the existing `request` helper / dashboard-refresh callback rather than inventing them — deliberate, since those are existing in-file conventions the implementer must match, not gaps.

**Type consistency:** `set_module_status(conn, id, status)` / `set_module_priority(conn, id, priority)` used identically in T1 (definition), T2 handlers. `create_proposal`/`accept_proposal`/`dismiss_proposal` signatures match between T2 (def), T2 tests, and T3 router. `ProposalOut`/`ProposalCreate` used in T2 schemas and T3 router. `_HANDLERS` keys match `create_proposal`'s `KNOWN_TYPES` gate. Frontend `Proposal`/`getProposals`/`acceptProposal`/`dismissProposal` consistent between T4 Step 1 (api) and Step 2 (component).
