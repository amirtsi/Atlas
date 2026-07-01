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


function WelcomePanel({ dashboard, onOpen }: { dashboard: DashboardResponse | null; onOpen: () => void }) {
  const recommendation = dashboard?.recommendations[0];
  const signals = dashboard?.real_signals;

  return (
    <Panel title="קוקפיט היום" eyebrow="Real signals only" icon={<Gauge size={21} />} className="welcome-panel" onOpen={onOpen}>
      <p className="decision-text">
        {recommendation ? (
          <>
            <span>הדבר הכי נכון עכשיו</span>
            <strong dir="auto">{recommendation.title}</strong>
          </>
        ) : (
          "רשום פעולה אחת אמיתית כדי לתת ל־Atlas signal."
        )}
      </p>

      <div className="welcome-grid">
        <div className="signal-card">
          <Activity size={18} />
          <span>היום</span>
          <strong>{signals ? `${signals.today_activity_count} פעולות` : "אין נתון"}</strong>
        </div>
        <div className="signal-card">
          <Target size={18} />
          <span>זמן שנרשם</span>
          <strong>{signals ? `${signals.today_duration_minutes} דק׳` : "אין נתון"}</strong>
        </div>
        <div className="signal-card">
          <CalendarClock size={18} />
          <span>השבוע</span>
          <strong>{signals ? `${signals.week_activity_count} / ${signals.week_duration_minutes} דק׳` : "אין נתון"}</strong>
        </div>
        <div className="signal-card">
          <Layers3 size={18} />
          <span>מודולים פעילים</span>
          <strong>{signals ? signals.active_module_count : 0}</strong>
        </div>
        <div className="signal-card wide">
          <FileClock size={18} />
          <span>פעולה אחרונה</span>
          <strong dir="auto">{signals?.last_activity_title ?? "אין פעילות עדיין"}</strong>
        </div>
      </div>
    </Panel>
  );
}

function LifePulse({ dashboard, onOpen }: { dashboard: DashboardResponse | null; onOpen: () => void }) {
  const { bars, ringStyle, average } = useMemo(() => {
    const items = dashboard?.weekly_balance ?? [];
    if (!items.length) {
      return { bars: [], ringStyle: undefined as React.CSSProperties | undefined, average: 0 };
    }

    const ranked = items.slice(0, 6);
    const maxDuration = Math.max(...ranked.map((item) => item.duration_minutes), 1);
    const totalDuration = ranked.reduce((sum, item) => sum + item.duration_minutes, 0);

    const nextBars = ranked.map((item) => ({
      key: item.discipline_slug ?? item.discipline_id,
      label: disciplineLabel(item.discipline_slug, item.discipline_name),
      score: Math.max(8, Math.round((item.duration_minutes / maxDuration) * 100)),
      share: totalDuration ? item.duration_minutes / totalDuration : 0,
      accent: accentForSlug(item.discipline_slug)
    }));

    const nextAverage = nextBars.length
      ? Math.round(nextBars.reduce((sum, item) => sum + item.score, 0) / nextBars.length)
      : 0;

    let cursor = 0;
    const stops = totalDuration
      ? nextBars.map((bar) => {
          const start = cursor * 360;
          cursor += bar.share;
          const end = cursor * 360;
          return `${accentColorVar[bar.accent]} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
        })
      : [];

    const nextRingStyle: React.CSSProperties | undefined = stops.length
      ? {
          background: `radial-gradient(circle at center, var(--bg-2) 0 63%, transparent 64%), conic-gradient(${stops.join(", ")})`
        }
      : undefined;

    return { bars: nextBars, ringStyle: nextRingStyle, average: nextAverage };
  }, [dashboard]);

  const hasData = bars.length > 0;

  return (
    <Panel title="Life Pulse" eyebrow="Weekly balance" icon={<CircleDot size={21} />} className="life-pulse-panel" onOpen={onOpen}>
      <div className="pulse-stage" aria-label="איזון שבועי בין תחומי החיים">
        <div className="pulse-dial">
          <div className="pulse-aura" aria-hidden="true" />
          <div className={`pulse-ring ${hasData ? "" : "is-empty"}`} style={ringStyle} aria-hidden="true" />
          <div className="pulse-core">
            <span>Balance</span>
            <strong>{average}%</strong>
            <small>{dashboard ? "Live weekly signal" : "No API signal"}</small>
          </div>
        </div>

        {hasData ? (
          <div className="pulse-legend">
            {bars.map((bar) => (
              <div className="pulse-bar-row" key={bar.key}>
                <div className="pulse-bar-head">
                  <span className="pulse-bar-label">{bar.label}</span>
                  <strong className="pulse-bar-score">{bar.score}</strong>
                </div>
                <div className="pulse-bar-track">
                  <div className={`pulse-bar-fill bar-${bar.accent}`} style={{ width: `${bar.score}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-panel-copy">אין נתוני שבוע חיים עדיין. רשום פעולה כדי לראות איזון בין התחומים.</p>
        )}
      </div>
    </Panel>
  );
}

function MissionCenter({ dashboard, onOpen }: { dashboard: DashboardResponse | null; onOpen: () => void }) {
  const missions = useMemo(() => {
    if (!dashboard?.active_modules.length) {
      return [];
    }

    return dashboard.active_modules.slice(0, 2).map((module) => {
      const summary = module.behavior?.summary ?? {};
      const progress = summaryNumber(summary, "progress_percent", 0);
      const nextActionByType: Record<string, string> = {
        project: `${summaryNumber(summary, "total_open")} פתוחים · ${summaryNumber(summary, "total_done")} הושלמו`,
        habit: `${summaryNumber(summary, "weekly_completions")}/${summaryNumber(summary, "weekly_target", 3)} השבוע · רצף ${summaryNumber(summary, "streak_days")}`,
        learning: `${summaryNumber(summary, "study_minutes")} דקות השבוע · ${summaryNumber(summary, "learning_units_done")}/${summaryNumber(summary, "learning_units_total")} יחידות`,
        recovery: `${summaryNumber(summary, "sessions_week")} מפגשים השבוע`,
        relationship: `${summaryNumber(summary, "sessions_week")} מפגשי זמן איכות`
      };
      return {
        name: module.name,
        status: module.status === "active" ? "פעיל" : module.status,
        progress,
        nextAction: nextActionByType[module.type] ?? "לרשום פעולה אחת",
        accent: accentForSlug(module.discipline_slug)
      };
    });
  }, [dashboard]);

  return (
    <Panel title="Mission Center" eyebrow="3-5 modules only" icon={<Layers3 size={21} />} className="mission-panel" onOpen={onOpen}>
      <div className="mission-list">
        {missions.length ? (
          missions.map((module) => (
            <article className="mission-card" key={module.name}>
              <div className="mission-topline">
                <strong>{module.name}</strong>
                <Chip accent={module.accent}>{module.status}</Chip>
              </div>
              <ProgressBar value={module.progress} accent={module.accent} />
              <div className="next-action">
                <Zap size={15} />
                <span>{module.nextAction}</span>
              </div>
            </article>
          ))
        ) : (
          <p className="empty-panel-copy">אין modules חיים להצגה.</p>
        )}
      </div>
    </Panel>
  );
}

function LifeTimeline({ dashboard, onOpen }: { dashboard: DashboardResponse | null; onOpen: () => void }) {
  const timeline = useMemo(() => {
    if (!dashboard?.recent_activities.length) {
      return [];
    }

    return dashboard.recent_activities.slice(0, 3).map((activity) => ({
      time: formatActivityTime(activity.occurred_at),
      title: activity.title,
      discipline: disciplineLabel(activity.discipline_slug, activity.discipline_name),
      detail: `${activity.duration_minutes ?? 0} דקות · ${activity.module_name ?? activity.activity_type}`,
      accent: accentForSlug(activity.discipline_slug)
    }));
  }, [dashboard]);

  return (
    <Panel title="Life Timeline" eyebrow="Completed real actions" icon={<History size={21} />} className="timeline-panel" onOpen={onOpen}>
      <div className="timeline-list">
        {timeline.length ? (
          timeline.map((activity) => (
            <article className="timeline-item" key={`${activity.time}-${activity.title}`}>
              <div className="timeline-time">{activity.time}</div>
              <div className={`timeline-dot dot-${activity.accent}`} />
              <div>
                <div className="timeline-title-row">
                  <strong>{activity.title}</strong>
                  <Chip accent={activity.accent}>{activity.discipline}</Chip>
                </div>
                <p>{activity.detail}</p>
              </div>
            </article>
          ))
        ) : (
          <p className="empty-panel-copy">אין פעילויות אמיתיות להצגה.</p>
        )}
      </div>
    </Panel>
  );
}

function DashboardCalendar({
  activities,
  onOpenJournal,
  onOpen
}: {
  activities: JournalActivity[];
  onOpenJournal: () => void;
  onOpen: () => void;
}) {
  const [selectedDateKey, setSelectedDateKey] = useState(() => formatDateKey(new Date()));
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    return day;
  });
  const activitiesByDay = activities.reduce<Record<string, JournalActivity[]>>((groups, activity) => {
    const key = formatDateKey(new Date(activity.occurred_at));
    groups[key] = [...(groups[key] ?? []), activity];
    return groups;
  }, {});
  const selectedActivities = activitiesByDay[selectedDateKey] ?? [];
  const selectedMinutes = selectedActivities.reduce((sum, activity) => sum + (activity.duration_minutes ?? 0), 0);
  const selectedDate = new Date(selectedDateKey);
  const selectedLabel = Number.isNaN(selectedDate.getTime())
    ? "היום"
    : new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "short" }).format(selectedDate);

  return (
    <Panel title="יומן / לוח שנה" eyebrow="Live activity calendar" icon={<CalendarClock size={21} />} className="dashboard-calendar-panel" onOpen={onOpen}>
      <div className="dashboard-calendar-summary">
        <div>
          <span>{selectedLabel}</span>
          <strong>{selectedActivities.length} פעולות</strong>
        </div>
        <Chip accent={selectedActivities.length ? "blue" : "neutral"}>{selectedMinutes} דק׳</Chip>
      </div>

      <div className="dashboard-calendar-days" aria-label="Current week calendar">
        {weekDays.map((day) => {
          const key = formatDateKey(day);
          const dayActivities = activitiesByDay[key] ?? [];
          const isToday = key === formatDateKey(today);
          const isSelected = key === selectedDateKey;
          return (
            <button
              className={`dashboard-calendar-day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""} ${dayActivities.length ? "has-activity" : ""}`}
              key={key}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setSelectedDateKey(key);
              }}
            >
              <span>{new Intl.DateTimeFormat("he-IL", { weekday: "short" }).format(day)}</span>
              <strong>{day.getDate()}</strong>
              <small>{dayActivities.length || ""}</small>
            </button>
          );
        })}
      </div>

      <div className="dashboard-agenda-list">
        {selectedActivities.length ? (
          selectedActivities.slice(0, 2).map((activity) => (
            <article className="dashboard-agenda-item" key={activity.id}>
              <div>
                <strong>{activity.title}</strong>
                <span>
                  {formatActivityTime(activity.occurred_at)} · {activity.module_name ?? activity.activity_type} · {activity.duration_minutes ?? 0} דק׳
                </span>
              </div>
              <Chip accent={accentForSlug(activity.discipline_slug)}>{disciplineLabel(activity.discipline_slug, activity.discipline_name)}</Chip>
            </article>
          ))
        ) : (
          <p className="empty-panel-copy">אין פעילויות ביום הזה. Quick Log ייצור כאן יומן אמיתי.</p>
        )}
      </div>

      <button
        className="dashboard-calendar-open"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpenJournal();
        }}
      >
        <History size={16} />
        פתח יומן מלא
      </button>
    </Panel>
  );
}

function ChiefOfStaff({ dashboard, onOpen }: { dashboard: DashboardResponse | null; onOpen: () => void }) {
  const recommendation = dashboard?.recommendations[0];
  const chief = {
    signal: recommendation ? "Live life balance signal" : "No recommendation yet",
    title: recommendation?.title ?? "אין המלצה חיה",
    body: recommendation?.body ?? "Atlas צריך חיבור API ופעילות אמיתית כדי להמליץ על הצעד הבא."
  };

  return (
    <Panel title="Chief of Staff" eyebrow={chief.signal} className="chief-panel" onOpen={onOpen}>
      <div className="ai-core-wrap" aria-hidden="true">
        <div className="ai-core">
          <div className="ai-core-inner" />
        </div>
      </div>

      <div className="recommendation-copy">
        {recommendation ? <Chip accent={severityAccent(recommendation.severity)}>{severityLabel(recommendation.severity)}</Chip> : null}
        <h3 dir="auto">{chief.title}</h3>
        <p dir="auto">{chief.body}</p>
      </div>
    </Panel>
  );
}

function RightNowHero({
  dashboard,
  onOpen,
  onQuickLog
}: {
  dashboard: DashboardResponse | null;
  onOpen: () => void;
  onQuickLog: () => void;
}) {
  const recommendation = dashboard?.recommendations[0];
  const signals = dashboard?.real_signals;

  return (
    <section
      className="panel panel-interactive tile-hero"
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label="מה הכי נכון עכשיו — הצג המלצות"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="panel-content hero-content">
        <header className="hero-head">
          <span className="hero-eyebrow">
            <Sparkles size={15} />
            מה הכי נכון לעשות עכשיו?
          </span>
          {recommendation ? <Chip accent={severityAccent(recommendation.severity)}>{severityLabel(recommendation.severity)}</Chip> : null}
        </header>

        <div className="hero-body">
          <h2 dir="auto">{recommendation ? recommendation.title : "רשום פעולה אחת אמיתית כדי לתת ל־Atlas signal"}</h2>
          <p dir="auto">
            {recommendation
              ? recommendation.body
              : "Atlas ימליץ על הצעד הבא מתוך פעילות אמיתית ואיזון בין התחומים."}
          </p>
        </div>

        <div className="hero-actions">
          <button
            className="btn-primary"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onQuickLog();
            }}
          >
            <Plus size={18} strokeWidth={2.6} />
            רישום מהיר
          </button>
          <button
            className="btn-ghost"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            כל ההמלצות
          </button>
        </div>

        <div className="hero-stats">
          <div>
            <span>היום</span>
            <strong>
              {signals?.today_activity_count ?? 0} · {signals?.today_duration_minutes ?? 0}ד׳
            </strong>
          </div>
          <div>
            <span>השבוע</span>
            <strong>
              {signals?.week_activity_count ?? 0} · {signals?.week_duration_minutes ?? 0}ד׳
            </strong>
          </div>
          <div>
            <span>מודולים</span>
            <strong>{signals?.active_module_count ?? 0}</strong>
          </div>
          <div>
            <span>אחרון</span>
            <strong dir="auto" className="hero-stat-ellipsis">{signals?.last_activity_title ?? "—"}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

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

type CockpitModalKind = "today" | "pulse" | "missions" | "chief" | "calendar";

function MissionCenterModal({
  modules,
  disciplines,
  isSaving,
  onCreateModule,
  onUpdateModule,
  onModuleStatus,
  onClose
}: {
  modules: LifeModule[];
  disciplines: Discipline[];
  isSaving: boolean;
  onCreateModule: (payload: ModulePayload) => void;
  onUpdateModule: (id: string, payload: ModuleUpdatePayload) => void;
  onModuleStatus: (id: string, action: "archive" | "pause" | "resume") => void;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof moduleTypes)[number]>("project");
  const [disciplineId, setDisciplineId] = useState("");
  const [priority, setPriority] = useState("3");
  const [description, setDescription] = useState("");

  const visible = [...modules]
    .filter((module) => module.status !== "archived")
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
  const createDisciplineId = disciplineId || disciplines[0]?.id || "";

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    const slug = slugify(trimmed);
    if (!trimmed || !slug || !createDisciplineId) {
      return;
    }
    onCreateModule({
      name: trimmed,
      slug,
      type,
      discipline_id: createDisciplineId,
      description: description.trim() || undefined,
      priority: Number.parseInt(priority, 10) || 3
    });
    setName("");
    setDescription("");
    setPriority("3");
    setCreating(false);
  }

  return (
    <Modal eyebrow="Manage missions" title="Mission Center" onClose={onClose}>
      <div className="mission-manage">
        {visible.length ? (
          visible.map((module) => {
            const discipline = disciplines.find((item) => item.id === module.discipline_id);
            const accent = accentForSlug(discipline?.slug ?? null);
            if (editId === module.id) {
              return (
                <ModuleEditCard
                  key={module.id}
                  module={module}
                  disciplines={disciplines}
                  isSaving={isSaving}
                  onSave={(payload) => {
                    onUpdateModule(module.id, payload);
                    setEditId(null);
                  }}
                  onCancel={() => setEditId(null)}
                />
              );
            }
            return (
              <article className="mission-card" key={module.id}>
                <div className="mission-topline">
                  <strong dir="auto">{module.name}</strong>
                  <Chip accent={module.status === "active" ? accent : "neutral"}>{moduleStatusLabel(module.status)}</Chip>
                </div>
                <div className="next-action">
                  <Zap size={15} />
                  <span>
                    {discipline?.name ?? "Atlas"} · {moduleTypeLabel(module.type)} · עדיפות {module.priority}
                  </span>
                </div>
                {module.description ? <p className="mission-desc" dir="auto">{module.description}</p> : null}
                <div className="activity-actions mission-actions">
                  {confirmArchiveId === module.id ? (
                    <>
                      <button
                        className="activity-action danger"
                        type="button"
                        onClick={() => {
                          onModuleStatus(module.id, "archive");
                          setConfirmArchiveId(null);
                        }}
                      >
                        העבר לארכיון
                      </button>
                      <button className="activity-action" type="button" onClick={() => setConfirmArchiveId(null)}>
                        ביטול
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="icon-button small" type="button" aria-label="ערוך module" onClick={() => setEditId(module.id)}>
                        <Pencil size={15} />
                      </button>
                      {module.status === "active" ? (
                        <button className="activity-action" type="button" onClick={() => onModuleStatus(module.id, "pause")}>
                          השהה
                        </button>
                      ) : (
                        <button className="activity-action" type="button" onClick={() => onModuleStatus(module.id, "resume")}>
                          הפעל
                        </button>
                      )}
                      <button className="icon-button small" type="button" aria-label="ארכיון" onClick={() => setConfirmArchiveId(module.id)}>
                        <Archive size={15} />
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <p className="behavior-empty">אין modules פעילים. צור אחד חדש למטה.</p>
        )}
      </div>

      {creating ? (
        <form className="quick-log-form mission-create" onSubmit={submitCreate}>
          <label>
            <span>שם ה־Module</span>
            <input autoFocus dir="auto" value={name} onChange={(event) => setName(event.target.value)} placeholder="לדוגמה: ParkNet" />
          </label>
          <div className="form-row">
            <label>
              <span>סוג</span>
              <select value={type} onChange={(event) => setType(event.target.value as (typeof moduleTypes)[number])}>
                {moduleTypes.map((moduleType) => (
                  <option key={moduleType} value={moduleType}>
                    {moduleTypeLabel(moduleType)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>עדיפות</span>
              <input inputMode="numeric" min="1" max="5" type="number" value={priority} onChange={(event) => setPriority(event.target.value)} />
            </label>
          </div>
          <label>
            <span>תחום</span>
            <select value={createDisciplineId} onChange={(event) => setDisciplineId(event.target.value)}>
              {disciplines.map((discipline) => (
                <option key={discipline.id} value={discipline.id}>
                  {discipline.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>תיאור</span>
            <textarea dir="auto" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="אופציונלי" />
          </label>
          <div className="activity-edit-actions">
            <button className="quick-submit" type="submit" disabled={isSaving || !name.trim()}>
              <Plus size={15} /> צור Module
            </button>
            <button className="ghost-button" type="button" onClick={() => setCreating(false)}>
              ביטול
            </button>
          </div>
        </form>
      ) : (
        <button className="day-quick-add-trigger" type="button" onClick={() => setCreating(true)}>
          <Plus size={15} /> Module חדש
        </button>
      )}
    </Modal>
  );
}

function CalendarModal({
  activities,
  modules,
  disciplines,
  onUpdateActivity,
  onDeleteActivity,
  onAddActivity,
  onOpenJournal,
  onClose
}: {
  activities: JournalActivity[];
  modules: LifeModule[];
  disciplines: Discipline[];
  onUpdateActivity: (id: string, payload: ActivityUpdatePayload) => void;
  onDeleteActivity: (id: string) => void;
  onAddActivity: (payload: CreateActivityPayload) => void;
  onOpenJournal: () => void;
  onClose: () => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDateKey, setSelectedDateKey] = useState(() => formatDateKey(new Date()));

  const today = new Date();
  const todayKey = formatDateKey(today);
  const anchor = new Date(today);
  anchor.setHours(0, 0, 0, 0);
  anchor.setDate(anchor.getDate() + weekOffset * 7);
  const weekStart = new Date(anchor);
  weekStart.setDate(anchor.getDate() - anchor.getDay());
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    return day;
  });

  const activitiesByDay = activities.reduce<Record<string, JournalActivity[]>>((groups, activity) => {
    const key = formatDateKey(new Date(activity.occurred_at));
    groups[key] = [...(groups[key] ?? []), activity];
    return groups;
  }, {});
  const selectedActivities = activitiesByDay[selectedDateKey] ?? [];
  const selectedMinutes = selectedActivities.reduce((sum, activity) => sum + (activity.duration_minutes ?? 0), 0);
  const selectedDate = new Date(selectedDateKey);
  const selectedLabel = Number.isNaN(selectedDate.getTime())
    ? "היום"
    : new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(selectedDate);
  const weekLabel = `${new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short" }).format(weekDays[0])} – ${new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short" }).format(weekDays[6])}`;

  return (
    <Modal eyebrow="Live calendar" title="יומן / לוח שנה" onClose={onClose}>
      <div className="calendar-nav">
        <button type="button" onClick={() => setWeekOffset((offset) => offset - 1)}>
          הקודם
        </button>
        <strong>{weekLabel}</strong>
        <button type="button" onClick={() => setWeekOffset((offset) => offset + 1)}>
          הבא
        </button>
      </div>

      <div className="dashboard-calendar-days" aria-label="Week calendar">
        {weekDays.map((day) => {
          const key = formatDateKey(day);
          const dayActivities = activitiesByDay[key] ?? [];
          return (
            <button
              className={`dashboard-calendar-day ${key === todayKey ? "today" : ""} ${key === selectedDateKey ? "selected" : ""} ${dayActivities.length ? "has-activity" : ""}`}
              key={key}
              type="button"
              onClick={() => setSelectedDateKey(key)}
            >
              <span>{new Intl.DateTimeFormat("he-IL", { weekday: "short" }).format(day)}</span>
              <strong>{day.getDate()}</strong>
              <small>{dayActivities.length || ""}</small>
            </button>
          );
        })}
      </div>

      <div className="calendar-day-summary">
        <span>{selectedLabel}</span>
        <strong>{selectedActivities.length} פעולות</strong>
        <small>{selectedMinutes} דק׳</small>
      </div>

      <div className="calendar-day-list">
        {selectedActivities.length ? (
          selectedActivities.map((activity) => (
            <EditableActivityRow
              key={activity.id}
              activity={activity}
              modules={modules}
              onUpdate={onUpdateActivity}
              onDelete={onDeleteActivity}
            />
          ))
        ) : (
          <p className="behavior-empty">אין פעילויות ביום הזה.</p>
        )}
      </div>

      <DayQuickAdd dateKey={selectedDateKey} modules={modules} disciplines={disciplines} onAdd={onAddActivity} />

      <button className="modal-action" type="button" onClick={onOpenJournal}>
        <History size={16} />
        פתח יומן מלא
      </button>
    </Modal>
  );
}

function CockpitModal({
  kind,
  dashboard,
  activities,
  modules,
  disciplines,
  isSaving,
  onCreateModule,
  onUpdateModule,
  onModuleStatus,
  onUpdateActivity,
  onDeleteActivity,
  onAddActivity,
  onClose,
  onOpenJournal
}: {
  kind: CockpitModalKind;
  dashboard: DashboardResponse | null;
  activities: JournalActivity[];
  modules: LifeModule[];
  disciplines: Discipline[];
  isSaving: boolean;
  onCreateModule: (payload: ModulePayload) => void;
  onUpdateModule: (id: string, payload: ModuleUpdatePayload) => void;
  onModuleStatus: (id: string, action: "archive" | "pause" | "resume") => void;
  onUpdateActivity: (id: string, payload: ActivityUpdatePayload) => void;
  onDeleteActivity: (id: string) => void;
  onAddActivity: (payload: CreateActivityPayload) => void;
  onClose: () => void;
  onOpenJournal: () => void;
}) {
  if (kind === "today") {
    const signals = dashboard?.real_signals;
    const recommendation = dashboard?.recommendations[0];
    const recent = activities.slice(0, 6);
    return (
      <Modal eyebrow="Real signals only" title="סקירת היום" onClose={onClose}>
        <p className="modal-lead" dir="auto">
          {recommendation ? recommendation.title : "רשום פעולה אחת אמיתית כדי לתת ל־Atlas signal."}
        </p>
        <div className="detail-grid">
          <div className="detail-stat"><span>פעולות היום</span><strong>{signals?.today_activity_count ?? 0}</strong></div>
          <div className="detail-stat"><span>זמן היום</span><strong>{signals?.today_duration_minutes ?? 0} דק׳</strong></div>
          <div className="detail-stat"><span>פעולות השבוע</span><strong>{signals?.week_activity_count ?? 0}</strong></div>
          <div className="detail-stat"><span>זמן השבוע</span><strong>{signals?.week_duration_minutes ?? 0} דק׳</strong></div>
          <div className="detail-stat"><span>מודולים פעילים</span><strong>{signals?.active_module_count ?? 0}</strong></div>
          <div className="detail-stat"><span>פעולה אחרונה</span><strong dir="auto">{signals?.last_activity_title ?? "—"}</strong></div>
        </div>
        {recent.length ? (
          <>
            <h3 className="detail-section-title">פעולות אחרונות</h3>
            <div className="detail-list">
              {recent.map((activity) => (
                <EditableActivityRow
                  key={activity.id}
                  activity={activity}
                  modules={modules}
                  onUpdate={onUpdateActivity}
                  onDelete={onDeleteActivity}
                />
              ))}
            </div>
          </>
        ) : null}
      </Modal>
    );
  }

  if (kind === "pulse") {
    const items = dashboard?.weekly_balance ?? [];
    const maxDuration = Math.max(...items.map((item) => item.duration_minutes), 1);
    const totalMinutes = items.reduce((sum, item) => sum + item.duration_minutes, 0);
    return (
      <Modal eyebrow="Weekly balance" title="Life Pulse" onClose={onClose}>
        <p className="modal-lead">{totalMinutes} דק׳ נרשמו השבוע על פני {items.length} תחומים.</p>
        {items.length ? (
          <div className="detail-bars">
            {items.map((item) => {
              const accent = accentForSlug(item.discipline_slug);
              const width = Math.max(6, Math.round((item.duration_minutes / maxDuration) * 100));
              return (
                <div className="pulse-bar-row" key={item.discipline_id}>
                  <div className="pulse-bar-head">
                    <span className="pulse-bar-label">{disciplineLabel(item.discipline_slug, item.discipline_name)}</span>
                    <strong className="pulse-bar-score">{item.duration_minutes} דק׳ · {item.activity_count}</strong>
                  </div>
                  <div className="pulse-bar-track">
                    <div className={`pulse-bar-fill bar-${accent}`} style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="behavior-empty">אין נתוני שבוע עדיין.</p>
        )}
      </Modal>
    );
  }

  if (kind === "missions") {
    return (
      <MissionCenterModal
        modules={modules}
        disciplines={disciplines}
        isSaving={isSaving}
        onCreateModule={onCreateModule}
        onUpdateModule={onUpdateModule}
        onModuleStatus={onModuleStatus}
        onClose={onClose}
      />
    );
  }

  if (kind === "chief") {
    const recommendations = dashboard?.recommendations ?? [];
    return (
      <Modal eyebrow="Recommendations" title="Chief of Staff" onClose={onClose}>
        {recommendations.length ? (
          <div className="detail-list">
            {recommendations.map((recommendation, index) => (
              <article className="mission-card" key={`${recommendation.title}-${index}`}>
                <div className="mission-topline">
                  <strong dir="auto">{recommendation.title}</strong>
                  <Chip accent={severityAccent(recommendation.severity)}>{recommendation.severity}</Chip>
                </div>
                <p className="modal-lead" dir="auto">{recommendation.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="behavior-empty">אין המלצות חיות עדיין.</p>
        )}
      </Modal>
    );
  }

  return (
    <CalendarModal
      activities={activities}
      modules={modules}
      disciplines={disciplines}
      onUpdateActivity={onUpdateActivity}
      onDeleteActivity={onDeleteActivity}
      onAddActivity={onAddActivity}
      onOpenJournal={onOpenJournal}
      onClose={onClose}
    />
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
