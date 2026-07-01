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
