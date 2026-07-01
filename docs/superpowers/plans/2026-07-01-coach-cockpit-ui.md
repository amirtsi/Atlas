# Coach Cockpit UI (P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plan visible in the cockpit — evolve the Coach tile to show the top active goal (overall %, drift chip, next step) beside proposals, with an expand modal for goals/plan detail + create-goal + propose/re-plan — all from real endpoints, no bento reflow.

**Architecture:** Frontend-only over existing, tested P2a/P2b endpoints. Add a planning API client + an `ApiError` that carries `status`/`detail` (for honest 422 messages). Extract honest-core display logic into a pure, unit-tested module (`coach-logic.ts`). Evolve `coach-inbox.tsx` (the Coach tile) and add `coach.tsx` (the Coach modal). Wire the modal in `App.tsx`; add CSS.

**Tech Stack:** React 19 + TypeScript + Vite; `lucide-react` icons; existing `shared/ui.tsx` primitives (`Panel`, `Modal`, `ProgressBar`, `Chip`). New dev dep: **vitest** (pure-helper unit tests only).

## Global Constraints

- **Honest core:** every number/label shown derives from a real endpoint; `drift === null` → **no** chip (never a guessed "on track"); no plan → "No plan yet" (never a fabricated plan); no AI key → show the server 422 `detail`, no fake plan.
- **No-scroll kiosk:** do **not** add an 8th bento tile or change `.bento` grid areas. The tile shows a **capped preview** (proposals `slice(0,3)` + one goal line); all detail/scroll lives inside the Coach `Modal`.
- **Pure web React** (no React Native). Professional/emerald aesthetic; reuse existing primitives — no new visual language. Match the existing RTL/Hebrew copy style in `coach-inbox.tsx`.
- **No backend changes** — no new endpoints, no schema edits.
- Response types are permissive (mirror the existing `Proposal` type style); request-body types are explicit.
- Gate every task on the commands in its steps; a task is done only when they pass clean.

---

### Task 1: Planning API client + typed API errors

**Files:**
- Modify: `frontend/src/api/atlas.ts` (the `request` helper near line 308; append planning types + functions near the `Proposal` block at end)

**Interfaces:**
- Consumes: existing `request`, `Proposal`, `Accent`, `LifeModule`.
- Produces: `ApiError` (class w/ `status:number`, `detail:string|null`); types `Goal`, `PlanStepProgress`, `PlanStep`, `Drift`, `Plan`, `GoalPlan`, `GoalCreatePayload`, `ReplanResult`; functions `getGoals`, `createGoal`, `proposePlan`, `getGoalPlan`, `replanGoal`.

- [ ] **Step 1: Replace the `request` helper to throw a typed error carrying status + detail**

Find (near line 308):

```ts
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    },
    ...init
  });

  if (!response.ok) {
    throw new Error(`Atlas API error ${response.status}`);
  }

  return response.json() as Promise<T>;
}
```

Replace with:

```ts
export class ApiError extends Error {
  status: number;
  detail: string | null;
  constructor(status: number, detail: string | null) {
    super(detail ?? `Atlas API error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    },
    ...init
  });

  if (!response.ok) {
    let detail: string | null = null;
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail = typeof body?.detail === "string" ? body.detail : null;
    } catch {
      detail = null;
    }
    throw new ApiError(response.status, detail);
  }

  return response.json() as Promise<T>;
}
```

- [ ] **Step 2: Append planning types + functions at the end of the file**

Append after the existing `dismissProposal` function:

```ts
export type Goal = {
  id: string;
  title: string | null;
  module_id: string | null;
  discipline_id: string | null;
  definition_of_done: string | null;
  status: string | null;
  target_date: string | null;
  capacity_minutes_per_week: number | null;
  active_plan_id: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  achieved_at: string | null;
};

export type PlanStepProgress = {
  done: number;
  target: number;
  ratio: number;
  status: string;
  last_activity_at: string | null;
};

export type PlanStep = {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  sequence: number;
  progress: PlanStepProgress;
};

export type Drift = {
  expected_percent: number;
  actual_percent: number;
  drift: number;
  projected_completion: string | null;
  on_track: boolean;
};

export type Plan = {
  id: string;
  goal_id: string;
  version: number;
  status: string;
  rationale: string | null;
  activated_at: string | null;
};

export type GoalPlan = {
  goal: Goal;
  plan: Plan;
  steps: PlanStep[];
  overall_percent: number;
  drift: Drift | null;
};

export type GoalCreatePayload = {
  title: string;
  module_id?: string;
  target_date?: string;
  capacity_minutes_per_week?: number;
  definition_of_done?: string;
};

export type ReplanResult = Proposal | { status: "on_track" | "replan_pending" };

export function getGoals(status?: string): Promise<Goal[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<Goal[]>(`/planning/goals${query}`);
}

export function createGoal(payload: GoalCreatePayload): Promise<Goal> {
  return request<Goal>("/planning/goals", { method: "POST", body: JSON.stringify(payload) });
}

export function proposePlan(goalId: string): Promise<Proposal> {
  return request<Proposal>(`/planning/goals/${goalId}/propose-plan`, { method: "POST" });
}

export function getGoalPlan(goalId: string): Promise<GoalPlan> {
  return request<GoalPlan>(`/planning/goals/${goalId}/plan`);
}

export function replanGoal(goalId: string): Promise<ReplanResult> {
  return request<ReplanResult>(`/planning/goals/${goalId}/replan`, { method: "POST" });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS (no errors). `request` still returns `Promise<T>`; existing callers that `catch` a thrown value are unaffected (`ApiError extends Error`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/atlas.ts
git commit -m "feat(web): planning API client + typed ApiError (status/detail)"
```

---

### Task 2: vitest harness + pure honest-core helpers

**Files:**
- Create: `frontend/src/features/coach-logic.ts`
- Create: `frontend/src/features/coach-logic.test.ts`
- Modify: `frontend/package.json` (add `vitest` devDep + `"test"` script)

**Interfaces:**
- Consumes: `PlanStep`, `Drift`, `Accent` from `../api/atlas` (Task 1).
- Produces: `pickNextStep(steps: PlanStep[]): PlanStep | null`; `driftChip(drift: Drift | null): { label: string; accent: Accent } | null`.

- [ ] **Step 1: Add vitest to package.json**

Add `"test": "vitest run"` to the `scripts` block, and add to `devDependencies`:

```json
"vitest": "^2.1.9"
```

Then install:

Run: `cd frontend && npm install`
Expected: vitest resolved, `node_modules/.bin/vitest` present.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/features/coach-logic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Drift, PlanStep } from "../api/atlas";
import { driftChip, pickNextStep } from "./coach-logic";

function step(sequence: number, status: string): PlanStep {
  return {
    id: `s${sequence}`,
    title: `step ${sequence}`,
    description: null,
    kind: "topic",
    sequence,
    progress: { done: 0, target: 1, ratio: 0, status, last_activity_at: null }
  };
}

function drift(on_track: boolean): Drift {
  return { expected_percent: 0.5, actual_percent: 0.3, drift: -0.2, projected_completion: null, on_track };
}

describe("pickNextStep", () => {
  it("returns the lowest-sequence step that is not done", () => {
    const steps = [step(2, "pending"), step(0, "done"), step(1, "in_progress")];
    expect(pickNextStep(steps)?.id).toBe("s1");
  });

  it("returns null when every step is done", () => {
    expect(pickNextStep([step(0, "done"), step(1, "done")])).toBeNull();
  });

  it("returns null for an empty plan", () => {
    expect(pickNextStep([])).toBeNull();
  });
});

describe("driftChip", () => {
  it("labels an on-track goal", () => {
    expect(driftChip(drift(true))).toEqual({ label: "on track", accent: "green" });
  });

  it("labels a behind goal", () => {
    expect(driftChip(drift(false))).toEqual({ label: "behind", accent: "orange" });
  });

  it("returns null when there is no drift data", () => {
    expect(driftChip(null)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL — `coach-logic.ts` / its exports do not exist.

- [ ] **Step 4: Write the minimal implementation**

Create `frontend/src/features/coach-logic.ts`:

```ts
import type { Accent, Drift, PlanStep } from "../api/atlas";

// The next step = lowest-sequence step not yet done. null when none remain / empty.
export function pickNextStep(steps: PlanStep[]): PlanStep | null {
  const pending = steps.filter((s) => s.progress.status !== "done");
  if (pending.length === 0) {
    return null;
  }
  return pending.reduce((best, s) => (s.sequence < best.sequence ? s : best));
}

// Drift → chip. null when drift is null (no target date) → the tile shows no chip.
export function driftChip(drift: Drift | null): { label: string; accent: Accent } | null {
  if (!drift) {
    return null;
  }
  return drift.on_track ? { label: "on track", accent: "green" } : { label: "behind", accent: "orange" };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS (6 tests). Then `npm run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/features/coach-logic.ts frontend/src/features/coach-logic.test.ts
git commit -m "feat(web): vitest + pure coach-logic helpers (next step, drift chip)"
```

---

### Task 3: Evolve the Coach tile (proposals + active-goal plan line)

**Files:**
- Modify: `frontend/src/features/coach-inbox.tsx`

**Interfaces:**
- Consumes: `getProposals/acceptProposal/dismissProposal` (existing), `getGoals`, `getGoalPlan`, `GoalPlan` (Task 1), `pickNextStep`, `driftChip` (Task 2), `Panel`, `ProgressBar`, `Chip`.
- Produces: `CoachInbox` now accepts `onOpen?: () => void` (opens the Coach modal) in addition to `onChanged?`.

- [ ] **Step 1: Rewrite `coach-inbox.tsx`**

Replace the whole file with:

```tsx
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import {
  type GoalPlan,
  type Proposal,
  acceptProposal,
  dismissProposal,
  getGoalPlan,
  getGoals,
  getProposals
} from "../api/atlas";
import { Chip, Panel, ProgressBar } from "../shared/ui";
import { driftChip, pickNextStep } from "./coach-logic";

export function CoachInbox({ onChanged, onOpen }: { onChanged?: () => void; onOpen?: () => void }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [topPlan, setTopPlan] = useState<GoalPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);

  async function load() {
    setError(false);
    try {
      setProposals(await getProposals("pending"));
    } catch {
      setError(true);
      setProposals([]);
    } finally {
      setLoading(false);
    }
    // Plan line is best-effort: never block proposals on a planning failure.
    try {
      const goals = await getGoals("active");
      if (goals.length) {
        setTopPlan(await getGoalPlan(goals[0].id));
      } else {
        setTopPlan(null);
      }
    } catch {
      setTopPlan(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function resolve(id: string, action: "accept" | "dismiss") {
    if (resolving) {
      return;
    }
    setResolving(id);
    try {
      if (action === "accept") {
        await acceptProposal(id);
      } else {
        await dismissProposal(id);
      }
      await load();
      onChanged?.();
    } catch {
      setError(true);
    } finally {
      setResolving(null);
    }
  }

  const chip = driftChip(topPlan?.drift ?? null);
  const nextStep = topPlan ? pickNextStep(topPlan.steps) : null;

  return (
    <Panel title="Coach" eyebrow="Proposals — you approve" className="coach-inbox-panel" onOpen={onOpen}>
      {loading ? (
        <p className="empty-panel-copy">טוען הצעות…</p>
      ) : error ? (
        <p className="empty-panel-copy">לא ניתן לטעון הצעות כרגע.</p>
      ) : proposals.length ? (
        <div className="coach-inbox-list">
          {proposals.slice(0, 3).map((proposal) => (
            <article className="coach-proposal" key={proposal.id}>
              <div className="coach-proposal-body">
                <strong dir="auto">{proposal.title}</strong>
                {proposal.rationale ? <p dir="auto">{proposal.rationale}</p> : null}
              </div>
              <div className="coach-proposal-actions">
                <button
                  className="icon-button small"
                  type="button"
                  aria-label="אשר"
                  disabled={resolving === proposal.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    resolve(proposal.id, "accept");
                  }}
                >
                  <Check size={15} />
                </button>
                <button
                  className="icon-button small"
                  type="button"
                  aria-label="דחה"
                  disabled={resolving === proposal.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    resolve(proposal.id, "dismiss");
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-panel-copy">אין הצעות ממתינות. הקואוץ' יציע צעדים מתוך נתונים אמיתיים.</p>
      )}

      {topPlan ? (
        <div className="coach-plan-line">
          <div className="coach-plan-topline">
            <strong dir="auto">🎯 {topPlan.goal.title}</strong>
            <span className="coach-plan-pct">{topPlan.overall_percent}%</span>
            {chip ? <Chip accent={chip.accent}>{chip.label}</Chip> : null}
          </div>
          <ProgressBar value={topPlan.overall_percent} accent={chip?.accent ?? "blue"} />
          {nextStep ? (
            <p className="coach-plan-next" dir="auto">
              next: {nextStep.title}
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: PASS (tsc clean; vite build succeeds).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/coach-inbox.tsx
git commit -m "feat(web): Coach tile shows top active goal (progress, drift chip, next step)"
```

---

### Task 4: Coach modal (proposals + goals + create + plan detail + propose/re-plan)

**Files:**
- Create: `frontend/src/features/coach.tsx`

**Interfaces:**
- Consumes: `getProposals/acceptProposal/dismissProposal`, `getGoals/createGoal/proposePlan/getGoalPlan/replanGoal`, `ApiError`, types `Goal/GoalPlan/Proposal/ReplanResult`, `LifeModule` (Task 1); `pickNextStep/driftChip` (Task 2); `Modal`, `Chip`, `ProgressBar` (existing).
- Produces: `CoachModal({ modules, onClose, onChanged })`.

- [ ] **Step 1: Create `frontend/src/features/coach.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import {
  ApiError,
  type Goal,
  type GoalPlan,
  type LifeModule,
  type Proposal,
  type ReplanResult,
  acceptProposal,
  createGoal,
  dismissProposal,
  getGoalPlan,
  getGoals,
  getProposals,
  proposePlan,
  replanGoal
} from "../api/atlas";
import { Chip, Modal, ProgressBar } from "../shared/ui";
import { driftChip, pickNextStep } from "./coach-logic";

function stepAccent(status: string) {
  return status === "done" ? "green" : status === "in_progress" ? "blue" : "neutral";
}

export function CoachModal({
  modules,
  onClose,
  onChanged
}: {
  modules: LifeModule[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plan, setPlan] = useState<GoalPlan | null>(null);
  const [planMissing, setPlanMissing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New-goal form
  const [title, setTitle] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [targetDate, setTargetDate] = useState("");

  async function loadLists() {
    const [nextProposals, nextGoals] = await Promise.all([getProposals("pending"), getGoals()]);
    setProposals(nextProposals);
    setGoals(nextGoals);
    if (!selectedId && nextGoals.length) {
      setSelectedId(nextGoals[0].id);
    }
  }

  useEffect(() => {
    loadLists().catch(() => setNote("לא ניתן לטעון נתונים כרגע."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setPlan(null);
      setPlanMissing(false);
      return;
    }
    setPlanMissing(false);
    getGoalPlan(selectedId)
      .then((result) => {
        setPlan(result);
        setPlanMissing(false);
      })
      .catch((err: unknown) => {
        setPlan(null);
        setPlanMissing(err instanceof ApiError && err.status === 404);
      });
  }, [selectedId]);

  async function refreshAll() {
    await loadLists();
    if (selectedId) {
      try {
        setPlan(await getGoalPlan(selectedId));
        setPlanMissing(false);
      } catch (err) {
        setPlan(null);
        setPlanMissing(err instanceof ApiError && err.status === 404);
      }
    }
    onChanged?.();
  }

  async function resolveProposal(id: string, action: "accept" | "dismiss") {
    setBusy(true);
    setNote(null);
    try {
      await (action === "accept" ? acceptProposal(id) : dismissProposal(id));
      await refreshAll();
    } catch {
      setNote("לא הצלחתי לעדכן את ההצעה.");
    } finally {
      setBusy(false);
    }
  }

  async function submitGoal(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const goal = await createGoal({
        title: title.trim(),
        module_id: moduleId || undefined,
        target_date: targetDate || undefined
      });
      setTitle("");
      setModuleId("");
      setTargetDate("");
      await loadLists();
      setSelectedId(goal.id);
      onChanged?.();
    } catch {
      setNote("לא הצלחתי ליצור מטרה.");
    } finally {
      setBusy(false);
    }
  }

  async function doPropose() {
    if (!selectedId) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await proposePlan(selectedId);
      setNote("הצעת תוכנית נוספה ל-Inbox.");
      await refreshAll();
    } catch (err) {
      setNote(err instanceof ApiError && err.detail ? err.detail : "לא ניתן להציע תוכנית כרגע.");
    } finally {
      setBusy(false);
    }
  }

  async function doReplan() {
    if (!selectedId) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const result: ReplanResult = await replanGoal(selectedId);
      if ("status" in result) {
        setNote(result.status === "on_track" ? "על המסלול — אין צורך בתכנון מחדש." : "כבר ממתינה הצעת תכנון מחדש ב-Inbox.");
      } else {
        setNote("הצעת תכנון מחדש נוספה ל-Inbox.");
      }
      await refreshAll();
    } catch (err) {
      setNote(err instanceof ApiError && err.detail ? err.detail : "לא ניתן לתכנן מחדש כרגע.");
    } finally {
      setBusy(false);
    }
  }

  const chip = driftChip(plan?.drift ?? null);
  const nextStep = plan ? pickNextStep(plan.steps) : null;
  const hasActivePlan = Boolean(plan && plan.plan.status === "active");

  return (
    <Modal eyebrow="Coach" title="מטרות ותוכניות" onClose={onClose}>
      <div className="coach-modal">
        <section className="coach-modal-section">
          <h3>הצעות ממתינות</h3>
          {proposals.length ? (
            <div className="coach-inbox-list">
              {proposals.map((proposal) => (
                <article className="coach-proposal" key={proposal.id}>
                  <div className="coach-proposal-body">
                    <strong dir="auto">{proposal.title}</strong>
                    {proposal.rationale ? <p dir="auto">{proposal.rationale}</p> : null}
                  </div>
                  <div className="coach-proposal-actions">
                    <button className="icon-button small" type="button" aria-label="אשר" disabled={busy} onClick={() => resolveProposal(proposal.id, "accept")}>
                      <Check size={15} />
                    </button>
                    <button className="icon-button small" type="button" aria-label="דחה" disabled={busy} onClick={() => resolveProposal(proposal.id, "dismiss")}>
                      <X size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-panel-copy">אין הצעות ממתינות.</p>
          )}
        </section>

        <section className="coach-modal-section">
          <h3>מטרות</h3>
          <div className="coach-goal-list">
            {goals.map((goal) => (
              <button
                key={goal.id}
                type="button"
                className={`coach-goal-row ${selectedId === goal.id ? "active" : ""}`}
                onClick={() => setSelectedId(goal.id)}
              >
                <span dir="auto">{goal.title}</span>
                {goal.status ? <Chip accent="neutral">{goal.status}</Chip> : null}
              </button>
            ))}
            {goals.length === 0 ? <p className="empty-panel-copy">עדיין אין מטרות.</p> : null}
          </div>

          <form className="coach-goal-form" onSubmit={submitGoal}>
            <input dir="auto" placeholder="מטרה חדשה…" value={title} onChange={(e) => setTitle(e.target.value)} />
            <select value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
              <option value="">ללא Module</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            <button className="btn-primary" type="submit" disabled={busy || !title.trim()}>
              + מטרה
            </button>
          </form>
        </section>

        {selectedId ? (
          <section className="coach-modal-section">
            <h3>תוכנית</h3>
            {plan ? (
              <>
                <div className="coach-plan-topline">
                  <strong dir="auto">{plan.goal.title}</strong>
                  <span className="coach-plan-pct">{plan.overall_percent}%</span>
                  {chip ? <Chip accent={chip.accent}>{chip.label}</Chip> : null}
                </div>
                <ProgressBar value={plan.overall_percent} accent={chip?.accent ?? "blue"} />
                {plan.drift ? (
                  <p className="coach-plan-drift">
                    expected {Math.round(plan.drift.expected_percent * 100)}% · actual {Math.round(plan.drift.actual_percent * 100)}%
                    {plan.drift.projected_completion ? ` · projected ${plan.drift.projected_completion.slice(0, 10)}` : ""}
                  </p>
                ) : null}
                {nextStep ? <p className="coach-plan-next" dir="auto">next: {nextStep.title}</p> : null}
                <div className="coach-step-list">
                  {plan.steps.map((step) => (
                    <div className="coach-step" key={step.id}>
                      <div className="coach-step-head">
                        <span dir="auto">{step.title}</span>
                        <Chip accent={stepAccent(step.progress.status)}>{step.progress.status}</Chip>
                      </div>
                      <ProgressBar value={Math.round(step.progress.ratio * 100)} accent={stepAccent(step.progress.status)} />
                      <span className="coach-step-meta">
                        {step.progress.done}/{step.progress.target}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : planMissing ? (
              <p className="empty-panel-copy">אין עדיין תוכנית למטרה זו.</p>
            ) : (
              <p className="empty-panel-copy">טוען…</p>
            )}

            <div className="coach-plan-actions">
              {planMissing ? (
                <button className="btn-primary" type="button" disabled={busy} onClick={doPropose}>
                  הצע תוכנית
                </button>
              ) : hasActivePlan ? (
                <button className="btn-ghost" type="button" disabled={busy} onClick={doReplan}>
                  תכנן מחדש
                </button>
              ) : plan ? (
                <p className="empty-panel-copy">התוכנית ממתינה לאישור ב-Inbox.</p>
              ) : null}
            </div>
          </section>
        ) : null}

        {note ? <p className="coach-modal-note" dir="auto">{note}</p> : null}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/coach.tsx
git commit -m "feat(web): Coach modal — goals, create, plan detail, propose/re-plan"
```

---

### Task 5: Wire the Coach modal into the shell + styles

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: `CoachModal` (Task 4), evolved `CoachInbox` `onOpen` (Task 3).
- Produces: a `coachOpen` modal state in `App.tsx`; CSS for the tile plan line + modal sections.

- [ ] **Step 1: Add the modal state + wiring in `App.tsx`**

Add the import (with the other feature imports near line 11):

```tsx
import { CoachModal } from "./features/coach";
```

Add state (near the other `useState` calls, ~line 25):

```tsx
  const [coachOpen, setCoachOpen] = useState(false);
```

Pass `onOpen` to the tile (replace the existing `<CoachInbox onChanged={refreshDashboard} />` at line 304):

```tsx
                <CoachInbox onChanged={refreshDashboard} onOpen={() => setCoachOpen(true)} />
```

Render the modal (add just before the closing `</div>` of `app-shell`, after the `activeModal` block near line 380):

```tsx
      {coachOpen ? (
        <CoachModal modules={modules} onClose={() => setCoachOpen(false)} onChanged={refreshDashboard} />
      ) : null}
```

- [ ] **Step 2: Add styles**

Append to `frontend/src/styles.css`:

```css
/* Coach tile — active-goal plan line */
.coach-plan-line {
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--line, rgba(255, 255, 255, 0.08));
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.coach-plan-topline {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.coach-plan-topline strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.coach-plan-pct {
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
.coach-plan-next,
.coach-plan-drift {
  margin: 0;
  font-size: 0.82rem;
  opacity: 0.75;
}

/* Coach modal */
.coach-modal {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
.coach-modal-section h3 {
  margin: 0 0 var(--sp-2);
  font-size: 0.9rem;
  opacity: 0.8;
}
.coach-goal-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  margin-bottom: var(--sp-3);
}
.coach-goal-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line, rgba(255, 255, 255, 0.08));
  border-radius: var(--r-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: start;
}
.coach-goal-row.active {
  border-color: var(--accent-green, #34d399);
}
.coach-goal-form {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: var(--sp-2);
}
.coach-goal-form input,
.coach-goal-form select {
  padding: var(--sp-2);
  border-radius: var(--r-sm);
  border: 1px solid var(--line, rgba(255, 255, 255, 0.12));
  background: var(--surface-2, rgba(255, 255, 255, 0.04));
  color: inherit;
}
.coach-step-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.coach-step-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.coach-step-meta {
  font-size: 0.78rem;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
.coach-plan-actions {
  margin-top: var(--sp-3);
  display: flex;
  gap: var(--sp-2);
}
.coach-modal-note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--surface-2, rgba(255, 255, 255, 0.04));
  font-size: 0.85rem;
}
@media (max-width: 640px) {
  .coach-goal-form {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 3: Typecheck, lint, build**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: PASS on all three (tsc clean, eslint clean, vite build succeeds).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/styles.css
git commit -m "feat(web): wire Coach modal into the shell + styles"
```

---

## Verification (whole feature)

- `cd frontend && npm test` → vitest green (6 tests).
- `cd frontend && npm run typecheck && npm run lint && npm run build` → all clean.
- Manual (with backend running): the Coach tile shows the top active goal (real %, correct drift chip, real next step) beside proposals with no dashboard scroll; the modal creates a goal, proposes a plan (→ inbox), shows real per-step progress + drift, and re-plans (→ inbox); with no AI key, propose/re-plan show the honest 422 message; a goal with no target date shows no drift chip.
