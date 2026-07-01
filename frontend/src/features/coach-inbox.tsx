import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import { type Proposal, acceptProposal, dismissProposal, getProposals } from "../api/atlas";
import { Panel } from "../shared/ui";

export function CoachInbox({ onChanged }: { onChanged?: () => void }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
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

  return (
    <Panel title="Coach" eyebrow="Proposals — you approve" className="coach-inbox-panel">
      {loading ? (
        <p className="empty-panel-copy">טוען הצעות…</p>
      ) : error ? (
        <p className="empty-panel-copy">לא ניתן לטעון הצעות כרגע.</p>
      ) : proposals.length ? (
        <div className="coach-inbox-list">
          {proposals.slice(0, 4).map((proposal) => (
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
                  onClick={() => resolve(proposal.id, "accept")}
                >
                  <Check size={15} />
                </button>
                <button
                  className="icon-button small"
                  type="button"
                  aria-label="דחה"
                  disabled={resolving === proposal.id}
                  onClick={() => resolve(proposal.id, "dismiss")}
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
    </Panel>
  );
}
