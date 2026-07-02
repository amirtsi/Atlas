# Per-Step Activity Linking — Design Spec

- **Date:** 2026-07-02
- **Status:** Approved (design); ready for build
- **Basis:** P2a `plan_step_links` table + `evaluate_step`; the Command Center plan detail.

## 1. Summary

Let the owner explicitly **link a real logged activity to a plan step** (and unlink) from the
Command Center plan detail. A linked activity is **credited** to the step — counted alongside
the auto rule-matched activities (unioned, deduped by activity id) — so you can attribute an
activity the auto-rule missed. Manual linking only (no log-time/classifier changes this
increment). Honest-core: still 100% derived from real activities; nothing invented.

## 2. Goals / Non-goals

**Goals**
- Backend: link / unlink endpoints over the existing `plan_step_links`; `evaluate_step`
  counts `rule-matched ∪ explicitly-linked`; `get_goal_plan` exposes each step's linked ids.
- Frontend: in the plan detail, each step shows linked activities as removable chips + a
  compact "link recent activity" picker.
- Tests: pytest for link/unlink + the union counting; frontend typecheck/lint/build.

**Non-goals**
- No log-time linking / classifier changes (a follow-up). No new activity fields.
- No auto-suggest of which activity to link (just a recent-activities picker).

## 3. Backend

`app/modules/planning/service.py`:
- **`evaluate_step` union:** for `duration`/`count` rules, count activities where the existing
  rule conditions match **OR** the activity is explicitly linked to this step
  (`a.id IN (SELECT activity_id FROM plan_step_links WHERE step_id = ?)`). Explicit links
  bypass the `since` window (explicit intent overrides time-scoping). `manual_link` stays
  as-is (counts links). Dedup is automatic (row counted once); `last_activity_at` = MAX over
  the union.
- **`link_activity_to_step(conn, step_id, activity_id) -> dict`:** `get_or_404` step +
  activity; `INSERT OR IGNORE INTO plan_step_links(step_id, activity_id)`; audit
  (`entity_type="plan_step", action="linked"`); return `{"step_id", "linked_activity_ids"}`.
- **`unlink_activity_from_step(conn, step_id, activity_id) -> dict`:** `get_or_404` step;
  `DELETE FROM plan_step_links WHERE step_id=? AND activity_id=?`; audit
  (`action="unlinked"`); return `{"step_id", "linked_activity_ids"}`.
- **`get_goal_plan`:** add `linked_activity_ids: list[str]` to each step (one query:
  `SELECT step_id, activity_id FROM plan_step_links WHERE step_id IN (…plan step ids…)`,
  grouped in Python).

`app/modules/planning/router.py`:
- `POST /planning/steps/{step_id}/links` → `StepLinkCreate{activity_id}` → link → 200 dict.
- `DELETE /planning/steps/{step_id}/links/{activity_id}` → unlink → 200 dict.

`app/shared/schemas.py`: `StepLinkCreate(AtlasModel){ activity_id: str }`.

Errors: unknown step or activity → 404; linking an already-linked pair → idempotent
(`INSERT OR IGNORE`, returns current links).

## 4. Frontend

`api/atlas.ts`:
- Extend `PlanStep` with `linked_activity_ids: string[]`.
- `linkActivityToStep(stepId, activityId): Promise<{step_id: string; linked_activity_ids: string[]}>`
  → `POST /planning/steps/{stepId}/links`.
- `unlinkActivityFromStep(stepId, activityId): Promise<...>` → `DELETE .../links/{activityId}`.

`features/coach.tsx` (plan detail step rows):
- `CoachModal` gains an `activities: JournalActivity[]` prop (App already holds this state) to
  render chip titles + the picker.
- Each step: render linked activities as chips (activity title, `×` to unlink). A "+ קשר
  פעילות" toggle reveals a compact list of the most recent activities not already linked to
  that step; clicking one links it. All calls → refresh the plan (`getGoalPlan`) so progress
  updates live.
- State: `linkingStepId` (which step's picker is open). Busy-guarded; RTL Hebrew copy.

`App.tsx`: pass `activities={activities}` to `<CoachModal>`.

## 5. Honest-core & a11y

- Progress stays derived from real activities (rule ∪ explicit links); links only credit
  activities that already exist. Every link/unlink is audited.
- Chips have `×` unlink buttons with aria-labels; picker entries are buttons; busy-disabled.

## 6. Testing

- **pytest:** linking an activity to a `duration` step increases its `done` even when the rule
  wouldn't match it (union); unlink reverts it; `get_goal_plan` step includes
  `linked_activity_ids`; link/unlink endpoints return the updated list; unknown step/activity
  → 404; double-link is idempotent.
- **Frontend:** typecheck/lint/build clean; live check — link a recent activity to a step,
  see the step's progress update and the chip appear; unlink reverts.

## 7. Success criteria

- From the Command Center, link a real activity to a step and watch that step's progress rise;
  unlink and watch it fall — all from real data, audited.
- ruff + pytest green; frontend typecheck/lint/build clean.
