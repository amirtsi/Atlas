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
