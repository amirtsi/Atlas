import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import { type Proposal, acceptProposal, dismissProposal, getProposals } from "../api/atlas";
import { Panel } from "../shared/ui";

export function CoachInbox({ onChanged }: { onChanged?: () => void }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);

  async function load() {
    try {
      setProposals(await getProposals("pending"));
    } catch {
      setProposals([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function resolve(id: string, action: "accept" | "dismiss") {
    if (action === "accept") {
      await acceptProposal(id);
    } else {
      await dismissProposal(id);
    }
    await load();
    onChanged?.();
  }

  return (
    <Panel title="Coach" eyebrow="Proposals — you approve" className="coach-inbox-panel">
      {proposals.length ? (
        <div className="coach-inbox-list">
          {proposals.slice(0, 4).map((proposal) => (
            <article className="coach-proposal" key={proposal.id}>
              <div className="coach-proposal-body">
                <strong dir="auto">{proposal.title}</strong>
                {proposal.rationale ? <p dir="auto">{proposal.rationale}</p> : null}
              </div>
              <div className="coach-proposal-actions">
                <button className="icon-button small" type="button" aria-label="אשר" onClick={() => resolve(proposal.id, "accept")}>
                  <Check size={15} />
                </button>
                <button className="icon-button small" type="button" aria-label="דחה" onClick={() => resolve(proposal.id, "dismiss")}>
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
