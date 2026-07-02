import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, MessageCircle, QrCode, RefreshCw, Send } from "lucide-react";
import {
  type CommunicationMessage,
  type CommunicationProvider,
  type DailyBriefSchedule,
  type WhatsAppQr,
  type WhatsAppStatus,
  DEFAULT_WHATSAPP_RECIPIENT,
  DEFAULT_WHATSAPP_RECIPIENT_LOCAL,
  getDailyBriefSchedule,
  getWhatsAppStatus,
  requestWhatsAppQr
} from "../api/atlas";
import { Chip } from "../shared/ui";
import { formatActivityTime } from "../shared/format";

// Raw transport errors -> plain language the owner can act on.
function humanizeError(error: string | null | undefined): string | null {
  if (!error) {
    return null;
  }
  if (error.includes("Connection refused") || error.includes("urlopen")) {
    return "הגשר של WhatsApp לא היה פעיל כשההודעה נשלחה — היא לא יצאה. ודא שהגשר רץ ונסה שוב.";
  }
  return error;
}

type HubState = "connected" | "needs_scan" | "bridge_down" | "unconfigured" | "loading";

function hubState(status: WhatsAppStatus | null): HubState {
  if (!status) {
    return "loading";
  }
  if (!status.configured || status.bridge === "unconfigured") {
    return "unconfigured";
  }
  if (status.bridge === "down") {
    return "bridge_down";
  }
  return status.session === "open" ? "connected" : "needs_scan";
}

const STATE_LABEL: Record<HubState, { label: string; accent: "green" | "orange" | "red" | "neutral" }> = {
  connected: { label: "מחובר", accent: "green" },
  needs_scan: { label: "דורש סריקת QR", accent: "orange" },
  bridge_down: { label: "הגשר כבוי", accent: "red" },
  unconfigured: { label: "לא מוגדר", accent: "neutral" },
  loading: { label: "בודק…", accent: "neutral" }
};

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
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [qr, setQr] = useState<WhatsAppQr | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [schedule, setSchedule] = useState<DailyBriefSchedule | null>(null);
  const pollRef = useRef<number | null>(null);

  const provider = providers[0];
  const providerDefaultRecipient =
    typeof provider?.config?.default_recipient === "string" ? provider.config.default_recipient : DEFAULT_WHATSAPP_RECIPIENT;
  const state = hubState(status);
  const stateMeta = STATE_LABEL[state];

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getWhatsAppStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    getDailyBriefSchedule().then(setSchedule).catch(() => setSchedule(null));
  }, [refreshStatus]);

  // While a QR is on screen, poll until the phone links, then clear it.
  useEffect(() => {
    if (!qr?.qr_base64) {
      return;
    }
    pollRef.current = window.setInterval(refreshStatus, 4000);
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
      }
    };
  }, [qr, refreshStatus]);

  useEffect(() => {
    if (state === "connected" && qr) {
      setQr(null);
    }
  }, [state, qr]);

  useEffect(() => {
    setRecipient((current) => {
      if (!current.trim() || current === DEFAULT_WHATSAPP_RECIPIENT) {
        return providerDefaultRecipient;
      }
      return current;
    });
  }, [providerDefaultRecipient]);

  async function showQr() {
    setQrBusy(true);
    try {
      setQr(await requestWhatsAppQr());
    } catch {
      setQr({ qr_base64: null, pairing_code: null, error: "לא ניתן לבקש קוד QR כרגע." });
    } finally {
      setQrBusy(false);
    }
  }

  function submitMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider || !recipient.trim() || !content.trim()) {
      return;
    }
    onSendMessage(provider.id, recipient.trim(), content.trim());
    window.setTimeout(refreshStatus, 800);
  }

  return (
    <section className="ledger-view" aria-label="WhatsApp Hub">
      <div className="modules-hero">
        <div>
          <span>Communication</span>
          <h2>WhatsApp</h2>
          <p>אטלס מדבר איתך ב-WhatsApp: שולח לך תדרוך יומי, ואתה כותב לו — הוא רושם פעילויות ועונה על שאלות.</p>
        </div>
        <div className={`wa-state wa-state-${stateMeta.accent}`} role="status" aria-live="polite">
          <span className="wa-state-dot" aria-hidden="true" />
          <strong>{stateMeta.label}</strong>
        </div>
      </div>

      <div className="wa-grid">
        <section className="panel">
          <div className="panel-content wa-card">
            <header className="panel-header">
              <div>
                <span className="panel-eyebrow">חיבור</span>
                <h2>מצב הקו</h2>
              </div>
              <div className="panel-icon">
                <MessageCircle size={21} />
              </div>
            </header>

            {state === "connected" ? (
              <p className="wa-explain">
                ✅ הכול מחובר. המספר המקושר: <strong dir="ltr">{DEFAULT_WHATSAPP_RECIPIENT_LOCAL}</strong>. אפשר לכתוב
                ל-Atlas ב-WhatsApp והוא יגיב.
              </p>
            ) : null}

            {state === "needs_scan" ? (
              <div className="wa-connect">
                <p className="wa-explain">
                  📷 הגשר פעיל אבל WhatsApp לא מקושר. סרוק קוד QR מהטלפון:
                  <br />
                  <small>WhatsApp ← הגדרות ← מכשירים מקושרים ← קישור מכשיר</small>
                </p>
                {qr?.qr_base64 ? (
                  <img className="wa-qr" src={qr.qr_base64} alt="קוד QR לקישור WhatsApp" />
                ) : qr?.error ? (
                  <p className="quick-log-error">{qr.error}</p>
                ) : null}
                <button className="quick-submit" type="button" disabled={qrBusy} onClick={showQr}>
                  {qr?.qr_base64 ? (
                    <>
                      <RefreshCw size={16} /> רענן קוד (פג תוך ~40 שניות)
                    </>
                  ) : (
                    <>
                      <QrCode size={16} /> הצג קוד QR לסריקה
                    </>
                  )}
                </button>
              </div>
            ) : null}

            {state === "bridge_down" ? (
              <p className="wa-explain">
                🔴 הגשר (Evolution) לא רץ על המחשב, אז הודעות לא יכולות לצאת או להיכנס. בדרך כלל זה אומר ש-Docker כבוי.
                <br />
                <small dir="ltr">
                  colima start && docker compose -f docker-compose.evolution.yml --env-file .env.evolution up -d
                </small>
              </p>
            ) : null}

            {state === "unconfigured" ? (
              <div className="wa-connect">
                <p className="wa-explain">
                  ⚙️ עדיין אין חיבור מוגדר ל-WhatsApp. ראה <code>docs/whatsapp-two-way-setup.md</code> להקמה.
                </p>
                {!provider ? (
                  <button className="quick-submit" type="button" disabled={isSaving} onClick={onCreateProvider}>
                    צור חיבור WhatsApp
                  </button>
                ) : null}
              </div>
            ) : null}

            {status?.dry_run && state !== "unconfigured" ? (
              <p className="wa-explain">
                <Chip accent="orange">dry-run</Chip> מצב תרגול — הודעות לא באמת נשלחות.
              </p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-content wa-card">
            <header className="panel-header">
              <div>
                <span className="panel-eyebrow">איך זה עובד</span>
                <h2>Atlas ↔ WhatsApp</h2>
              </div>
            </header>
            <div className="wa-how">
              <div>
                <h3>
                  <ArrowUpFromLine size={14} /> אתה כותב ל-Atlas
                </h3>
                <ul>
                  <li>"רצתי 30 דקות" → נרשמת פעילות אמיתית ביומן</li>
                  <li>שאלה ("מה הסטטוס שלי השבוע?") → המאמן עונה</li>
                </ul>
              </div>
              <div>
                <h3>
                  <ArrowDownToLine size={14} /> Atlas כותב לך
                </h3>
                <ul>
                  <li>☀️ תדרוך יומי {schedule?.enabled ? `ב-${schedule.time}` : ""} — ההמלצה, הנתונים והצעד הבא בתוכנית</li>
                  <li>✅ אישור על כל פעילות שנקלטה מהודעה שלך</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="wa-grid">
        <section className="panel">
          <div className="panel-content wa-card">
            <header className="panel-header">
              <div>
                <span className="panel-eyebrow">בדיקה</span>
                <h2>שלח הודעת בדיקה</h2>
              </div>
              <div className="panel-icon">
                <Send size={19} />
              </div>
            </header>
            {provider ? (
              <form className="quick-log-form" onSubmit={submitMessage}>
                <label>
                  <span>אל מספר</span>
                  <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder={DEFAULT_WHATSAPP_RECIPIENT} />
                </label>
                <label>
                  <span>הודעה</span>
                  <textarea value={content} onChange={(event) => setContent(event.target.value)} />
                </label>
                <button className="quick-submit" type="submit" disabled={isSaving || !recipient.trim() || !content.trim()}>
                  שלח ב-WhatsApp
                </button>
              </form>
            ) : (
              <p className="wa-explain">אין חיבור פעיל.</p>
            )}
          </div>
        </section>

        <div className="ledger-list wa-conversation" aria-label="השיחה עם Atlas">
          <h3 className="wa-conversation-title">השיחה שלך עם Atlas</h3>
          {messages.length ? (
            messages.map((message) => (
              <article className="ledger-row" key={message.id}>
                <div className="ledger-time">
                  <strong>{formatActivityTime(message.created_at)}</strong>
                  <span>{message.status}</span>
                </div>
                <div className="ledger-main">
                  <div className="timeline-title-row">
                    <h3>{message.direction === "inbound" ? "אתה → Atlas" : "Atlas → אתה"}</h3>
                    <Chip accent={message.direction === "inbound" ? "purple" : "blue"}>{message.direction === "inbound" ? "נכנס" : "יוצא"}</Chip>
                  </div>
                  <p dir="auto">{message.content_text}</p>
                  {humanizeError(message.error) ? <small className="wa-error">{humanizeError(message.error)}</small> : null}
                </div>
              </article>
            ))
          ) : (
            <p className="empty-panel-copy">עדיין אין הודעות בינך ל-Atlas. שלח הודעת בדיקה או כתוב ל-Atlas ב-WhatsApp.</p>
          )}
        </div>
      </div>
    </section>
  );
}
