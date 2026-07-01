import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { type CommunicationMessage, type CommunicationProvider, DEFAULT_WHATSAPP_RECIPIENT, DEFAULT_WHATSAPP_RECIPIENT_LOCAL } from "../api/atlas";
import { Chip } from "../shared/ui";
import { formatActivityTime } from "../shared/format";

export function CommunicationView({
  providers,
  messages,
  isSaving,
  onCreateProvider,
  onSendMessage
}: {
  providers: CommunicationProvider[];
  messages: CommunicationMessage[];
  isSaving: boolean;
  onCreateProvider: () => void;
  onSendMessage: (providerId: string, recipient: string, content: string) => void;
}) {
  const [recipient, setRecipient] = useState(DEFAULT_WHATSAPP_RECIPIENT);
  const [content, setContent] = useState("Atlas test message");
  const provider = providers[0];
  const providerDefaultRecipient =
    typeof provider?.config?.default_recipient === "string" ? provider.config.default_recipient : DEFAULT_WHATSAPP_RECIPIENT;

  useEffect(() => {
    setRecipient((current) => {
      if (!current.trim() || current === DEFAULT_WHATSAPP_RECIPIENT) {
        return providerDefaultRecipient;
      }
      return current;
    });
  }, [providerDefaultRecipient]);

  function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider || !recipient.trim() || !content.trim()) {
      return;
    }
    onSendMessage(provider.id, recipient.trim(), content.trim());
  }

  return (
    <section className="ledger-view" aria-label="Communication Hub">
      <div className="modules-hero">
        <div>
          <span>Communication Hub</span>
          <h2>Communication Providers</h2>
          <p>Atlas מדבר דרך providers. כרגע המימוש הראשון הוא Evolution Provider עבור WhatsApp, אבל הליבה נשארת גנרית.</p>
        </div>
        <div className="module-count">
          <strong>{providers.length}</strong>
          <span>providers</span>
        </div>
      </div>

      <div className="communication-layout">
        <section className="panel">
          <div className="panel-content communication-card">
            <header className="panel-header">
              <div>
                <span className="panel-eyebrow">Provider</span>
                <h2>{provider ? provider.name : "Evolution Provider"}</h2>
              </div>
              <div className="panel-icon">
                <MessageCircle size={21} />
              </div>
            </header>

            {provider ? (
              <div className="provider-summary">
                <Chip accent="green">{provider.channel}</Chip>
                <Chip accent="blue">{provider.type}</Chip>
                <Chip accent="orange">{provider.config?.dry_run === true ? "dry-run" : "live"}</Chip>
                <Chip accent="purple">{DEFAULT_WHATSAPP_RECIPIENT_LOCAL}</Chip>
              </div>
            ) : (
              <button className="quick-submit" type="button" disabled={isSaving} onClick={onCreateProvider}>
                צור Evolution Provider
              </button>
            )}

            {provider ? (
              <form className="quick-log-form" onSubmit={submitMessage}>
                <label>
                  <span>Recipient</span>
                  <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={DEFAULT_WHATSAPP_RECIPIENT} />
                  <small>WhatsApp target: {DEFAULT_WHATSAPP_RECIPIENT_LOCAL}</small>
                </label>
                <label>
                  <span>Message</span>
                  <textarea value={content} onChange={(event) => setContent(event.target.value)} />
                </label>
                <button className="quick-submit" type="submit" disabled={isSaving || !recipient.trim() || !content.trim()}>
                  שלח דרך provider
                </button>
              </form>
            ) : null}
          </div>
        </section>

        <div className="ledger-list">
          {messages.map((message) => (
            <article className="ledger-row" key={message.id}>
              <div className="ledger-time">
                <strong>{formatActivityTime(message.created_at)}</strong>
                <span>{message.status}</span>
              </div>
              <div className="ledger-main">
                <div className="timeline-title-row">
                  <h3>{message.direction === "inbound" ? message.sender : message.recipient}</h3>
                  <Chip accent={message.direction === "inbound" ? "purple" : "blue"}>{message.direction}</Chip>
                </div>
                <p>{message.content_text}</p>
                {message.error ? <small>{message.error}</small> : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
