# Log-Time Step Linking — Design Spec

- **Date:** 2026-07-02
- **Status:** Approved (design); ready for build
- **Basis:** per-step activity linking (`linkActivityToStep`, `plan_step_links`); the QuickLog sheet.

## 1. Summary

While quick-logging a **custom** activity, let the owner optionally attach it to a plan step,
so the activity is credited to that step the moment it's logged. Frontend-only: reuse the
existing `linkActivityToStep` endpoint — quick-log the activity, then link it. Honest-core
unchanged (a link only credits a real activity that was just created).

## 2. Goals / Non-goals

**Goals**
- The QuickLog **custom** form gains an optional "attach to plan step" select, listing the
  active goal's not-done steps.
- On submit: create the activity (existing `quickLog`), then—if a step was chosen—link it
  (`linkActivityToStep`), then refresh.
- No backend change; no new tests beyond the existing link coverage (frontend gates).

**Non-goals**
- No step picker on the one-tap **template** shortcuts (kept instant) or the "new template"
  form. No classifier/auto-suggest. No server-side atomic variant (client links after log).
- No multi-goal step list — only the top active goal's steps (short, relevant).

## 3. Frontend

`features/quick-log.tsx`:
- On open (`isOpen` true), fetch the top active goal's plan and keep its **not-done** steps:
  `getGoals("active")` → first → `getGoalPlan(id)` → `steps.filter(s => s.progress.status !==
  "done")`. Best-effort (empty on any failure); state `planSteps`, `customStepId`.
- In the **custom** form only, render an optional `<select>` "קשר לצעד בתוכנית (אופציונלי)"
  when `planSteps.length > 0`, defaulting to "ללא" (none).
- Change `onCustomLog` to `(payload: QuickLogPayload, stepId?: string) => void`; submit passes
  `customStepId || undefined`. Reset `customStepId` after submit.

`App.tsx`:
- `handleQuickLog(payload, stepId?)`: `const activity = await quickLog(payload)`; if `stepId`,
  `await linkActivityToStep(stepId, activity.id)`; then `refreshDashboard()`. A link failure
  shows the existing error but does not lose the logged activity (it's already saved).
- Wire `onCustomLog={handleQuickLog}` (already), and `onTemplateLog={(id) =>
  handleQuickLog({ template_id: id })}` (no step — unchanged).

## 4. Honest-core & a11y

- The activity is real (just logged); the link only credits it — same guarantees as manual
  linking, and the link is audited server-side.
- The select has a visible label; optional (defaults to none); disabled while logging.

## 5. Testing

- Frontend `typecheck` / `lint` / `build` clean (reuses the tested link endpoint).
- Live: with an active plan, quick-log a custom activity attached to a step → that step's
  progress rises in the Command Center; logging without a step behaves exactly as before.

## 6. Success criteria

- A custom quick-log can attach to a step and immediately credit it; templates stay one-tap;
  no backend change; frontend gates green.
