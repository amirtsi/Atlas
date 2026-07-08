# Modules Screen Edit + Hard Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Modules screen per-module edit (reusing `ModuleEditCard`) and a hard-delete with inline confirm, backed by a cascade-safe `DELETE /api/v1/modules/{id}` endpoint.

**Architecture:** One new backend endpoint in the existing life_modules router (single transaction: delete module-owned rows, NULL-out `activities`/`goals` links, delete module, audit). Frontend reuses the existing `ModuleEditCard` and App handler patterns; only ModulesView cards change.

**Tech Stack:** FastAPI + SQLite (stdlib `sqlite3`, `PRAGMA foreign_keys = ON`), pytest; React 19 + TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-07-08-modules-edit-delete-design.md`

## Global Constraints

- Backend commands from `backend/`: `.venv/bin/python -m pytest`, `.venv/bin/ruff check app tests` — both must pass at every commit.
- Frontend commands from `frontend/`: `npm test`, `npm run build` — both must pass before the final commit.
- Tests never touch the dev DB (conftest autouse temp-DB fixture; do not change it).
- Hard delete NEVER deletes `activities` or `goals` rows — only NULLs their `module_id`.
- Hebrew copy verbatim: buttons **עריכה**, **מחיקה**, confirm text **"למחוק לצמיתות? הפריטים יימחקו, הפעילויות יישארו ללא שיוך"**, confirm button **מחק**, cancel **ביטול**.
- Known full-suite artifacts: 2 failures if `backend/.env` holds a real ATLAS_ANTHROPIC_API_KEY (`test_coach_service.py::test_no_api_key_*`, `test_plan_decomposition.py::test_propose_plan_without_llm_key_is_422`) — pre-existing, ignore; rare `test_obsidian_export` prune flake — re-run to confirm.
- Work on branch `feat/modules-edit-delete` (already checked out).

---

### Task 1: Backend — DELETE /modules/{module_id} with cascade + unlink

**Files:**
- Create: `backend/tests/test_life_modules_delete.py`
- Modify: `backend/app/modules/life_modules/router.py` (new endpoint after `resume_module`, ~line 182)

**Interfaces:**
- Consumes: `db_connection`, `get_or_404`, `record_audit_event`, `utc_now_iso`, `new_id` (all already imported or available in the router/file ecosystem — check the router's existing imports and add only what's missing).
- Produces: `DELETE /api/v1/modules/{module_id}` → returns the deleted module dict; 404 unknown id. Task 2's `deleteModule` API client calls this.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_life_modules_delete.py`:

```python
"""Hard-delete of a life module: owned rows cascade, history unlinks. Temp DB per test."""

from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.core.time import utc_now_iso
from app.main import app


def _discipline_id(client: TestClient) -> str:
    return client.get("/api/v1/disciplines").json()[0]["id"]


def _create_module(client: TestClient, *, type_: str = "project", name: str = "Doomed") -> dict:
    response = client.post(
        "/api/v1/modules",
        json={
            "discipline_id": _discipline_id(client),
            "type": type_,
            "name": name,
            "slug": name.lower(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _count(table: str, module_id: str) -> int:
    with db_connection() as conn:
        return conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE module_id = ?", (module_id,)
        ).fetchone()[0]


def test_delete_cascades_owned_rows_and_unlinks_history():
    with TestClient(app) as client:
        module = _create_module(client)
        module_id = module["id"]

        item = client.post(
            f"/api/v1/project/{module_id}/items", json={"item_type": "task", "title": "T1"}
        )
        assert item.status_code == 201

        logged = client.post(
            "/api/v1/activities/quick-log",
            json={"module_id": module_id, "title": "Work", "activity_type": "project"},
        )
        assert logged.status_code in (200, 201)
        activity_id = logged.json()["id"]

        now = utc_now_iso()
        goal_id = new_id()
        template_id = new_id()
        metric_id = new_id()
        with db_connection() as conn:
            conn.execute(
                "INSERT INTO goals (id, module_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (goal_id, module_id, "Ship it", now, now),
            )
            conn.execute(
                """
                INSERT INTO activity_templates (id, module_id, title, activity_type, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (template_id, module_id, "Quick work", "project", now, now),
            )
            conn.execute(
                """
                INSERT INTO metrics (id, module_id, metric_key, value_number, recorded_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (metric_id, module_id, "pain", 3, now, now),
            )

        response = client.delete(f"/api/v1/modules/{module_id}")
        assert response.status_code == 200, response.text
        assert response.json()["id"] == module_id

        assert client.get(f"/api/v1/modules/{module_id}").status_code == 404
        assert _count("project_items", module_id) == 0
        assert _count("activity_templates", module_id) == 0
        assert _count("metrics", module_id) == 0

        with db_connection() as conn:
            activity = conn.execute(
                "SELECT module_id FROM activities WHERE id = ?", (activity_id,)
            ).fetchone()
            assert activity is not None and activity["module_id"] is None
            goal = conn.execute("SELECT module_id FROM goals WHERE id = ?", (goal_id,)).fetchone()
            assert goal is not None and goal["module_id"] is None
            audit = conn.execute(
                "SELECT action FROM audit_events WHERE entity_type = 'life_module' AND entity_id = ? ORDER BY rowid DESC",
                (module_id,),
            ).fetchone()
            assert audit is not None and audit["action"] == "deleted"


def test_delete_hobby_cascades_ideas():
    with TestClient(app) as client:
        module = _create_module(client, type_="hobby", name="Whittling")
        module_id = module["id"]
        created = client.post(f"/api/v1/hobby/{module_id}/ideas", json={"title": "Spoon"})
        assert created.status_code == 201

        assert client.delete(f"/api/v1/modules/{module_id}").status_code == 200
        assert _count("hobby_ideas", module_id) == 0


def test_delete_unknown_module_404_and_not_repeatable():
    with TestClient(app) as client:
        assert client.delete("/api/v1/modules/nope").status_code == 404
        module = _create_module(client, name="Once")
        assert client.delete(f"/api/v1/modules/{module['id']}").status_code == 200
        assert client.delete(f"/api/v1/modules/{module['id']}").status_code == 404
```

(Verified against `backend/app/core/database.py:59-73`: the metrics INSERT covers every NOT NULL column — `metric_key`, `recorded_at`, `created_at` — exactly as named.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_life_modules_delete.py -v`
Expected: FAIL — DELETE returns 405 (method not allowed; no DELETE route exists yet).

- [ ] **Step 3: Implement the endpoint**

In `backend/app/modules/life_modules/router.py`, after `resume_module`:

```python
@router.delete("/{module_id}", response_model=LifeModuleOut)
def delete_module(module_id: str) -> dict:
    """Hard delete (owner's explicit choice): the module and its OWNED rows go;
    real history (activities, goals) is kept and unlinked."""
    with db_connection() as conn:
        module = get_or_404(conn, "life_modules", module_id)

        owned_tables = ("project_items", "learning_units", "hobby_ideas", "metrics", "activity_templates")
        deleted_counts = {}
        for table in owned_tables:
            cursor = conn.execute(f"DELETE FROM {table} WHERE module_id = ?", (module_id,))
            deleted_counts[table] = cursor.rowcount

        unlinked_activities = conn.execute(
            "UPDATE activities SET module_id = NULL WHERE module_id = ?", (module_id,)
        ).rowcount
        unlinked_goals = conn.execute(
            "UPDATE goals SET module_id = NULL WHERE module_id = ?", (module_id,)
        ).rowcount

        conn.execute("DELETE FROM life_modules WHERE id = ?", (module_id,))
        record_audit_event(
            conn,
            entity_type="life_module",
            entity_id=module_id,
            action="deleted",
            summary=f"Deleted module: {module['name']}",
            changes={
                "type": module["type"],
                **{f"deleted_{table}": count for table, count in deleted_counts.items() if count},
                "unlinked_activities": unlinked_activities,
                "unlinked_goals": unlinked_goals,
            },
        )
        return module
```

Check the router's imports: `record_audit_event` and `get_or_404` are already imported (used by `create_module`); add nothing unless missing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_life_modules_delete.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Full backend suite + lint + commit**

Run: `cd backend && .venv/bin/python -m pytest -q && .venv/bin/ruff check app tests`
Expected: all pass except the 2 known env-artifact failures; ruff clean.

```bash
git add backend/app/modules/life_modules/router.py backend/tests/test_life_modules_delete.py
git commit -m "feat(modules): hard-delete endpoint — owned rows cascade, activities/goals unlink"
```

---

### Task 2: Frontend API client + App wiring

**Files:**
- Modify: `frontend/src/api/atlas.ts` (after `updateModule`, ~line 430)
- Modify: `frontend/src/App.tsx` (handler after `handleModuleStatus` ~line 213; prop at the `ModulesView` mount ~line 360)

**Interfaces:**
- Consumes: Task 1's endpoint; existing `request<T>`, `LifeModule`, `refreshModulesAndDashboard`, `setIsSavingModule`, `setError`.
- Produces: `deleteModule(moduleId: string): Promise<LifeModule>` in atlas.ts; `onDeleteModule: (moduleId: string) => void` prop reaching `ModulesView` (Task 3 consumes it).

- [ ] **Step 1: Add the API function**

In `frontend/src/api/atlas.ts`, directly after the `updateModule` function:

```ts
export function deleteModule(moduleId: string): Promise<LifeModule> {
  return request<LifeModule>(`/modules/${moduleId}`, { method: "DELETE" });
}
```

- [ ] **Step 2: Add the App handler and prop**

In `frontend/src/App.tsx`:

1. Add `deleteModule` to the existing `./api/atlas` import list (it already imports `updateModule`, `archiveModule`, etc.).
2. After `handleModuleStatus`:

```tsx
  async function handleDeleteModule(moduleId: string) {
    setIsSavingModule(true);
    setError(null);
    try {
      await deleteModule(moduleId);
      await refreshModulesAndDashboard();
    } catch {
      setError("לא הצלחתי למחוק את ה־Module.");
    } finally {
      setIsSavingModule(false);
    }
  }
```

3. At the `ModulesView` mount, add the prop:

```tsx
            onDeleteModule={handleDeleteModule}
```

- [ ] **Step 3: Verify it compiles (ModulesView prop not yet declared — expect ONE specific error)**

Run: `cd frontend && npm run build 2>&1 | head -5`
Expected: TypeScript error on the `ModulesView` mount — `onDeleteModule` is not a known prop. That confirms the wiring reaches the component boundary; Task 3 resolves it. Do NOT commit yet — Task 3 completes the compiling unit and commits both together.

---

### Task 3: ModulesView cards — עריכה + מחיקה, styles, verification, PR

**Files:**
- Modify: `frontend/src/features/modules.tsx` (ModulesView props ~line 553; state ~line 570; card JSX ~line 806-850)
- Modify: `frontend/src/styles.css` (after the `.module-save` rules — locate with `grep -n "module-save" frontend/src/styles.css`)

**Interfaces:**
- Consumes: `onDeleteModule` prop from Task 2; existing `ModuleEditCard` (`{module, disciplines, isSaving, onSave: (payload: ModuleUpdatePayload) => void, onCancel: () => void}`), existing `onUpdateModule`, `isSaving`.
- Produces: the finished feature; PR.

- [ ] **Step 1: Extend ModulesView props and state**

In `frontend/src/features/modules.tsx`, ModulesView's signature gains the prop (both the destructuring and the type):

```tsx
export function ModulesView({
  modules,
  disciplines,
  isSaving,
  onCreateModule,
  onUpdateModule,
  onDeleteModule,
  onChanged
}: {
  modules: LifeModule[];
  disciplines: Discipline[];
  isSaving: boolean;
  onCreateModule: (payload: ModulePayload) => void;
  onUpdateModule: (moduleId: string, payload: ModuleUpdatePayload) => void;
  onDeleteModule: (moduleId: string) => void;
  onChanged: () => void;
}) {
```

Next to the existing `drafts` state, add:

```tsx
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
```

- [ ] **Step 2: Render ModuleEditCard when editing; add the buttons**

In the `modulesByPriority.map(...)` card renderer, immediately after `const accent = ...`, add the edit branch:

```tsx
            if (editId === module.id) {
              return (
                <ModuleEditCard
                  key={module.id}
                  module={module}
                  disciplines={disciplines}
                  isSaving={isSaving}
                  onSave={(payload) => {
                    onUpdateModule(module.id, payload);
                    setEditId(null);
                  }}
                  onCancel={() => setEditId(null)}
                />
              );
            }
```

(`ModuleEditCard` is defined later in this same file — no import needed.)

In the card's `module-row-controls` div, after the Behavior button, add:

```tsx
                  <button
                    className="module-save"
                    type="button"
                    disabled={isSaving}
                    onClick={() => {
                      setConfirmDeleteId(null);
                      setEditId(module.id);
                    }}
                  >
                    <Pencil size={15} />
                    עריכה
                  </button>
                  {confirmDeleteId === module.id ? (
                    <span className="module-delete-confirm">
                      <span dir="auto">למחוק לצמיתות? הפריטים יימחקו, הפעילויות יישארו ללא שיוך</span>
                      <button
                        className="module-save module-delete-arm"
                        type="button"
                        disabled={isSaving}
                        onClick={() => {
                          onDeleteModule(module.id);
                          setConfirmDeleteId(null);
                        }}
                      >
                        מחק
                      </button>
                      <button className="module-save" type="button" onClick={() => setConfirmDeleteId(null)}>
                        ביטול
                      </button>
                    </span>
                  ) : (
                    <button
                      className="module-save module-delete"
                      type="button"
                      disabled={isSaving}
                      onClick={() => {
                        setEditId(null);
                        setConfirmDeleteId(module.id);
                      }}
                    >
                      <Trash2 size={15} />
                      מחיקה
                    </button>
                  )}
```

Add `Pencil` to the existing `lucide-react` import in this file (`Trash2` is already imported).

- [ ] **Step 3: Add the danger styles**

In `frontend/src/styles.css`, after the existing `.module-save` rule block (find it with `grep -n "\.module-save" frontend/src/styles.css`):

```css
.module-save.module-delete:hover,
.module-save.module-delete-arm {
  border-color: var(--red);
  color: var(--red);
}

.module-save.module-delete-arm {
  background: var(--red-soft);
}

.module-delete-confirm {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--red);
  max-width: 420px;
}
```

- [ ] **Step 4: Verify tests + build**

Run: `cd frontend && npm test && npm run build`
Expected: all vitest suites pass; build clean (the Task 2 prop error is resolved by Step 1).

- [ ] **Step 5: Commit + push + PR**

```bash
git add frontend/src/api/atlas.ts frontend/src/App.tsx frontend/src/features/modules.tsx frontend/src/styles.css
git commit -m "feat(modules): edit + hard-delete on the Modules screen

עריכה reuses ModuleEditCard; מחיקה is a two-step inline confirm calling the
new DELETE endpoint. Activities and goals survive unlinked."
git push -u origin feat/modules-edit-delete
gh pr create --base main --head feat/modules-edit-delete \
  --title "feat: Modules screen — edit + hard delete" \
  --body "## Summary
- \`DELETE /api/v1/modules/{id}\`: hard delete in one transaction — module-owned rows cascade (project items, learning units, hobby ideas, metrics, module templates); activities and goals are KEPT and unlinked (module_id → NULL)
- Modules screen cards gain **עריכה** (reuses the Mission Center's ModuleEditCard) and **מחיקה** with an inline two-step confirm
- Owner explicitly chose hard delete over archive; the reversible archive path via status stays available

## Test plan
- [x] 3 new pytest cases: full cascade + unlink, hobby ideas cascade, 404/not-repeatable
- [x] Full backend suite + ruff clean
- [x] vitest + tsc build clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Report the PR URL; the owner merges it (standing preference: changes go through PRs the owner can see).
