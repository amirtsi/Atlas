# Adaptive Planning — Design Spec (P2b)

- **Date:** 2026-07-01
- **Status:** Approved (design); ready for planning
- **Roadmap phase:** P2b — the adaptive layer on top of P2a's goals/plans engine.
- **Basis:** `docs/planning-engine.md`; P2a spec `docs/superpowers/specs/2026-07-01-goals-plans-engine-design.md`.

## 1. Summary

P2a lets you declare a goal, get an LLM-proposed plan, and see real progress. P2b makes
the plan **adaptive**: it measures **drift** (are you on pace for the target date?),
proposes a **re-plan** (a new plan version) when you fall behind — delivered through the
same P1 inbox — and turns the daily brief **forward** (next step + drift). It also fixes
the three backlog items from the P2a review.

Reuses everything: `evaluate_step`, `decompose_goal`, the `activate_plan` proposal +
handler (a re-plan is just a new plan version whose activation supersedes the old one),
and the existing daily-brief composer.

## 2. Goals / Non-goals

**Goals**
- **Drift & projection:** `get_goal_plan` gains a `drift` block (expected vs actual pace,
  projected completion, on_track) when the goal has a `target_date`.
- **Re-plan:** `generate_replan_proposal(goal_id)` — when behind beyond a threshold and no
  open plan proposal exists, LLM re-decomposes with drift context into a **new plan
  version** (`based_on_plan_id` = current active), delivered as an `activate_plan` proposal.
  Accepting supersedes the old active plan (existing handler already does this).
- **Forward brief:** the daily brief includes, for the top active goal, the **next step**
  and a **drift note**.
- **Backlog fixes:** (1) require a module for `propose-plan`; (2) time-scope `evaluate_step`
  to the plan's `activated_at`; (3) guarantee a non-empty `match`.

**Non-goals**
- No per-step calendar scheduling / Gantt (drift is goal-level from `target_date`).
- No automatic re-plan cadence beyond a manual `/replan` trigger (a scheduler hook is later).
- No UI (P3 renders drift/next-step; P2b surfaces via the API + the existing inbox/brief).

## 3. Current state (build on)

- P2a: `goals` (`target_date`, `capacity_minutes_per_week`, `active_plan_id`, `created_at`),
  `plans` (`version`, `status`, `based_on_plan_id`, `activated_at`), `plan_steps`
  (`completion_rule`, `sequence`, `depends_on`), `plan_step_links`.
- `planning/service.py`: `create_goal`, `evaluate_step(conn, step)`, `decompose_goal(goal)`,
  `_completion_rule`, `propose_plan_for_goal`, `_activate_plan_handler` (supersedes active
  plan for the goal), `get_goal_plan`.
- P1 proposal inbox + `activate_plan` handler (self-registered).
- Daily brief: `communication/router.py::_compose_daily_brief(dashboard)` + the scheduler.

## 4. Backlog fixes (do first)

1. **Require module for `propose-plan`:** in `propose_plan_for_goal`, if `goal["module_id"]`
   is falsy → `HTTPException(422, "goal needs a module before planning")`. (Progress is
   module-scoped; a module-less goal can never progress — fail loud.)
2. **Time-scope progress:** `evaluate_step(conn, step, since=None)` — when `since` is set,
   add `AND a.occurred_at >= ?`. `get_goal_plan` passes the active plan's `activated_at` as
   `since` so progress counts only activity **after** the plan was activated. (manual_link
   unaffected.)
3. **Non-empty match:** `_completion_rule` already derives `match` from the title; add a
   final guard so an empty/whitespace match falls back to the lowercased title, and if that
   is also empty, drop the `match` key (module+type scope) rather than store `""`.

## 5. Drift & projection

`compute_drift(goal, plan, actual_percent) -> dict | None`:
- Requires `goal.target_date` and `plan.activated_at` (else return `None` — can't project).
- `elapsed = now - activated_at`; `horizon = target_date - activated_at` (guard ≤ 0).
- `expected_percent = clamp(elapsed / horizon, 0, 1)`.
- `drift = round(actual_percent - expected_percent, 3)` (negative = behind).
- `projected_completion`: if `actual_percent > 0`, `activated_at + elapsed / actual_percent`,
  else `None`.
- `on_track = drift >= -0.15`.
- Returns `{expected_percent, actual_percent, drift, projected_completion, on_track}`.

`get_goal_plan` adds `"drift": compute_drift(...)` (using its computed `overall_percent`/100
as `actual_percent`). Pure derivation — no writes.

## 6. Re-plan

`generate_replan_proposal(conn, goal_id) -> dict | None`:
- Load goal + active plan + `get_goal_plan` (for drift). If no active plan → 404.
- If `drift` is `None` or `on_track` is `True` → return `None` (nothing proposed).
- If an open (`pending`) `activate_plan` proposal already exists for this goal → return
  `None` (no duplicate; one open re-plan at a time).
- Else call `decompose_goal(goal, context=<drift summary>)` → new steps; create a plan with
  `version = active.version + 1`, `based_on_plan_id = active.id`, `status='proposed'`; create
  an `activate_plan` proposal (`payload={"plan_id": new.id}`, rationale citing the drift).
- `decompose_goal(goal, context=None)`: extend P2a's function with an optional `context`
  string appended to the user message ("The learner is behind: … Produce an adjusted plan.").
  No-key/error → the caller raises 422 (same honest fallback).

Accepting the proposal runs the existing `_activate_plan_handler`, which supersedes the old
active plan and activates the new version — so re-planning is versioned and auditable.

Endpoint: `POST /planning/goals/{id}/replan` → the created proposal, or `{"status":
"on_track"}` / `{"status": "replan_pending"}` when nothing is proposed.

## 7. Forward brief

Extend `_compose_daily_brief`: after the existing real-signal lines, if there is an active
goal (most recently activated), append a **Plan** section:
- the **next step** — the first `pending`/`in_progress` step of the active plan whose
  `depends_on` are all `done` (fallback: lowest `sequence` not `done`);
- a **drift note** — "on track" or "behind — consider re-planning" from `compute_drift`.
Built from real data via `get_goal_plan`; no fabrication; if no active goal, the brief is
unchanged. A helper `active_goal_brief_line(conn) -> str | None` keeps this testable.

## 8. Honest-core guarantees

- Drift and next-step come only from real progress (`evaluate_step`) + real dates; `None`
  when data is insufficient — never guessed.
- Re-plans are **proposals** (advisory); nothing activates without acceptance; a re-plan is
  a new plan version (old superseded, kept in history) — auditable.
- Re-plan decomposition obeys the same server-constructed-rule + 422-on-no-key rules as P2a.

## 9. Error handling

| Condition | Behavior |
|---|---|
| `propose-plan` on a module-less goal | 422 |
| `replan` with no active plan | 404 |
| `replan` when on track / drift unknown | `{"status": "on_track"}` (no proposal) |
| `replan` with an open plan proposal already | `{"status": "replan_pending"}` |
| `replan`/decompose with no AI key | 422 (no fabricated plan) |
| goal has no `target_date` | `drift` is `null`; brief omits the drift note |

## 10. Testing (TestClient + temp DB; LLM monkeypatched)

- **Backlog:** `propose-plan` on a module-less goal → 422; `evaluate_step(since=...)` excludes
  pre-`since` activity; `_completion_rule` never yields `match=""`.
- **Drift:** with a `target_date` in the past-relative window + partial progress, `drift` is
  negative and `on_track` False; with fresh activation, `on_track` True; no `target_date` →
  `drift` None.
- **Re-plan:** behind + no open proposal → creates a v2 plan (based_on = v1) + an
  `activate_plan` proposal; accepting it supersedes v1 and activates v2; on-track → `None`;
  second call while pending → `None` (`replan_pending`).
- **Forward brief:** with an active plan, the brief includes the next step + drift note;
  without an active goal, unchanged.
- **Regression:** all P2a/P1 tests still pass.

## 11. Success criteria

- `GET /planning/goals/{id}/plan` shows a real `drift` block for a dated goal.
- Falling behind and calling `/replan` produces a v2 plan proposal in the inbox; accepting
  it activates v2 and supersedes v1.
- The daily brief names the next step and whether you're on track — from real data.
- ruff clean, all tests green.

## 12. Extends into P3 / P4

- **P3** renders drift + next step + re-plan proposals in the UI.
- **P4** lets Hermes author re-plans (its own `decompose_goal`) and run the re-plan check on
  its cron — same proposal/activation path.
