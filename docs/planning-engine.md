# Atlas Planning Engine + Hermes Coach (Design)

This document specifies the **planning engine** — the forward-planning layer that turns
Atlas from a passive recorder of what happened into a system that reasons about what to
do next — and how **Hermes Agent** (Nous Research) plugs in as the coaching brain that
drives it.

Status: **design, agreed.** Nothing here is built yet. This is the blueprint.

---

## 1. Why this exists

Atlas today only looks **backward** and only **reacts**: it records activities, computes
a few fixed signals, and waits. The missing layer is **forward planning** — taking a goal
("Pass OSCP") and reasoning about the path to it, then adapting that path as reality
diverges. Three capabilities are missing, and they are exactly what Hermes brings:

1. **Memory of the user** — a model that accumulates over weeks, not a stateless guess.
2. **Forward reasoning** — decompose a goal into sequenced, scheduled practice.
3. **Initiative** — run on its own clock, notice drift, reach out first.

The north star, and the hard constraint that defines success: Atlas must become **smart
about _real_ data** — never clever-by-fabrication. The honest core (only real logged data,
never invent) is the immune system against the failure mode of "smart."

## 2. The core principle

> **Hermes proposes the _path_. The ledger decides the _position_.**

Progress is **never stored as truth** — it is always a `SELECT` over the `activities`
table. This generalizes a pattern Atlas already uses: `learning_units` and `project_items`
each carry a `completed_activity_id`, i.e. they are "done" because a *real activity*
completed them. The planning engine makes that the rule for everything.

## 3. Two planes (how a generative agent stays inside the honest core)

| Plane | What | Who writes it | Honesty rule |
|---|---|---|---|
| **Fact** | activities, modules, the ledger | user + validated tools | real events only, never fabricated |
| **Judgment** | plans, priorities, recommendations, briefs, goals | Hermes (as proposals) | interpretation of real data; advisory; you approve |

Hermes gets real authority over the **judgment** plane, but every change is a **proposal**
that does nothing until you accept it (advisory mode). It can never write a fabricated fact.

```
   you ⇄ Hermes  (coach brain: memory, learning, cron, web search)
            │ MCP client  ── the only supported seam ──
            ▼
     Atlas MCP server
       ├─ READ tools ........ fact plane (ledger, modules, plan position)  ← honest, locked
       ├─ APPEND tools ...... log real activity via the validated path     ← no fabrication
       └─ PROPOSE tools ..... judgment plane → writes to the Proposal Inbox (pending)
            ▼
     Atlas FastAPI + SQLite  →  dashboard shows accepted guidance with weight
```

Hermes is a self-hosted agent and an **MCP client only** (it cannot be an MCP server and
exposes no REST API), so the only clean seam is: **Atlas exposes an MCP server, Hermes
consumes it.** Authority is **advisory** — and the accept/dismiss signal is itself how the
coach learns your taste over time, so caution compounds into intelligence.

## 4. A plan is a *versioned* object

Re-planning is the intelligence, so versioning is the spine. A goal points at one **active
plan version**. Re-planning never mutates the live plan — it creates **v2**, supersedes v1,
and keeps the history. You can always see "the original plan vs. what reality forced it to
become."

```
goal ──▶ plan(v3, active) ──▶ plan_steps[]              ← the path (judgment, proposed)
  │         └ supersedes plan(v2) ─ supersedes plan(v1)  ← history, kept
  └──▶ position = SELECT over activities                 ← where you actually are (fact)
```

## 5. Data model

Four new tables, in the existing Atlas style (text UUID PKs, ISO-8601 text timestamps,
JSON-in-`TEXT` columns auto-parsed by `row_to_dict`).

```sql
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  module_id TEXT REFERENCES life_modules(id),     -- usually 1 goal ↔ 1 module (OSCP)
  discipline_id TEXT REFERENCES disciplines(id),
  title TEXT NOT NULL,                              -- "Pass OSCP"
  definition_of_done TEXT,                          -- "24h exam, ≥70 pts"
  status TEXT NOT NULL DEFAULT 'draft',             -- draft|active|paused|achieved|abandoned
  target_date TEXT,                                 -- the deadline
  capacity_minutes_per_week INTEGER,               -- the constraint Hermes plans against
  active_plan_id TEXT,                              -- → current plan version
  created_by TEXT NOT NULL DEFAULT 'user',          -- user|hermes
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, achieved_at TEXT
);

CREATE TABLE plans (                                 -- a versioned roadmap
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',           -- proposed|active|superseded|rejected
  rationale TEXT,                                    -- Hermes's reasoning for THIS version
  based_on_plan_id TEXT REFERENCES plans(id),        -- the version it adapted from (null=v1)
  source_proposal_id TEXT,                           -- ties to the advisory inbox
  horizon_start TEXT, horizon_end TEXT,
  created_at TEXT NOT NULL, activated_at TEXT, superseded_at TEXT
);

CREATE TABLE plan_steps (                            -- generalizes learning_units + project_items
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  goal_id TEXT NOT NULL REFERENCES goals(id),
  parent_id TEXT REFERENCES plan_steps(id),          -- phase → topic → practice (hierarchy)
  kind TEXT NOT NULL,                                -- phase|topic|practice|milestone|checkpoint
  title TEXT NOT NULL, description TEXT,
  sequence INTEGER NOT NULL DEFAULT 0,
  depends_on TEXT NOT NULL DEFAULT '[]',             -- [step_id,...] dependency graph
  completion_rule TEXT NOT NULL DEFAULT '{}',        -- HOW real activity counts (§6)
  scheduled_for TEXT,                                -- the date/window the plan slots it into
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  -- NOTE: no `status`, no `progress` column. Both are DERIVED (§6). Storing them
  -- would let the agent lie. The ledger is the only thing that can move the position.
);

CREATE TABLE plan_step_links (                        -- explicit fact↔step linkage (honest)
  step_id TEXT NOT NULL REFERENCES plan_steps(id),
  activity_id TEXT NOT NULL REFERENCES activities(id),
  PRIMARY KEY (step_id, activity_id)
);
```

The `activities` table is **not** changed — step linkage rides in the existing
`activities.metadata` JSON (`metadata.plan_step_id`) plus a `plan_step_links` row.

### Fixed kinds (decision #3)

The hierarchy vocabulary is fixed: `phase → topic → practice`, with `milestone` and
`checkpoint` able to hang off a phase or a topic. Completion rules live on the **leaves**
(`practice` / `topic` / `milestone`); **a phase's progress rolls up from its children**.
Fixing the vocabulary is what makes roll-up deterministic.

## 6. The honest progress engine

Each step carries a declarative `completion_rule` describing *which real activities count
and how much is enough*:

```jsonc
// volume target → sums real duration
{ "type": "duration", "module_id": "<oscp>", "activity_type": "study",
  "match": {"tag": "active-directory"}, "target_minutes": 1800 }

// count target → counts real activities
{ "type": "count", "activity_type": "study", "match": {"tag": "box"}, "target_count": 5 }

// discrete milestone → mirrors the existing completed_activity_id pattern
{ "type": "manual_link", "target_count": 1 }
```

One pure function is the entire truth of "where am I":

```python
def evaluate_step(conn, step) -> dict:
    rule = step["completion_rule"]
    # builds a SELECT over `activities` (+ plan_step_links) within the plan window
    done = _aggregate_real_activities(conn, rule)        # minutes or count, from the ledger
    target = rule.get("target_minutes") or rule.get("target_count")
    return {
        "done": done, "target": target,
        "ratio": min(1.0, done / target) if target else 0.0,
        "status": "done" if done >= target else "in_progress" if done else "pending",
        "last_activity_at": _last_match(conn, rule),
    }
```

### Linkage: link-at-log-time **and** auto-rollup (decision #1)

- **Link-at-log-time** — when an activity is logged (WhatsApp classifier or quick-log),
  Atlas offers the **current step** (the next dependency-clear `pending`/`in_progress`
  step of that module's active goal). On confirm it writes `metadata.plan_step_id` and a
  `plan_step_links` row. This is the existing classifier extended slightly.
- **Auto-rollup** — even with no explicit link, `duration`/`count` rules still aggregate
  matching activities by `module_id` + `activity_type` + window.

Belt and suspenders; both bottom out at `activities`, so they never disagree about facts.

## 7. Planned-vs-actual → drift (what makes it *forward*)

This is the difference between a living plan and a static checklist:

- **Planned curve** — cumulative `target` of steps by their `scheduled_for` date.
- **Actual curve** — cumulative `done` (from `evaluate_step`) by activity `occurred_at`.
- **Drift(today)** = `actual − planned`. Negative ⇒ behind.
- **Projected completion** = remaining target ÷ your *actual* rolling pace (last 2–3 weeks
  of real activity), compared against `target_date`.

All four are queries over real rows. Nothing is asserted.

## 8. The re-plan loop (where intelligence lives)

A one-shot "break a goal into tasks" is just a checklist. Forward planning is a loop that
adapts. Each **trigger** is a *computed fact*, not a vibe:

| Trigger | Computed from | Hermes's response |
|---|---|---|
| **Schedule drift** | `drift(today) < −threshold` | propose re-plan: extend or cut scope |
| **Pace divergence** | actual min/wk ≪ `capacity_minutes_per_week` | "at 3h/wk OSCP lands in Dec, not Oct" |
| **Deadline pressure** | remaining_target > remaining_capacity to `target_date` | propose scope cut or intensify |
| **Ahead of schedule** | a step `done` early | pull next topic forward / add depth |
| **Stall** | `in_progress` step, no match in N days | tactical nudge; if persistent → re-sequence |
| **New information** | owner says "exam moved up" | re-plan from new constraints |

The re-plan is **advisory**: Hermes drafts plan **v_next** with the numbers and ~2
options, submits it as a proposal; you pick; v_next activates, the prior version is
superseded (kept in history).

**Guard against nagging:** at most **one open re-plan proposal per goal** — the daily pass
skips any goal that already has a pending re-plan in the inbox.

## 9. MCP tool surface

The invariant is visible in the split — **no tool can set a step's status or progress.**

```
READ (fact / derived)                  PROPOSE (judgment → inbox)        APPEND (fact, validated)
─────────────────────                  ──────────────────────────        ───────────────────────
list_goals(status?)                    propose_goal(...)                 log_activity(..., plan_step_id?)
get_plan(goal_id)        → steps+ratio propose_plan(goal_id, steps,
get_plan_progress(goal_id)→ drift/ETA            rationale, based_on?)
get_replan_signals()     → triggers    propose_plan_revision(...)
list_modules() / query_ledger()        (accept/dismiss is a user action in Atlas, not a tool)
```

Hermes proposes the path; the ledger is the only thing that can move the position. That one
rule is what keeps a generative agent inside the honest core.

## 10. Cadence: hybrid (decision #4)

Two paths doing **different** jobs, so they never overlap:

- **Event-driven** (on each new logged activity in a goal's module) — *cheap, no LLM.*
  Atlas re-evaluates only the affected steps, refreshes position, and fires only **instant**
  triggers (a step just completed, a milestone crossed, "you did today's thing"). Keeps the
  "where am I / what's next" view live in real time.
- **Daily scheduled** (reuse the existing `run_daily_brief_scheduler` infra) — *the
  reasoning pass.* Recompute drift / pace / ETA across all active goals, evaluate the
  **slow** triggers, and let Hermes draft re-plan proposals + the forward brief.

## 11. How it projects to the dashboard

Forward planning is the spine; the existing coaching surfaces become **projections of the
active plan**, not separate features. The current hard-coded heuristics in
`dashboard/router.py::_build_recommendations` become the **fallback** when no goal is
active. When a goal *is* active:

- **`today_focus`** → the next `pending` step with dependencies met & scheduled now.
- **Forward daily brief** → today's slice of the plan + any drift nudge (flips the brief
  from backward "you did 3 things" to forward "next right move").
- **Priorities** → goals ranked by `drift × deadline pressure`.

## 12. Worked example — OSCP

```
Goal "Pass OSCP", target Oct 1, capacity 600 min/wk.

Hermes (web-searches the syllabus) → propose_plan v1:
  phase Foundations: topic Enumeration (duration 600m), topic Scripting (300m)
  phase Core:        topic Buffer Overflow (count 3 labs, depends Foundations)
                     topic Priv-Esc (count 5 boxes)
                     topic Active Directory (count 5 boxes, depends Enumeration)
  phase Exam:        milestone 3 practice exams, checkpoint report draft
You accept → plan v1 active, steps materialized.

You WhatsApp "studied AD enum 60m" → classifier maps to the OSCP module,
  offers step "Active Directory" → activity.metadata.plan_step_id set + link row.
  evaluate_step(AD): done 1/5, status in_progress.   ← real, from the ledger

Week 3: actual ~180 min/wk vs 600 planned → drift trigger.
Hermes → propose_plan v2 + rationale:
  "Avg 3h/wk. At this pace: Dec 12, not Oct 1.
   A) extend target_date → Dec    B) drop AD 5→3 boxes + cut Scripting to hold Oct"
You accept A → v2 active, v1 superseded (kept in history).
```

## 13. Legacy `learning_units` / `project_items` (decision #2)

**Coexist now; `plan_steps` is canonical; converge later.** Do **not** migrate in the
first build:

- They are load-bearing for shipped features (`life_modules/behavior.py` →
  `_module_recommendation` → module tiles). Migrating means rewriting the learning +
  project routers and the behavior layer for no Phase-2 payoff.
- No double-counting risk: both models bottom out at `activities` (a `manual_link` step can
  point at the same completing activity a `learning_unit` does).
- UX rule that avoids two competing to-do lists: **a module renders `plan_steps` when it
  has an active plan; otherwise it falls back to its legacy checklist.**
- Fold legacy into `plan_steps` as a dedicated cleanup *after* the engine proves out.
- Optional, only if hit in practice: when a module already has meaningful legacy items,
  Hermes *adopts them by reference* rather than duplicating.

## 14. Build phasing

| Phase | What | Notes |
|---|---|---|
| **0 — Prove the seam** | Read-only Atlas MCP server; stand Hermes up; confirm it reasons over the real ledger. No writes. | smallest reversible step; de-risks everything |
| **1 — Approval spine** | Proposal Inbox (table, accept/dismiss, audit) + `propose_*` tools + Coach inbox UI. | the advisory contract, end-to-end on one proposal type |
| **2 — Planning engine** | `goals`/`plans`/`plan_steps`/`plan_step_links` + `evaluate_step` + planned-vs-actual + the re-plan loop. The OSCP flow. | the core; this document |
| **3 — Projections** | priorities, recommendations, forward brief become views of the active plan. | mostly falls out of Phase 2 |
| **4 — Channel & dial** | interactive planning channel; per-type autonomy dial (advisory → auto-apply low-stakes). | a path to "more weight" later, on your terms |

## 15. Honest-core guarantees (baked in, not bolted on)

- Fact-plane tools are read / validated-append only — fabricating an activity is
  structurally impossible.
- `plan_steps` store no status/progress; position is always derived from `activities`.
- Every judgment change is a proposal requiring explicit acceptance.
- Goal progress = real logged activity mapped to steps, never the agent's memory.
- Hermes's own memory/user-model is advisory context, never surfaced as dashboard fact.
- Everything routes through the existing `audit_events` log.

## 16. Open / downstream decisions (non-blocking)

- **Channel:** start Hermes on Telegram (additive); keep the existing WhatsApp/Evolution
  line as the quick-log path. Hermes runs its own WhatsApp bridge that would *conflict*
  with the existing number, so don't put it there first.
- **Hosting / transport:** local + stdio MCP first; Docker + HTTP when always-on is wanted.
- **Model provider for Hermes:** Nous Portal / OpenRouter / reuse the existing Anthropic key.
- **Two-backends gotcha:** the MCP server must point at the **Desktop** active copy of
  Atlas, not the stale Documents one.
```
