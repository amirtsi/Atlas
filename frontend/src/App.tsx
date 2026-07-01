import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Archive,
  BatteryCharging,
  BookOpen,
  Bug,
  CalendarClock,
  Check,
  CircleDot,
  ClipboardList,
  FlaskConical,
  GraduationCap,
  MessageCircle,
  FileClock,
  Gauge,
  History,
  Layers3,
  Pencil,
  Plus,
  Rocket,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  X,
  Zap
} from "lucide-react";
import {
  type Accent,
  type AuditEvent,
  type ActivityTemplate,
  type ActivityTemplatePayload,
  type ActivityUpdatePayload,
  type CreateActivityPayload,
  type CommunicationMessage,
  type CommunicationProvider,
  type DashboardResponse,
  type Discipline,
  type JournalActivity,
  type LifeModule,
  type ModuleBehavior,
  type ModulePayload,
  type ModuleUpdatePayload,
  type LearningOverview,
  type LearningUnitType,
  type ProjectItem,
  type ProjectItemType,
  type ProjectOverview,
  type QuickLogPayload,
  type WellbeingOverview,
  getWellbeingOverview,
  logWellbeingSession,
  completeLearningUnit,
  completeProjectItem,
  createLearningUnit,
  createProjectItem,
  deleteLearningUnit,
  deleteProjectItem,
  getLearningOverview,
  getProjectOverview,
  updateLearningUnit,
  updateProjectItem,
  createCommunicationProvider,
  createActivityTemplate,
  DEFAULT_WHATSAPP_RECIPIENT,
  DEFAULT_WHATSAPP_RECIPIENT_LOCAL,
  archiveModule,
  pauseModule,
  resumeModule,
  createActivity,
  createModule,
  deleteActivity,
  updateActivity,
  getActivities,
  getActivityTemplates,
  getAuditEvents,
  getCommunicationMessages,
  getCommunicationProviders,
  getDashboard,
  getDisciplines,
  getModuleBehavior,
  getModules,
  quickLog,
  sendCommunicationMessage,
  updateModule,
  updateModuleBehavior
} from "./api/atlas";
import { Chip, Modal, Panel, ProgressBar } from "./shared/ui";
import {
  accentColorVar,
  accentForSlug,
  disciplineLabel,
  formatActivityTime,
  formatDateKey,
  moduleStatusLabel,
  moduleTypeLabel,
  severityAccent,
  severityLabel,
  slugify,
  summaryNumber,
  toConfigNumber,
  toNumberDraft,
  toOptionalMinutes
} from "./shared/format";
import { ApiUnavailablePanel, NewsTile, QuoteStrip } from "./features/widgets";
import { DayQuickAdd, EditableActivityRow, JournalView } from "./features/journal";
import { ModuleEditCard, ModulesView, moduleTypes } from "./features/modules";
import { LifePulse, MissionCenter, LifeTimeline, DashboardCalendar, RightNowHero, CockpitModal, type CockpitModalKind } from "./features/dashboard";


function AuditView({ events }: { events: AuditEvent[] }) {
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

function CommunicationView({
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

function QuickLogSheet({
  isOpen,
  templates,
  modules,
  disciplines,
  isLogging,
  error,
  onClose,
  onTemplateLog,
  onCustomLog,
  onCreateTemplate
}: {
  isOpen: boolean;
  templates: ActivityTemplate[];
  modules: LifeModule[];
  disciplines: Discipline[];
  isLogging: boolean;
  error: string | null;
  onClose: () => void;
  onTemplateLog: (templateId: string) => void;
  onCustomLog: (payload: QuickLogPayload) => void;
  onCreateTemplate: (payload: ActivityTemplatePayload) => void;
}) {
  const [mode, setMode] = useState<"templates" | "custom" | "template">("templates");
  const [customTitle, setCustomTitle] = useState("");
  const [customModuleId, setCustomModuleId] = useState("");
  const [customDuration, setCustomDuration] = useState("30");
  const [customNotes, setCustomNotes] = useState("");
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateModuleId, setTemplateModuleId] = useState("");
  const [templateDuration, setTemplateDuration] = useState("30");

  if (!isOpen) {
    return null;
  }

  const selectedCustomModule = modules.find((module) => module.id === customModuleId);
  const selectedTemplateModule = modules.find((module) => module.id === templateModuleId);
  const fallbackDisciplineId = disciplines[0]?.id;

  function submitCustomLog(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = customTitle.trim();
    if (!title) {
      return;
    }
    onCustomLog({
      title,
      module_id: customModuleId || undefined,
      discipline_id: selectedCustomModule ? selectedCustomModule.discipline_id : fallbackDisciplineId,
      activity_type: selectedCustomModule?.type ?? "manual",
      duration_minutes: toOptionalMinutes(customDuration),
      notes: customNotes.trim() || undefined
    });
  }

  function submitTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = templateTitle.trim();
    if (!title) {
      return;
    }
    onCreateTemplate({
      title,
      module_id: templateModuleId || undefined,
      discipline_id: selectedTemplateModule ? selectedTemplateModule.discipline_id : fallbackDisciplineId,
      activity_type: selectedTemplateModule?.type ?? "manual",
      default_duration_minutes: toOptionalMinutes(templateDuration)
    });
    setTemplateTitle("");
  }

  return (
    <div className="quick-log-overlay" role="dialog" aria-modal="true" aria-label="Quick Log">
      <div className="quick-log-sheet">
        <header className="quick-log-header">
          <div>
            <span>Quick Log</span>
            <h2>מה סיימת עכשיו?</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close quick log">
            <X size={22} />
          </button>
        </header>

        <div className="quick-log-tabs" role="tablist" aria-label="Quick log modes">
          <button className={mode === "templates" ? "active" : ""} type="button" onClick={() => setMode("templates")}>
            קיצורים
          </button>
          <button className={mode === "custom" ? "active" : ""} type="button" onClick={() => setMode("custom")}>
            פעילות חופשית
          </button>
          <button className={mode === "template" ? "active" : ""} type="button" onClick={() => setMode("template")}>
            קיצור חדש
          </button>
        </div>

        {mode === "templates" ? (
          <div className="quick-log-grid">
            {templates.slice(0, 6).map((template) => (
              <button
                className="quick-template"
                key={template.id}
                type="button"
                disabled={isLogging}
                onClick={() => onTemplateLog(template.id)}
              >
                <strong>{template.title}</strong>
                <span>
                  {template.module_name ?? template.discipline_name ?? "Atlas"} · {template.default_duration_minutes ?? 0} ד׳
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {mode === "custom" ? (
          <form className="quick-log-form" onSubmit={submitCustomLog}>
            <label>
              <span>מה סיימת?</span>
              <input
                autoFocus
                value={customTitle}
                onChange={(event) => setCustomTitle(event.target.value)}
                placeholder="לדוגמה: Studied OSCP"
              />
            </label>
            <div className="form-row">
              <label>
                <span>Module</span>
                <select value={customModuleId} onChange={(event) => setCustomModuleId(event.target.value)}>
                  <option value="">Atlas / כללי</option>
                  {modules.map((module) => (
                    <option key={module.id} value={module.id}>
                      {module.name} · {moduleTypeLabel(module.type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>דקות</span>
                <input
                  inputMode="numeric"
                  min="1"
                  type="number"
                  value={customDuration}
                  onChange={(event) => setCustomDuration(event.target.value)}
                />
              </label>
            </div>
            <label>
              <span>Note</span>
              <textarea value={customNotes} onChange={(event) => setCustomNotes(event.target.value)} placeholder="אופציונלי" />
            </label>
            <button className="quick-submit" type="submit" disabled={isLogging || !customTitle.trim()}>
              רשום פעילות
            </button>
          </form>
        ) : null}

        {mode === "template" ? (
          <form className="quick-log-form" onSubmit={submitTemplate}>
            <label>
              <span>שם הקיצור</span>
              <input
                autoFocus
                value={templateTitle}
                onChange={(event) => setTemplateTitle(event.target.value)}
                placeholder="לדוגמה: Code review"
              />
            </label>
            <div className="form-row">
              <label>
                <span>Module</span>
                <select value={templateModuleId} onChange={(event) => setTemplateModuleId(event.target.value)}>
                  <option value="">Atlas / כללי</option>
                  {modules.map((module) => (
                    <option key={module.id} value={module.id}>
                      {module.name} · {moduleTypeLabel(module.type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>דקות ברירת מחדל</span>
                <input
                  inputMode="numeric"
                  min="1"
                  type="number"
                  value={templateDuration}
                  onChange={(event) => setTemplateDuration(event.target.value)}
                />
              </label>
            </div>
            <button className="quick-submit" type="submit" disabled={isLogging || !templateTitle.trim()}>
              צור קיצור
            </button>
          </form>
        ) : null}

        {error ? <p className="quick-log-error">{error}</p> : null}
      </div>
    </div>
  );
}

export function App() {
  const [view, setView] = useState<"dashboard" | "modules" | "journal" | "audit" | "communication">("dashboard");
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [templates, setTemplates] = useState<ActivityTemplate[]>([]);
  const [modules, setModules] = useState<LifeModule[]>([]);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [activities, setActivities] = useState<JournalActivity[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [communicationProviders, setCommunicationProviders] = useState<CommunicationProvider[]>([]);
  const [communicationMessages, setCommunicationMessages] = useState<CommunicationMessage[]>([]);
  const [isQuickLogOpen, setIsQuickLogOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<CockpitModalKind | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLogging, setIsLogging] = useState(false);
  const [isSavingModule, setIsSavingModule] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshDashboard() {
    const [nextDashboard, nextActivities, nextAuditEvents, nextCommunicationMessages] = await Promise.all([
      getDashboard(),
      getActivities(),
      getAuditEvents(),
      getCommunicationMessages()
    ]);
    setDashboard(nextDashboard);
    setActivities(nextActivities);
    setAuditEvents(nextAuditEvents);
    setCommunicationMessages(nextCommunicationMessages);
  }

  async function refreshModulesAndDashboard() {
    const [nextModules, nextDashboard, nextAuditEvents] = await Promise.all([getModules(), getDashboard(), getAuditEvents()]);
    setModules(nextModules);
    setDashboard(nextDashboard);
    setAuditEvents(nextAuditEvents);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [
          nextDashboard,
          nextTemplates,
          nextModules,
          nextDisciplines,
          nextActivities,
          nextAuditEvents,
          nextCommunicationProviders,
          nextCommunicationMessages
        ] = await Promise.all([
          getDashboard(),
          getActivityTemplates(),
          getModules(),
          getDisciplines(),
          getActivities(),
          getAuditEvents(),
          getCommunicationProviders(),
          getCommunicationMessages()
        ]);
        if (!active) {
          return;
        }
        setDashboard(nextDashboard);
        setTemplates(nextTemplates);
        setModules(nextModules);
        setDisciplines(nextDisciplines);
        setActivities(nextActivities);
        setAuditEvents(nextAuditEvents);
        setCommunicationProviders(nextCommunicationProviders);
        setCommunicationMessages(nextCommunicationMessages);
        setError(null);
      } catch {
        if (active) {
          setDashboard(null);
          setError("Atlas API is unavailable. No static cockpit is shown.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  async function handleQuickLog(payload: QuickLogPayload) {
    setIsLogging(true);
    setError(null);
    try {
      await quickLog(payload);
      await refreshDashboard();
      setIsQuickLogOpen(false);
    } catch {
      setError("לא הצלחתי לרשום פעילות. בדוק שה-backend רץ.");
    } finally {
      setIsLogging(false);
    }
  }

  async function handleUpdateActivity(id: string, payload: ActivityUpdatePayload) {
    setError(null);
    try {
      await updateActivity(id, payload);
      await refreshDashboard();
    } catch {
      setError("לא הצלחתי לעדכן את הפעולה.");
    }
  }

  async function handleDeleteActivity(id: string) {
    setError(null);
    try {
      await deleteActivity(id);
      await refreshDashboard();
    } catch {
      setError("לא הצלחתי למחוק את הפעולה.");
    }
  }

  async function handleAddActivity(payload: CreateActivityPayload) {
    setError(null);
    try {
      await createActivity(payload);
      await refreshDashboard();
    } catch {
      setError("לא הצלחתי להוסיף פעולה.");
    }
  }

  async function handleCreateTemplate(payload: ActivityTemplatePayload) {
    setIsLogging(true);
    setError(null);
    try {
      await createActivityTemplate(payload);
      const [nextTemplates, nextAuditEvents] = await Promise.all([getActivityTemplates(), getAuditEvents()]);
      setTemplates(nextTemplates);
      setAuditEvents(nextAuditEvents);
    } catch {
      setError("לא הצלחתי ליצור קיצור חדש.");
    } finally {
      setIsLogging(false);
    }
  }

  async function handleCreateModule(payload: ModulePayload) {
    setIsSavingModule(true);
    setError(null);
    try {
      await createModule(payload);
      await refreshModulesAndDashboard();
    } catch {
      setError("לא הצלחתי ליצור Module. בדוק שהשם לא קיים כבר.");
    } finally {
      setIsSavingModule(false);
    }
  }

  async function handleUpdateModule(moduleId: string, payload: ModuleUpdatePayload) {
    setIsSavingModule(true);
    setError(null);
    try {
      await updateModule(moduleId, payload);
      await refreshModulesAndDashboard();
    } catch {
      setError("לא הצלחתי לעדכן Module.");
    } finally {
      setIsSavingModule(false);
    }
  }

  async function handleModuleStatus(moduleId: string, action: "archive" | "pause" | "resume") {
    setIsSavingModule(true);
    setError(null);
    try {
      const call = action === "archive" ? archiveModule : action === "pause" ? pauseModule : resumeModule;
      await call(moduleId);
      await refreshModulesAndDashboard();
    } catch {
      setError("לא הצלחתי לעדכן את סטטוס ה־Module.");
    } finally {
      setIsSavingModule(false);
    }
  }

  async function handleCreateCommunicationProvider() {
    setIsSavingModule(true);
    setError(null);
    try {
      const provider = await createCommunicationProvider();
      setCommunicationProviders([provider]);
      setAuditEvents(await getAuditEvents());
    } catch {
      setError("לא הצלחתי ליצור Communication Provider.");
    } finally {
      setIsSavingModule(false);
    }
  }

  async function handleSendCommunicationMessage(providerId: string, recipient: string, content: string) {
    setIsSavingModule(true);
    setError(null);
    try {
      await sendCommunicationMessage(providerId, recipient, content);
      const [nextMessages, nextAuditEvents] = await Promise.all([getCommunicationMessages(), getAuditEvents()]);
      setCommunicationMessages(nextMessages);
      setAuditEvents(nextAuditEvents);
    } catch {
      setError("לא הצלחתי לשלוח הודעה דרך Communication Hub.");
    } finally {
      setIsSavingModule(false);
    }
  }

  const railItems = [
    { key: "dashboard" as const, label: "Dashboard", icon: <Gauge size={20} /> },
    { key: "journal" as const, label: "Journal", icon: <History size={20} /> },
    { key: "modules" as const, label: "Modules", icon: <ClipboardList size={20} /> },
    { key: "audit" as const, label: "Audit", icon: <ShieldCheck size={20} /> },
    { key: "communication" as const, label: "Comms", icon: <MessageCircle size={20} /> }
  ];
  const todayLabel = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const statusLabel = isLoading ? "מתחבר…" : error ? "שגיאת API" : "מחובר";

  return (
    <div className="app-shell">
      <nav className="rail" aria-label="ניווט ראשי">
        <div className="rail-mark" aria-hidden="true">A</div>

        <div className="rail-nav">
          {railItems.map((item) => (
            <button
              key={item.key}
              className={`rail-item ${view === item.key ? "active" : ""}`}
              type="button"
              aria-current={view === item.key ? "page" : undefined}
              onClick={() => setView(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <button className="rail-log" type="button" onClick={() => setIsQuickLogOpen(true)}>
          <Plus size={22} strokeWidth={2.6} />
          <span>רישום</span>
        </button>

        <div className={`rail-status ${error ? "warn" : ""}`} role="status" aria-live="polite">
          <span className="rail-dot" aria-hidden="true" />
          <span>{statusLabel}</span>
        </div>
      </nav>

      <main className="workspace">
        {view === "dashboard" ? (
          dashboard ? (
            <>
              <header className="workspace-head">
                <div>
                  <h1>היום</h1>
                  <p>{todayLabel}</p>
                </div>
                <span className="ws-northstar">
                  <Sparkles size={14} />
                  What is the best thing I should do right now?
                </span>
              </header>

              <QuoteStrip />

              <section className="bento" aria-label="Atlas dashboard">
                <RightNowHero
                  dashboard={dashboard}
                  onOpen={() => setActiveModal("chief")}
                  onQuickLog={() => setIsQuickLogOpen(true)}
                />
                <LifePulse dashboard={dashboard} onOpen={() => setActiveModal("pulse")} />
                <MissionCenter dashboard={dashboard} onOpen={() => setActiveModal("missions")} />
                <LifeTimeline dashboard={dashboard} onOpen={() => setActiveModal("today")} />
                <DashboardCalendar
                  activities={activities}
                  onOpenJournal={() => setView("journal")}
                  onOpen={() => setActiveModal("calendar")}
                />
                <NewsTile />
              </section>
            </>
          ) : (
            <ApiUnavailablePanel />
          )
        ) : null}

        {view === "journal" ? (
          <JournalView
            activities={activities}
            modules={modules}
            disciplines={disciplines}
            onUpdateActivity={handleUpdateActivity}
            onDeleteActivity={handleDeleteActivity}
            onAddActivity={handleAddActivity}
          />
        ) : null}

        {view === "audit" ? <AuditView events={auditEvents} /> : null}

        {view === "communication" ? (
          <CommunicationView
            providers={communicationProviders}
            messages={communicationMessages}
            isSaving={isSavingModule}
            onCreateProvider={handleCreateCommunicationProvider}
            onSendMessage={handleSendCommunicationMessage}
          />
        ) : null}

        {view === "modules" ? (
          <ModulesView
            modules={modules}
            disciplines={disciplines}
            isSaving={isSavingModule}
            onCreateModule={handleCreateModule}
            onUpdateModule={handleUpdateModule}
            onChanged={refreshModulesAndDashboard}
          />
        ) : null}
      </main>

      <QuickLogSheet
        isOpen={isQuickLogOpen}
        templates={templates}
        modules={modules}
        disciplines={disciplines}
        isLogging={isLogging}
        error={error}
        onClose={() => setIsQuickLogOpen(false)}
        onTemplateLog={(templateId) => handleQuickLog({ template_id: templateId })}
        onCustomLog={handleQuickLog}
        onCreateTemplate={handleCreateTemplate}
      />

      {activeModal ? (
        <CockpitModal
          kind={activeModal}
          dashboard={dashboard}
          activities={activities}
          modules={modules}
          disciplines={disciplines}
          isSaving={isSavingModule}
          onCreateModule={handleCreateModule}
          onUpdateModule={handleUpdateModule}
          onModuleStatus={handleModuleStatus}
          onUpdateActivity={handleUpdateActivity}
          onDeleteActivity={handleDeleteActivity}
          onAddActivity={handleAddActivity}
          onClose={() => setActiveModal(null)}
          onOpenJournal={() => {
            setActiveModal(null);
            setView("journal");
          }}
        />
      ) : null}
    </div>
  );
}
