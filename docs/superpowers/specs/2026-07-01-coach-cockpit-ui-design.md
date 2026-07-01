# Coach Cockpit UI — Design Spec (P3)

- **Date:** 2026-07-01
- **Status:** Approved (design); ready for planning
- **Roadmap phase:** P3 — surface the plan (`docs/superpowers/2026-07-01-smart-atlas-roadmap.md`)
- **Basis:** P1 proposal inbox, P2a goals/plans engine, P2b drift + re-plan + forward brief.

## 1. Summary

P1–P2b built the advisory brain (proposal inbox, goals/plans, real progress, drift,
re-plan, a forward brief). It is invisible in the cockpit except for generic proposals.
P3 makes the plan **visible with weight** by evolving the existing **Coach tile** into the
coach cockpit — with **no bento grid reflow** (the dashboard stays a no-scroll kiosk).

- The **Coach tile** shows pending proposals (today's behavior) **plus** the top active
  goal's plan state: title, overall %, a **drift chip** (on track / behind), and the
  **next step**.
- Its **expand modal** ("Coach") is the full surface: all pending proposals, a goals list,
  per-goal plan detail (steps with **real** progress + a drift block), a **create-goal**
  form, and **propose-plan** / **re-plan** actions.
- Plan proposals keep flowing through the same inbox: accepting an `activate_plan` proposal
  activates the plan (P2a handler) — no new accept path.

Frontend-only. Every backend endpoint P3 needs already exists and is tested.

## 2. Goals / Non-goals

**Goals**
- A planning API client in `api/atlas.ts` (types + 5 functions) over the existing endpoints.
- Evolve `coach-inbox.tsx` into the Coach tile (proposals + active-goal plan line + expand).
- A new Coach modal (`features/coach.tsx`): proposals, goals list, goal/plan detail with
  real per-step progress and drift, create-goal, propose-plan, re-plan.
- Minimal **vitest** harness for two pure honest-core helpers (next-step, drift→chip).
- Wire the modal into `App.tsx`; refresh dashboard on any change.

**Non-goals (later)**
- No goal **edit/delete** UI (backend has no `PATCH`/`DELETE` goal endpoints; fast-follow).
- No per-step manual activity linking, no Gantt/calendar of steps (drift is goal-level).
- No new backend endpoints or schema changes.
- No automatic re-plan cadence (re-plan is a manual button; scheduler hook is P4).

## 3. Current state (build on)

- **Backend (all present, tested):**
  - `POST /planning/goals` (201) → `GoalOut`; body `{title, module_id?, discipline_id?,
    definition_of_done?, target_date?, capacity_minutes_per_week?, created_by}`.
  - `GET /planning/goals?status=` → `GoalOut[]` (newest first).
  - `POST /planning/goals/{id}/propose-plan` → `ProposalOut` (422 if module-less / no AI key).
  - `GET /planning/goals/{id}/plan` → `{goal, plan, steps[], overall_percent, drift}`; 404 if
    no plan. Each step carries `progress = {done, target, ratio, status, last_activity_at}`;
    `drift = {expected_percent, actual_percent, drift, projected_completion, on_track}` or `null`.
  - `POST /planning/goals/{id}/replan` → a `ProposalOut`, or `{status:"on_track"}` /
    `{status:"replan_pending"}`, or 404 (no active plan).
- **Frontend:** `App.tsx` shell + fixed 3×3 `.bento` (areas: hero, pulse, missions, timeline,
  calendar, news) — **no-scroll kiosk**. `features/coach-inbox.tsx` renders pending proposals
  with Accept/Dismiss via `getProposals/acceptProposal/dismissProposal`. Primitives in
  `shared/ui.tsx`: `Panel` (with `onOpen` → expand affordance), `Modal`, `ProgressBar`,
  `Chip` (accents), plus `api/atlas.ts::Accent`. `request()` helper wraps fetch + throws on
  non-2xx (used by all API fns). No frontend test harness yet (`build` = `tsc --noEmit &&
  vite build`).

## 4. API client (`api/atlas.ts`)

Add types (response types are permissive — mirror existing `Proposal` style):

```ts
export type Goal = {
  id: string; title: string | null; module_id: string | null; discipline_id: string | null;
  definition_of_done: string | null; status: string | null; target_date: string | null;
  capacity_minutes_per_week: number | null; active_plan_id: string | null;
  created_by: string | null; created_at: string | null; updated_at: string | null;
  achieved_at: string | null;
};
export type PlanStepProgress = {
  done: number; target: number; ratio: number; status: string; last_activity_at: string | null;
};
export type PlanStep = {
  id: string; title: string; description: string | null; kind: string; sequence: number;
  progress: PlanStepProgress;
};
export type Drift = {
  expected_percent: number; actual_percent: number; drift: number;
  projected_completion: string | null; on_track: boolean;
};
export type Plan = {
  id: string; goal_id: string; version: number; status: string; rationale: string | null;
  activated_at: string | null;
};
export type GoalPlan = {
  goal: Goal; plan: Plan; steps: PlanStep[]; overall_percent: number; drift: Drift | null;
};
export type GoalCreatePayload = {
  title: string; module_id?: string; target_date?: string; capacity_minutes_per_week?: number;
  definition_of_done?: string;
};
// Re-plan can return a proposal OR a status object.
export type ReplanResult = Proposal | { status: "on_track" | "replan_pending" };
```

Functions (all via `request`):
- `getGoals(status?: string): Promise<Goal[]>` → `GET /planning/goals[?status=]`.
- `createGoal(payload: GoalCreatePayload): Promise<Goal>` → `POST /planning/goals`.
- `proposePlan(goalId: string): Promise<Proposal>` → `POST /planning/goals/{id}/propose-plan`.
- `getGoalPlan(goalId: string): Promise<GoalPlan>` → `GET /planning/goals/{id}/plan`.
- `replanGoal(goalId: string): Promise<ReplanResult>` → `POST /planning/goals/{id}/replan`.

## 5. Pure helpers (unit-tested — honest core)

In a new `features/coach-logic.ts` (pure, no React), so honest-core logic is testable:

```ts
// The next step = lowest-sequence step not yet done. null if none / all done.
export function pickNextStep(steps: PlanStep[]): PlanStep | null;

// Drift → chip. null when drift is null (no target date) → tile shows no chip.
export function driftChip(drift: Drift | null):
  { label: string; accent: Accent } | null;
//   on_track true  → { label: "on track", accent: "green" }
//   on_track false → { label: "behind",   accent: "amber" }
```

`driftChip` must never label a behind goal "on track" and must return `null` (not a guess)
when `drift` is `null`. `pickNextStep` must never invent a step when all are done (returns
`null`). These two invariants are the unit tests.

## 6. Coach tile (`features/coach-inbox.tsx`, evolved)

Keep the proposals block exactly as today. Add, below a divider, an **active-goal plan
line** when there is one:
- On mount, in addition to `getProposals("pending")`: `getGoals("active")`; if any, pick the
  newest (list is newest-first → index 0) and `getGoalPlan(goal.id)`.
- Render: `🎯 {goal.title} · {overall_percent}%`, a `ProgressBar`, the `driftChip` (if any),
  and `next: {pickNextStep(steps)?.title}` (omit the line if no next step).
- If no active goal, or the goal/plan calls fail, the tile is unchanged (proposals only) —
  the plan line simply does not render. Never block proposals on a planning failure.
- Add `onOpen` prop → the tile becomes an interactive `Panel` (expand affordance) that opens
  the Coach modal. Proposals' Accept/Dismiss buttons `stopPropagation` so they don't open it.

## 7. Coach modal (`features/coach.tsx`, new)

Opened from the tile. Scroll lives **inside** the modal body (`shared/ui.tsx::Modal`),
never the kiosk. Three regions:

1. **Proposals** — the full pending list (title + rationale + Accept/Dismiss), same calls.
2. **Goals** — `getGoals()` (all). Each row: title, status chip, target date; click selects.
   A **"+ New goal"** form: title (required), module `<select>` (from modules passed in),
   optional target date + weekly capacity → `createGoal` → refresh list.
3. **Goal detail** (selected goal) — `getGoalPlan(id)`:
   - Header: overall `ProgressBar` + `driftChip`; if `drift`, show `expected X% · actual Y%`
     and `projected: {date}` when `projected_completion` is set.
   - Steps: each step title, `kind`, a small `ProgressBar` (`ratio*100`), and
     `{done}/{target}` with a done/in-progress/pending chip from `progress.status`.
   - Actions: **Propose plan** (if the goal has no plan yet → 404) and **Re-plan** (if it
     has an active plan). Both POST, then refresh; results per §8.

The modal takes `modules: LifeModule[]` (already loaded in `App.tsx`) for the goal-create
`<select>` and an `onChanged` callback to refresh the dashboard + tile.

## 8. Result & error handling

| Condition | UI |
|---|---|
| `propose-plan`/`re-plan` → 422 (no AI key or module-less goal) | inline message with the server `detail` (e.g. "Plan decomposition unavailable (needs AI key)") — no fabricated plan |
| `re-plan` → `{status:"on_track"}` | inline note: "On track — no re-plan needed" |
| `re-plan` → `{status:"replan_pending"}` | inline note: "A re-plan proposal is already waiting in the inbox" |
| `re-plan`/`propose-plan` → a proposal | success note: "Proposal added to the inbox"; refresh proposals |
| `GET .../plan` → 404 (no plan yet) | detail shows "No plan yet" + **Propose plan** button |
| goals/plan endpoints unreachable | tile: proposals only; modal: "Couldn't load goals" |

`request` throws on non-2xx; distinguish 422 by parsing the error body's `detail` (extend the
error thrown by `request` to carry `status` + `detail`, or catch and show a generic planning
message if parsing is unavailable — see the plan for the exact mechanism).

## 9. Honest-core guarantees

- Every number shown (overall %, per-step done/target, drift, projected date) comes from the
  real endpoints, which derive from the activity ledger + real dates. Nothing is client-invented.
- No drift data (`drift === null`) → **no** chip, no projection — never a guessed "on track".
- No plan → "No plan yet", not a fake plan. No AI key → the 422 message, not a fabricated plan.
- Accepting a plan/re-plan proposal is the only way a plan activates (existing handler).

## 10. Aesthetic / constraints

- Pure web React (no React Native). Professional/enterprise; reuse the emerald palette and
  existing `Panel`/`Modal`/`Chip`/`ProgressBar` — no new visual language.
- Dashboard stays **no-scroll**: the tile shows a **capped preview** (proposals `slice(0,3)`
  + one goal line); the full detail lives in the modal. No 8th tile; no grid change.
- Match the existing RTL/Hebrew copy style already used in `coach-inbox.tsx`.

## 11. Testing

- **vitest** (new dev harness): `pickNextStep` (returns lowest-sequence non-done; `null` when
  all done / empty) and `driftChip` (`on_track` true→"on track"/green; false→"behind"/amber;
  `null`→`null`). Add `"test": "vitest run"` to `package.json`.
- **Integration gate:** `npm run typecheck` (tsc), `npm run lint` (eslint), `npm run build`
  (tsc + vite build) all clean — the whole feature type-checks and builds.
- No live-DB writes; vitest tests are pure functions with in-memory fixtures.

## 12. Success criteria

- The Coach tile shows the top active goal with real overall %, a correct drift chip, and the
  real next step — alongside proposals — with no dashboard scroll.
- The Coach modal creates a goal, proposes a plan (→ inbox), shows real per-step progress +
  drift, and re-plans (→ inbox) — accepting the proposal activates the plan.
- With no AI key, propose/re-plan show the honest 422 message; with no drift, no chip.
- vitest green; typecheck, lint, and build all clean.

## 13. How P4 builds on this

- P4 (Hermes) authors proposals/re-plans via MCP with `created_by="hermes"` — they surface in
  this same Coach tile/modal with no UI change. Goal edit/delete and per-step linking are the
  noted fast-follows.
