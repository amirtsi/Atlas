# Modules Screen — Edit + Hard Delete

**Date:** 2026-07-08
**Status:** Approved by owner (design conversation; owner explicitly chose TRUE hard delete over archive after the tradeoff was explained)

## Purpose

The Modules screen (ModulesView) lets the owner change only status and priority. The
owner wants full edit (name, discipline, priority, description) and a delete option
per module, on that screen.

## Decisions

- **Delete = hard delete** (owner's explicit choice). The module row is permanently
  removed. Real history is never destroyed: activities are kept and unlinked.
- **Edit = reuse `ModuleEditCard`** — the exact form the Mission Center modal already
  uses. No new form.
- Scope: ModulesView only. Mission Center modal keeps its existing edit/archive flow.
- The reversible path (archive via the status dropdown / Mission Center) stays as-is.

## Backend — `DELETE /api/v1/modules/{module_id}`

New endpoint in `backend/app/modules/life_modules/router.py`, next to
archive/pause/resume. `PRAGMA foreign_keys = ON` is enforced (database.py:300), so
children must be handled before the module row, all in one transaction:

Deleted with the module (meaningless without it):
- `project_items`, `learning_units`, `hobby_ideas`, `metrics` rows of the module
- `activity_templates` with this `module_id` (module-bound quick-log templates)

Kept but unlinked (real history preserved):
- `activities.module_id` → NULL (sessions stay in journal/timeline/Life Pulse)
- `goals.module_id` → NULL (goal survives standalone)

Response: the deleted module dict. Audit event `entity_type="life_module"`,
`action="deleted"`, `changes` carrying counts per table (deleted + unlinked).
404 unknown module. No type restriction — any module type can be deleted.

### Tests (`tests/test_life_modules_delete.py`, temp DB via conftest)

- Full cascade: module with project items + activities + a goal + a template →
  delete → module gone, items/templates gone, activities present with
  `module_id IS NULL`, goal present with `module_id IS NULL`, audit event exists.
- Hobby module with ideas → ideas gone.
- 404 on unknown id; second delete → 404.

## Frontend

- `frontend/src/api/atlas.ts`: `deleteModule(moduleId): Promise<LifeModule>` →
  `DELETE /modules/{moduleId}`.
- `frontend/src/App.tsx`: `handleDeleteModule(id)` → `deleteModule(id)` then the same
  refresh path `onUpdateModule` uses; passed to `ModulesView` as `onDeleteModule`.
- `frontend/src/features/modules.tsx` (ModulesView card):
  - **עריכה** button: sets `editId`; the card renders `ModuleEditCard` (existing
    component; `onSave` → `onUpdateModule`, `onCancel` clears) — mirrors
    MissionCenterModal's pattern.
  - **מחיקה** button (danger style): first click arms an inline confirm in the card —
    text "למחוק לצמיתות? הפריטים יימחקו, הפעילויות יישארו ללא שיוך" with
    "מחק" (confirm) and "ביטול" buttons; confirm calls `onDeleteModule`. Arming state
    (`confirmDeleteId`) resets when clicking ביטול, עריכה, or another card's delete.
  - Buttons disabled while a request is in flight (existing `isSaving` prop pattern).

## Error handling

- Delete endpoint is a single transaction — partial cascades cannot persist.
- UI: failed delete leaves the card armed; the error surfaces per the existing
  request-error pattern in App (no new error UI).

## Out of scope

- Delete in Mission Center modal; restore/undo; bulk delete.
