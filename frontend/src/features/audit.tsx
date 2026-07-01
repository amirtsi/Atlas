import { type AuditEvent } from "../api/atlas";
import { Chip } from "../shared/ui";
import { formatActivityTime } from "../shared/format";

export function AuditView({ events }: { events: AuditEvent[] }) {
  return (
    <section className="ledger-view" aria-label="Audit trail">
      <div className="modules-hero">
        <div>
          <span>Audit Trail</span>
          <h2>Audit</h2>
          <p>כל שינוי משמעותי במערכת נרשם כאן: פעילויות, מודולים, shortcuts ו־behavior. זה לא יומן חיים, זה יומן מערכת.</p>
        </div>
        <div className="module-count">
          <strong>{events.length}</strong>
          <span>events</span>
        </div>
      </div>

      <div className="ledger-list">
        {events.map((event) => (
          <article className="ledger-row audit-row" key={event.id}>
            <div className="ledger-time">
              <strong>{formatActivityTime(event.created_at)}</strong>
              <span>{new Date(event.created_at).toLocaleDateString("he-IL")}</span>
            </div>
            <div className="ledger-main">
              <div className="timeline-title-row">
                <h3>{event.summary}</h3>
                <Chip accent="neutral">{event.action}</Chip>
              </div>
              <p>
                {event.entity_type} · {event.actor}
              </p>
              <small>{Object.keys(event.changes ?? {}).slice(0, 6).join(", ") || "no change payload"}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
