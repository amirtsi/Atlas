import { useEffect, useState } from "react";
import { Check, Inbox, Target, X } from "lucide-react";

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

// The Coach surface: pending proposals + the top active goal's plan state.
// variant="tile"  -> standalone dashboard Panel (legacy, still available).
// variant="aside" -> bare block for embedding in the unified command hero.
export function CoachInbox({
  onChanged,
  onOpen,
  variant = "tile"
}: {
  onChanged?: () => void;
  onOpen?: () => void;
  variant?: "tile" | "aside";
}) {
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
      setTopPlan(goals.length ? await getGoalPlan(goals[0].id) : null);
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
      await (action === "accept" ? acceptProposal(id) : dismissProposal(id));
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

  function proposalRow(proposal: Proposal) {
    return (
      <article className="coach-proposal" key={proposal.id}>
        <div className="coach-proposal-body">
          <strong dir="auto">{proposal.title}</strong>
          {proposal.rationale ? <p dir="auto">{proposal.rationale}</p> : null}
        </div>
        <div className="coach-proposal-actions">
          <button
            className="icon-button small"
            type="button"
            aria-label="אשר הצעה"
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
            aria-label="דחה הצעה"
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
    );
  }

  function planLine() {
    if (!topPlan) {
      return null;
    }
    return (
      <div className="coach-plan-line">
        <div className="coach-plan-topline">
          <span className="coach-plan-goal">
            <Target size={14} />
            <strong dir="auto">{topPlan.goal.title}</strong>
          </span>
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
    );
  }

  // --- Aside variant: bare block for the unified command hero ---------------
  if (variant === "aside") {
    return (
      <div className="hero-coach">
        {planLine()}
        <div className="hero-coach-inbox">
          <span className="hero-coach-label">
            <Inbox size={14} />
            {proposals.length ? `${proposals.length} הצעות ממתינות` : "המאמן"}
          </span>
          {loading ? (
            <p className="empty-panel-copy">טוען…</p>
          ) : proposals.length ? (
            <div className="coach-inbox-list">{proposals.slice(0, 2).map(proposalRow)}</div>
          ) : topPlan ? null : (
            <p className="empty-panel-copy">אין הצעות. המאמן יציע צעדים מנתונים אמיתיים.</p>
          )}
        </div>
      </div>
    );
  }

  // --- Tile variant (legacy standalone Panel) -------------------------------
  return (
    <Panel title="Coach" eyebrow="Proposals — you approve" className="coach-inbox-panel" onOpen={onOpen}>
      {loading ? (
        <p className="empty-panel-copy">טוען הצעות…</p>
      ) : error ? (
        <p className="empty-panel-copy">לא ניתן לטעון הצעות כרגע.</p>
      ) : proposals.length ? (
        <div className="coach-inbox-list">{proposals.slice(0, 3).map(proposalRow)}</div>
      ) : (
        <p className="empty-panel-copy">אין הצעות ממתינות. הקואוץ' יציע צעדים מתוך נתונים אמיתיים.</p>
      )}
      {planLine()}
    </Panel>
  );
}
