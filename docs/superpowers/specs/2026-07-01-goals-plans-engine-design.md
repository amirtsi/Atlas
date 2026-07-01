# Goals & Plans Engine — Design Spec (P2a)

- **Date:** 2026-07-01
- **Status:** Approved (design); ready for implementation planning
- **Roadmap phase:** P2a of `docs/superpowers/2026-07-01-smart-atlas-roadmap.md` (P2b = drift + re-plan, deferred)
- **Basis:** `docs/planning-engine.md` (the full engine design)

## 1. Summary

The forward-planning core. Declare a goal ("Pass OSCP") → Atlas's LLM decomposes it into
a plan (phases → topics → practice) → the plan arrives in the **existing P1 Coach inbox**
as a `activate_plan` proposal → you accept → the plan activates → **progress is derived from your
real logged activities**. This is what makes Atlas plan *forward*, not just record the past.

P2a reuses the spine we already shipped: the **P1 proposal inbox + handler registry**
(activation is a new proposal type) and the **coach's Anthropic adapter** (decomposition).
No new UI — plan proposals surface in the current Coach inbox tile.

## 2. Goals / Non-goals

**Goals**
- `goals` / `plans` / `plan_steps` / `plan_step_links` data model (versioned plans; P2a only creates v1).
- `create_goal`; `propose_plan_for_goal` (LLM decompose → a `proposed` plan + steps + a `plan`
  proposal in the P1 inbox); `activate_plan` (registered handler → accept activates it).
- `evaluate_step` — **ledger-derived** progress; `get_goal_plan` returns the active plan +
  steps + per-step and overall progress.
- REST for goals; plan proposals flow through the existing `/proposals` accept path.

**Non-goals (P2b / later)**
- No drift detection, projected-completion, or the re-plan loop (P2b).
- No forward daily brief (P2b).
- No link-at-log-time (the classifier tagging an activity to a step) — P2a uses auto-rollup
  by module + type + text match. (Later phase.)
- No rich goal/plan UI beyond the plan proposal appearing in the P1 inbox (P3).
- No web-search syllabus lookup — the LLM decomposes from its own knowledge.

## 3. Current state (what we build on)

- **P1 proposal inbox** (`proposals/service.py`): `create_proposal`, `accept_proposal`
  (dispatches via `_HANDLERS` registry), `dismiss_proposal`, `KNOWN_TYPES`. Accept applies a
  handler then marks accepted (rolls back on failure). **P2a extends this with a
  registration function so new domains register handlers without proposals importing them.**
- **Coach LLM adapter** pattern (`coach/service.py::_llm_answer` via stdlib urllib +
  `ATLAS_ANTHROPIC_API_KEY` + `coach_model`) — mirror it for decomposition, and make the
  decompose call a module-level function so tests monkeypatch it (no network).
- Service layer, `record_audit_event`, `get_or_404`, per-test temp DB, `user_version` (new
  tables land via `IF NOT EXISTS`, no bump).

## 4. Data model (add to `SCHEMA_SQL`)

```sql
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  module_id TEXT REFERENCES life_modules(id),
  discipline_id TEXT REFERENCES disciplines(id),
  title TEXT NOT NULL,
  definition_of_done TEXT,
  status TEXT NOT NULL DEFAULT 'draft',        -- draft|active|achieved|abandoned
  target_date TEXT,
  capacity_minutes_per_week INTEGER,
  active_plan_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, achieved_at TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'proposed',      -- proposed|active|superseded|rejected
  rationale TEXT,
  based_on_plan_id TEXT,
  source_proposal_id TEXT,
  created_at TEXT NOT NULL, activated_at TEXT, superseded_at TEXT
);

CREATE TABLE IF NOT EXISTS plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  goal_id TEXT NOT NULL REFERENCES goals(id),
  parent_id TEXT REFERENCES plan_steps(id),
  kind TEXT NOT NULL,                           -- phase|topic|practice|milestone|checkpoint
  title TEXT NOT NULL, description TEXT,
  sequence INTEGER NOT NULL DEFAULT 0,
  depends_on TEXT NOT NULL DEFAULT '[]',
  completion_rule TEXT NOT NULL DEFAULT '{}',
  scheduled_for TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  -- NO stored status/progress — both derived (§6).
);

CREATE TABLE IF NOT EXISTS plan_step_links (
  step_id TEXT NOT NULL REFERENCES plan_steps(id),
  activity_id TEXT NOT NULL REFERENCES activities(id),
  PRIMARY KEY (step_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_plans_goal_id ON plans(goal_id);
CREATE INDEX IF NOT EXISTS idx_plan_steps_plan_id ON plan_steps(plan_id);
```

Add `"depends_on"` and `"completion_rule"` to `row_to_dict`'s JSON-parsed keys.

## 5. completion_rule (how a step maps to real activity)

Server-constructed JSON (the LLM never invents module ids):

```jsonc
{ "type": "duration", "module_id": "<goal.module_id>", "activity_type": "study",
  "match": "active directory", "target_minutes": 600 }
{ "type": "count", "module_id": "<goal.module_id>", "match": "box", "target_count": 5 }
{ "type": "manual_link", "target_count": 1 }   // milestone: satisfied by linked activities
```

`match` is an optional lowercase substring tested against the activity title (+notes).

## 6. Honest progress engine

`evaluate_step(conn, step) -> dict` returns `{done, target, ratio, status, last_activity_at}`:
- `duration`/`count`: aggregate real `activities` for `module_id` (+ `activity_type` if set,
  + title/notes containing `match` if set). `done` = summed minutes or row count.
- `manual_link`: `done` = count of `plan_step_links` rows for the step.
- `ratio = min(1, done/target)` (target>0 else 0); `status = done>=target ? "done" :
  done>0 ? "in_progress" : "pending"`; `last_activity_at` = most recent matching activity.

Progress is **always** a query over real rows — never stored. A `phase`'s progress rolls up
from its child steps (`sequence`/`parent_id`).

## 7. Plan decomposition (LLM → proposed plan → inbox)

`propose_plan_for_goal(conn, goal_id) -> dict` (returns the created `activate_plan` proposal):
1. Load the goal. Call `decompose_goal(goal) -> list[step-spec]` (module-level; monkeypatched
   in tests). Real impl: Anthropic adapter with a structured JSON prompt; each step-spec =
   `{kind, title, description, sequence, unit: "minutes"|"count", target, match?}`. On
   no-key/error → raise 422 "decomposition unavailable" (honest fallback; no fake plan).
2. Create a `plans` row (version 1, status `proposed`, rationale from the LLM) + `plan_steps`,
   with `completion_rule` **constructed server-side**: `module_id = goal.module_id`, `type` =
   duration if unit=minutes else count, `target_minutes`/`target_count` = target, `match` from
   the step-spec (default: derived from the title).
3. Create a P1 proposal: `type="activate_plan"` (the registered handler key),
   `title="Plan for {goal.title}"`, rationale, and `payload={"plan_id": <plan.id>}`; store
   `plans.source_proposal_id`.

`_activate_plan_handler(conn, payload) -> dict` (registered for `"activate_plan"`): set the
plan `status=active`, `activated_at`; set `goals.active_plan_id` and `goals.status='active'`;
supersede any prior active plan for the goal. Audited. Accepting the `activate_plan` proposal
via the existing P1 accept path is what activates the plan.

`create_proposal` validates `type` against the **live** handler registry (`_HANDLERS`), so
`activate_plan` is accepted once `planning/service.py` has registered it (§8).

## 8. Proposals registry extension (avoid a cycle, keep OCP)

`proposals/service.py` gains `register_proposal_handler(proposal_type, handler)` and makes
`KNOWN_TYPES` the live registry keys. The two P1 module handlers register inline as today.
`planning/service.py` calls `register_proposal_handler("activate_plan", _activate_plan_handler)`
at import — so **proposals never imports planning** (no circular import), and planning depends
on proposals only for `create_proposal` + the registration function. Registration runs because
`main.py` imports the planning router (→ its service).

## 9. Endpoints (`planning/router.py`, prefix `/planning`)

- `POST /planning/goals` (201) → `GoalCreate` → creates a `draft` goal → `GoalOut`.
- `GET /planning/goals?status=` → `list[GoalOut]`.
- `POST /planning/goals/{id}/propose-plan` → runs decomposition → returns the created `plan`
  proposal (`ProposalOut`). (422 if the LLM key is missing/errors.)
- `GET /planning/goals/{id}/plan` → the active (or latest) plan + steps + per-step progress +
  overall percent. 404 if the goal has no plan yet.

Register `planning_router` in `main.py` under `/api/v1`.

## 10. Honest-core guarantees

- The plan (path) is a **proposal** — nothing activates until you accept it.
- Progress (position) is **only** derived from real `activities` (+ explicit links); never stored, never invented.
- The LLM proposes step titles/targets; **module ids and completion rules are server-constructed** from the goal — the model can't fabricate what counts.
- No key / LLM error → 422, never a fabricated plan.
- Goal creation, plan proposal, activation all audited.

## 11. Error handling

| Condition | Behavior |
|---|---|
| propose-plan with no `ATLAS_ANTHROPIC_API_KEY` or LLM error | 422 "plan decomposition unavailable" (no plan created) |
| propose-plan for an unknown goal | 404 |
| goal with `module_id` that doesn't exist | 404 at create |
| `GET .../plan` when no plan exists | 404 |
| accept a `activate_plan` proposal whose plan is missing | rolls back, proposal stays pending (via existing accept semantics) |

## 12. Testing (TestClient + temp DB; LLM monkeypatched)

- **evaluate_step:** seed activities → duration rule sums real minutes; count rule counts;
  match filter narrows by title; manual_link counts links; ratio/status correct; empty → pending.
- **decomposition:** monkeypatch `decompose_goal` to return a fixed step list → `propose-plan`
  creates a `proposed` plan + steps (completion_rule.module_id == goal.module_id) + a `plan`
  proposal in the inbox with `payload.plan_id`.
- **activation:** accept the `activate_plan` proposal (via `/proposals/{id}/accept`) → plan `active`,
  `goals.active_plan_id` set, goal `active`.
- **get plan+progress:** returns steps with derived progress after seeding activities.
- **honest fallback:** with no API key, `propose-plan` → 422, no plan/proposal created.
- **regression:** all existing tests (incl. P1 proposals) still pass; registry still handles
  the two module types.

## 13. Success criteria

- `POST /planning/goals` then `/propose-plan` (LLM stubbed in tests, real in prod) yields a
  plan proposal in the Coach inbox; accepting it activates the plan.
- After logging real activities, `GET .../plan` shows real per-step progress; an untouched
  step reads `pending` with 0 — never invented numbers.
- ruff clean, all tests green.

## 14. How P2b / P3 / P4 extend this

- **P2b:** planned-vs-actual drift, projected completion, and the re-plan loop (new plan
  version + a `plan` re-proposal); the forward brief.
- **P3:** goal/plan/progress UI (the inbox already surfaces plan proposals; P3 adds the detail views).
- **P4:** Hermes replaces `decompose_goal` (memory/learning) and authors re-plans via MCP —
  same proposal + activation path.
