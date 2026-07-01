import { useEffect, useState } from "react";
import { ClipboardList, MessageCircle, Gauge, History, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { type AuditEvent, type ActivityTemplate, type ActivityTemplatePayload, type ActivityUpdatePayload, type CreateActivityPayload, type CommunicationMessage, type CommunicationProvider, type DashboardResponse, type Discipline, type JournalActivity, type LifeModule, type ModulePayload, type ModuleUpdatePayload, type QuickLogPayload, createCommunicationProvider, createActivityTemplate, archiveModule, pauseModule, resumeModule, createActivity, createModule, deleteActivity, updateActivity, getActivities, getActivityTemplates, getAuditEvents, getCommunicationMessages, getCommunicationProviders, getDashboard, getDisciplines, getModules, quickLog, sendCommunicationMessage, updateModule } from "./api/atlas";
import { ApiUnavailablePanel, NewsTile, QuoteStrip } from "./features/widgets";
import { JournalView } from "./features/journal";
import { ModulesView } from "./features/modules";
import { LifePulse, MissionCenter, LifeTimeline, DashboardCalendar, RightNowHero, CockpitModal, type CockpitModalKind } from "./features/dashboard";
import { AuditView } from "./features/audit";
import { CommunicationView } from "./features/communication";
import { QuickLogSheet } from "./features/quick-log";
import { CoachInbox } from "./features/coach-inbox";


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
                <CoachInbox onChanged={refreshDashboard} />
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
