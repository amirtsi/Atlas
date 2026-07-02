import { useEffect, useState } from "react";
import { Check, Link2, Pencil, Plus, Trash2, X } from "lucide-react";

import {
  type Accent,
  ApiError,
  type DashboardRecommendation,
  type Goal,
  type GoalPlan,
  type JournalActivity,
  type LifeModule,
  type Proposal,
  type ReplanResult,
  acceptProposal,
  createGoal,
  deleteGoal,
  dismissProposal,
  getGoalPlan,
  getGoals,
  getProposals,
  linkActivityToStep,
  proposePlan,
  replanGoal,
  unlinkActivityFromStep,
  updateGoal
} from "../api/atlas";
import { Chip, Modal, ProgressBar } from "../shared/ui";
import { driftChip, pickNextStep } from "./coach-logic";

function stepAccent(status: string) {
  return status === "done" ? "green" : status === "in_progress" ? "blue" : "neutral";
}

function severityAccent(severity: string): Accent {
  return severity === "critical" ? "red" : severity === "warning" ? "orange" : "green";
}

export function CoachModal({
  modules,
  activities = [],
  recommendations = [],
  onClose,
  onChanged
}: {
  modules: LifeModule[];
  activities?: JournalActivity[];
  recommendations?: DashboardRecommendation[];
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

  // Edit / delete of an existing goal
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editModuleId, setEditModuleId] = useState("");
  const [editTargetDate, setEditTargetDate] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [linkingStepId, setLinkingStepId] = useState<string | null>(null);

  async function loadLists() {
    const [nextProposals, nextGoals] = await Promise.all([getProposals("pending"), getGoals()]);
    setProposals(nextProposals);
    setGoals(nextGoals);
    if (!selectedId) {
      const firstVisible = nextGoals.find((g) => g.status !== "abandoned");
      if (firstVisible) {
        setSelectedId(firstVisible.id);
      }
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

  function startEdit(goal: Goal) {
    setConfirmDeleteId(null);
    setEditingId(goal.id);
    setEditTitle(goal.title ?? "");
    setEditModuleId(goal.module_id ?? "");
    setEditTargetDate(goal.target_date ? goal.target_date.slice(0, 10) : "");
  }

  async function submitEdit(event: React.FormEvent, goalId: string) {
    event.preventDefault();
    if (!editTitle.trim()) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await updateGoal(goalId, {
        title: editTitle.trim(),
        module_id: editModuleId || undefined,
        target_date: editTargetDate || undefined
      });
      setEditingId(null);
      await refreshAll();
    } catch {
      setNote("לא הצלחתי לעדכן את המטרה.");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(goalId: string) {
    setBusy(true);
    setNote(null);
    try {
      await deleteGoal(goalId);
      setConfirmDeleteId(null);
      if (selectedId === goalId) {
        setSelectedId(null);
      }
      await refreshAll();
    } catch {
      setNote("לא הצלחתי למחוק את המטרה.");
    } finally {
      setBusy(false);
    }
  }

  async function doLink(stepId: string, activityId: string) {
    setBusy(true);
    setNote(null);
    try {
      await linkActivityToStep(stepId, activityId);
      setLinkingStepId(null);
      await refreshAll();
    } catch {
      setNote("לא הצלחתי לקשר את הפעילות.");
    } finally {
      setBusy(false);
    }
  }

  async function doUnlink(stepId: string, activityId: string) {
    setBusy(true);
    setNote(null);
    try {
      await unlinkActivityFromStep(stepId, activityId);
      await refreshAll();
    } catch {
      setNote("לא הצלחתי לבטל את הקישור.");
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
      // Discriminate on a Proposal-only field: a real proposal has `id`; the
      // status object has only `status` (and Proposal itself also has `status`).
      if ("id" in result) {
        setNote("הצעת תכנון מחדש נוספה ל-Inbox.");
      } else {
        setNote(result.status === "on_track" ? "על המסלול — אין צורך בתכנון מחדש." : "כבר ממתינה הצעת תכנון מחדש ב-Inbox.");
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

  const selectedGoal = goals.find((g) => g.id === selectedId) ?? null;
  const visibleGoals = goals.filter((g) => g.status !== "abandoned");
  const activityTitle = (id: string) => activities.find((a) => a.id === id)?.title ?? "פעילות";

  return (
    <Modal eyebrow="Chief of Staff" title="מרכז הפיקוד" size="wide" onClose={onClose}>
      <div className="command-center">
        {note ? <p className="coach-modal-note" dir="auto">{note}</p> : null}

        <div className="cc-signals">
          <section className="cc-card">
            <header className="cc-card-head">
              <h3>המלצות עכשיו</h3>
              <span className="cc-count">{recommendations.length}</span>
            </header>
            {recommendations.length ? (
              <div className="coach-reco-list">
                {recommendations.map((reco, index) => (
                  <article className="coach-reco" key={`${reco.title}-${index}`}>
                    <div className="coach-reco-head">
                      <strong dir="auto">{reco.title}</strong>
                      <Chip accent={severityAccent(reco.severity)}>{reco.severity}</Chip>
                    </div>
                    {reco.body ? <p dir="auto">{reco.body}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="empty-panel-copy">אין המלצות חיות עדיין.</p>
            )}
          </section>

          <section className="cc-card">
            <header className="cc-card-head">
              <h3>הצעות ממתינות</h3>
              <span className="cc-count">{proposals.length}</span>
            </header>
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
        </div>

        <div className="cc-work">
          <section className="cc-card cc-goals">
            <header className="cc-card-head">
              <h3>מטרות</h3>
              <span className="cc-count">{visibleGoals.length}</span>
            </header>
            <div className="coach-goal-list">
              {visibleGoals.map((goal) =>
                editingId === goal.id ? (
                  <form key={goal.id} className="coach-goal-edit" onSubmit={(event) => submitEdit(event, goal.id)}>
                    <input dir="auto" placeholder="כותרת" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                    <div className="coach-goal-edit-row">
                      <select value={editModuleId} onChange={(e) => setEditModuleId(e.target.value)}>
                        <option value="">ללא Module</option>
                        {modules.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <input type="date" value={editTargetDate} onChange={(e) => setEditTargetDate(e.target.value)} />
                    </div>
                    <div className="coach-goal-edit-actions">
                      <button className="btn-primary tour-btn" type="submit" disabled={busy || !editTitle.trim()}>
                        שמור
                      </button>
                      <button className="btn-ghost tour-btn" type="button" onClick={() => setEditingId(null)}>
                        ביטול
                      </button>
                    </div>
                  </form>
                ) : confirmDeleteId === goal.id ? (
                  <div key={goal.id} className="coach-goal-confirm">
                    <span dir="auto">למחוק את "{goal.title}"?</span>
                    <div className="coach-goal-confirm-actions">
                      <button className="activity-action danger" type="button" disabled={busy} onClick={() => doDelete(goal.id)}>
                        מחק
                      </button>
                      <button className="activity-action" type="button" onClick={() => setConfirmDeleteId(null)}>
                        ביטול
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={goal.id} className={`coach-goal-row ${selectedId === goal.id ? "active" : ""}`}>
                    <button type="button" className="coach-goal-select" onClick={() => setSelectedId(goal.id)}>
                      <span dir="auto">{goal.title}</span>
                      {goal.status ? <Chip accent={goal.status === "active" ? "green" : "neutral"}>{goal.status}</Chip> : null}
                    </button>
                    <div className="coach-goal-actions">
                      <button className="icon-button small" type="button" aria-label="ערוך מטרה" onClick={() => startEdit(goal)}>
                        <Pencil size={14} />
                      </button>
                      <button className="icon-button small" type="button" aria-label="מחק מטרה" onClick={() => setConfirmDeleteId(goal.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              )}
              {visibleGoals.length === 0 ? <p className="empty-panel-copy">עדיין אין מטרות.</p> : null}
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

          <section className="cc-card cc-plan">
            <header className="cc-card-head">
              <h3>תוכנית</h3>
              {selectedGoal ? <span className="cc-plan-goal" dir="auto">{selectedGoal.title}</span> : null}
            </header>

            {!selectedId ? (
              <p className="empty-panel-copy">בחר מטרה כדי לראות את התוכנית.</p>
            ) : plan ? (
              <div className="cc-plan-body">
                <div className="cc-plan-overall">
                  <div className="cc-plan-pct-row">
                    <span className="cc-plan-pct-big">{plan.overall_percent}%</span>
                    {chip ? <Chip accent={chip.accent}>{chip.label}</Chip> : null}
                  </div>
                  <ProgressBar value={plan.overall_percent} accent={chip?.accent ?? "blue"} />
                  {nextStep ? (
                    <p className="coach-plan-next" dir="auto">
                      הצעד הבא: {nextStep.title}
                    </p>
                  ) : null}
                </div>

                {plan.drift ? (
                  <div className="cc-drift">
                    <div className="cc-drift-cell">
                      <span>צפוי</span>
                      <strong>{Math.round(plan.drift.expected_percent * 100)}%</strong>
                    </div>
                    <div className="cc-drift-cell">
                      <span>בפועל</span>
                      <strong>{Math.round(plan.drift.actual_percent * 100)}%</strong>
                    </div>
                    <div className="cc-drift-cell">
                      <span>סיום צפוי</span>
                      <strong>{plan.drift.projected_completion ? plan.drift.projected_completion.slice(0, 10) : "—"}</strong>
                    </div>
                  </div>
                ) : null}

                <div className="coach-step-list">
                  {plan.steps.map((step) => {
                    const unlinked = activities.filter((a) => !step.linked_activity_ids.includes(a.id));
                    return (
                      <div className="coach-step" key={step.id}>
                        <div className="coach-step-head">
                          <span dir="auto">{step.title}</span>
                          <Chip accent={stepAccent(step.progress.status)}>{step.progress.status}</Chip>
                        </div>
                        <ProgressBar value={Math.round(step.progress.ratio * 100)} accent={stepAccent(step.progress.status)} />
                        <div className="coach-step-foot">
                          <span className="coach-step-meta">
                            {step.progress.done}/{step.progress.target}
                          </span>
                          <button
                            className="coach-link-toggle"
                            type="button"
                            disabled={busy}
                            onClick={() => setLinkingStepId(linkingStepId === step.id ? null : step.id)}
                          >
                            <Link2 size={13} />
                            קשר פעילות
                          </button>
                        </div>

                        {step.linked_activity_ids.length ? (
                          <div className="coach-link-chips">
                            {step.linked_activity_ids.map((aid) => (
                              <span className="coach-link-chip" key={aid}>
                                <span dir="auto">{activityTitle(aid)}</span>
                                <button type="button" aria-label="בטל קישור" disabled={busy} onClick={() => doUnlink(step.id, aid)}>
                                  <X size={12} />
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : null}

                        {linkingStepId === step.id ? (
                          <div className="coach-link-picker">
                            {unlinked.length ? (
                              unlinked.slice(0, 8).map((a) => (
                                <button className="coach-link-option" type="button" key={a.id} disabled={busy} onClick={() => doLink(step.id, a.id)}>
                                  <Plus size={12} />
                                  <span dir="auto">{a.title}</span>
                                </button>
                              ))
                            ) : (
                              <span className="empty-panel-copy">אין פעילויות לקישור.</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : planMissing ? (
              <p className="empty-panel-copy">אין עדיין תוכנית למטרה זו.</p>
            ) : (
              <p className="empty-panel-copy">טוען…</p>
            )}

            {selectedId ? (
              <div className="cc-plan-actions">
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
            ) : null}
          </section>
        </div>
      </div>
    </Modal>
  );
}
