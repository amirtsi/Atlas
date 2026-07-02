# Goal Edit / Delete — Design Spec

- **Date:** 2026-07-02
- **Status:** Approved (design); ready for build
- **Basis:** P2a goals engine; the Command Center goals list (`coach.tsx`).

## 1. Summary

Let the owner **edit** a goal's fields and **delete** a goal from the Command Center's
goals list. Delete is a **soft-delete = abandon** (status → `abandoned`): the goal leaves
the active lists but its plans/steps/history are preserved, it's reversible, and it's
audited — mirroring how modules archive. Honest-core: nothing is hard-removed; the fact
plane stays intact and auditable.

## 2. Goals / Non-goals

**Goals**
- Backend: `PATCH /planning/goals/{id}` (edit fields) + `DELETE /planning/goals/{id}`
  (abandon). Service functions `update_goal` / `abandon_goal`, both audited.
- Frontend: per-goal **edit** (inline) and **delete** (with confirm) in the Command Center
  goals list; abandoned goals are hidden from that list.
- Tests: pytest for the two service paths + endpoints; frontend typecheck/lint/build.

**Non-goals**
- No hard delete / cascade (chosen: soft abandon). No "restore abandoned" UI yet (reversible
  at the data level; a future surface can list/restore abandoned goals).
- No change to plan/step lifecycle on abandon (plans are left as history).

## 3. Backend

`app/modules/planning/service.py`:
- `update_goal(conn, goal_id, payload: dict) -> dict`:
  - `get_or_404(conn, "goals", goal_id)`.
  - If `payload` includes a truthy `module_id`, `get_or_404(conn, "life_modules", module_id)`.
  - `apply_update(conn, "goals", goal_id, payload, allowed={"title","module_id",
    "discipline_id","definition_of_done","target_date","capacity_minutes_per_week"})` and set
    `updated_at`. (Use the existing `apply_update` helper + its conventions.)
  - `record_audit_event(entity_type="goal", entity_id, action="updated", ...)`. Return the goal.
- `abandon_goal(conn, goal_id) -> dict`:
  - `get_or_404`; `UPDATE goals SET status='abandoned', updated_at=? WHERE id=?`.
  - Audit `action="abandoned"`. Return the goal. (Plans/steps untouched.)

`app/modules/planning/router.py`:
- `PATCH /planning/goals/{goal_id}` → `GoalUpdate` → `update_goal` → `GoalOut`.
- `DELETE /planning/goals/{goal_id}` → `abandon_goal` → `GoalOut` (200; returns the abandoned
  goal so the client can reconcile).

`app/shared/schemas.py`:
- `GoalUpdate(AtlasModel)` — all optional: `title?`, `module_id?`, `discipline_id?`,
  `definition_of_done?`, `target_date?`, `capacity_minutes_per_week?`. `extra="forbid"`.

Error handling: unknown goal → 404; unknown `module_id` on edit → 404; empty PATCH body →
no-op returns the unchanged goal (200).

## 4. Frontend

`api/atlas.ts`:
- `type GoalUpdatePayload = { title?: string; module_id?: string; target_date?: string;
  capacity_minutes_per_week?: number; definition_of_done?: string }`.
- `updateGoal(id, payload): Promise<Goal>` → `PATCH /planning/goals/{id}`.
- `deleteGoal(id): Promise<Goal>` → `DELETE /planning/goals/{id}`.

`features/coach.tsx` (Command Center goals card):
- Display list filters out abandoned: `goals.filter(g => g.status !== "abandoned")`.
- Each goal row gains an **edit** (pencil) and **delete** (trash) icon-button (stopPropagation
  so they don't select the row).
- **Edit mode:** clicking pencil turns the row into an inline form (title input + target-date
  + module select + Save/Cancel). Save → `updateGoal` → refresh list + re-fetch plan.
- **Delete:** clicking trash shows an inline confirm ("למחוק? [מחק][ביטול]"); confirm →
  `deleteGoal` → refresh; if the deleted goal was selected, clear the selection.
- Reuse existing form/chip/icon-button styles; RTL Hebrew copy; destructive confirm uses the
  danger styling already in the app.

## 5. Honest-core & a11y

- Delete is reversible (abandon) and audited; no fact-plane data is destroyed.
- Destructive action requires an explicit confirm; buttons have aria-labels; edit inputs have
  labels/placeholders; disabled while busy.

## 6. Testing

- **pytest:** `update_goal` changes fields + audits; unknown `module_id` → 404; `abandon_goal`
  sets `abandoned` + audits; an abandoned goal is excluded from `GET /planning/goals?status=
  active`; PATCH/DELETE endpoints return the updated goal; 404 on unknown id.
- **Frontend:** `npm run typecheck`, `lint`, `build` clean; live check of edit + delete +
  hidden-abandoned in the Command Center.

## 7. Success criteria

- Editing a goal in the Command Center updates it (persisted, audited); deleting abandons it
  (gone from the list, plan history intact, reversible in data).
- ruff + pytest green; frontend typecheck/lint/build clean.
