import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BatteryCharging,
  CalendarClock,
  CircleDot,
  ClipboardList,
  MessageCircle,
  FileClock,
  Gauge,
  History,
  Layers3,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  X,
  Zap
} from "lucide-react";
import {
  type Accent,
  type AuditEvent,
  type ActivityTemplate,
  type ActivityTemplatePayload,
  type CommunicationMessage,
  type CommunicationProvider,
  type DashboardResponse,
  type Discipline,
  type JournalActivity,
  type LifeModule,
  type ModuleBehavior,
  type ModulePayload,
  type ModuleUpdatePayload,
  type QuickLogPayload,
  createCommunicationProvider,
  createActivityTemplate,
  DEFAULT_WHATSAPP_RECIPIENT,
  DEFAULT_WHATSAPP_RECIPIENT_LOCAL,
  createModule,
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

function Chip({ children, accent = "neutral" }: { children: React.ReactNode; accent?: Accent }) {
  return <span className={`chip chip-${accent}`}>{children}</span>;
}

function ProgressBar({ value, accent = "blue" }: { value: number; accent?: Accent }) {
  return (
    <div className="progress-track">
      <div className={`progress-fill progress-${accent}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  icon,
  className = "",
  children
}: {
  title: string;
  eyebrow?: string;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-content">
        <header className="panel-header">
          <div>
            {eyebrow ? <span className="panel-eyebrow">{eyebrow}</span> : null}
            <h2>{title}</h2>
          </div>
          {icon ? <div className="panel-icon">{icon}</div> : null}
        </header>
        {children}
      </div>
    </section>
  );
}

function disciplineLabel(slug?: string | null, name?: string | null): string {
  const labels: Record<string, string> = {
    work: "קריירה",
    fitness: "בריאות",
    health: "בריאות",
    recovery: "התאוששות",
    learning: "למידה",
    relationship: "זוגיות",
    finance: "פיננסים",
    "personal-growth": "התפתחות"
  };
  return (slug && labels[slug]) || name || "כללי";
}

function accentForSlug(slug?: string | null): Accent {
  const accents: Record<string, Accent> = {
    work: "blue",
    fitness: "green",
    health: "green",
    recovery: "orange",
    learning: "purple",
    relationship: "red",
    finance: "neutral",
    "personal-growth": "blue"
  };
  return (slug && accents[slug]) || "blue";
}

function formatActivityTime(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) {
    return "עכשיו";
  }
  return new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toOptionalMinutes(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toNumberDraft(value: unknown, fallback = 0): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback);
}

function summaryNumber(summary: Record<string, unknown>, key: string, fallback = 0): number {
  const value = summary[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toConfigNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function moduleTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    project: "Project",
    habit: "Habit",
    learning: "Learning",
    recovery: "Recovery",
    relationship: "Relationship",
    finance: "Finance",
    calendar: "Calendar",
    ai_coach: "AI Coach",
    analytics: "Analytics",
    ledger: "Ledger"
  };
  return labels[type] ?? type;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function WelcomePanel({ dashboard }: { dashboard: DashboardResponse | null }) {
  const recommendation = dashboard?.recommendations[0];
  const signals = dashboard?.real_signals;

  return (
    <Panel title="קוקפיט היום" eyebrow="Real signals only" icon={<Gauge size={21} />} className="welcome-panel">
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

function LifePulse({ dashboard }: { dashboard: DashboardResponse | null }) {
  const disciplines = useMemo(() => {
    if (!dashboard?.weekly_balance.length) {
      return [];
    }

    const maxDuration = Math.max(...dashboard.weekly_balance.map((item) => item.duration_minutes), 1);
    return dashboard.weekly_balance.slice(0, 7).map((item) => ({
      name: item.discipline_slug,
      label: disciplineLabel(item.discipline_slug, item.discipline_name),
      score: Math.max(28, Math.round((item.duration_minutes / maxDuration) * 86)),
      accent: accentForSlug(item.discipline_slug)
    }));
  }, [dashboard]);

  const average = disciplines.length
    ? Math.round(disciplines.reduce((sum, item) => sum + item.score, 0) / disciplines.length)
    : 0;

  return (
    <Panel title="Life Pulse" eyebrow="Balance overview" icon={<CircleDot size={22} />} className="life-pulse-panel">
      <div className="pulse-stage" aria-label="Life disciplines balance visualization">
        <div className="pulse-orbit pulse-orbit-outer" />
        <div className="pulse-orbit pulse-orbit-inner" />
        <div className="pulse-ring" />
        <div className="pulse-core">
          <span>Balance</span>
          <strong>{average}%</strong>
          <small>{dashboard ? "Live weekly signal" : "No API signal"}</small>
        </div>

        {disciplines.length ? (
          disciplines.map((discipline, index) => (
            <div
              className={`discipline-node discipline-${index + 1}`}
              key={discipline.name}
              style={{ "--score": `${discipline.score}%` } as React.CSSProperties}
            >
              <span>{discipline.label}</span>
              <strong>{discipline.score}</strong>
            </div>
          ))
        ) : (
          <p className="empty-panel-copy">אין נתוני שבוע חיים עדיין.</p>
        )}
      </div>
    </Panel>
  );
}

function MissionCenter({ dashboard }: { dashboard: DashboardResponse | null }) {
  const missions = useMemo(() => {
    if (!dashboard?.active_modules.length) {
      return [];
    }

    return dashboard.active_modules.slice(0, 3).map((module) => {
      const summary = module.behavior?.summary ?? {};
      const progress = summaryNumber(summary, "progress_percent", module.type === "recovery" ? 38 : 50);
      const nextActionByType: Record<string, string> = {
        project: `${summaryNumber(summary, "total_open")} פתוחים · ${summaryNumber(summary, "total_done")} הושלמו`,
        habit: `${summaryNumber(summary, "weekly_completions")}/${summaryNumber(summary, "weekly_target", 3)} השבוע · רצף ${summaryNumber(summary, "streak_days")}`,
        learning: `${summaryNumber(summary, "study_minutes")} דקות השבוע · ${summaryNumber(summary, "learning_units_done")}/${summaryNumber(summary, "learning_units_total")} יחידות`,
        recovery: "פעולת התאוששות קצרה",
        relationship: "זמן איכות בלי הסחות"
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
    <Panel title="Mission Center" eyebrow="3-5 modules only" icon={<Layers3 size={21} />} className="mission-panel">
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

function LifeTimeline({ dashboard }: { dashboard: DashboardResponse | null }) {
  const timeline = useMemo(() => {
    if (!dashboard?.recent_activities.length) {
      return [];
    }

    return dashboard.recent_activities.slice(0, 4).map((activity) => ({
      time: formatActivityTime(activity.occurred_at),
      title: activity.title,
      discipline: disciplineLabel(activity.discipline_slug, activity.discipline_name),
      detail: `${activity.duration_minutes ?? 0} דקות · ${activity.module_name ?? activity.activity_type}`,
      accent: accentForSlug(activity.discipline_slug)
    }));
  }, [dashboard]);

  return (
    <Panel title="Life Timeline" eyebrow="Completed real actions" icon={<History size={21} />} className="timeline-panel">
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
  onOpenJournal
}: {
  activities: JournalActivity[];
  onOpenJournal: () => void;
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
    <Panel title="יומן / לוח שנה" eyebrow="Live activity calendar" icon={<CalendarClock size={21} />} className="dashboard-calendar-panel">
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
              onClick={() => setSelectedDateKey(key)}
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
          selectedActivities.slice(0, 3).map((activity) => (
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

      <button className="dashboard-calendar-open" type="button" onClick={onOpenJournal}>
        <History size={16} />
        פתח יומן מלא
      </button>
    </Panel>
  );
}

function ChiefOfStaff({ dashboard }: { dashboard: DashboardResponse | null }) {
  const recommendation = dashboard?.recommendations[0];
  const chief = {
    signal: recommendation ? "Live life balance signal" : "No recommendation yet",
    title: recommendation?.title ?? "אין המלצה חיה",
    body: recommendation?.body ?? "Atlas צריך חיבור API ופעילות אמיתית כדי להמליץ על הצעד הבא.",
    confidence: recommendation ? (recommendation.severity === "warning" ? 86 : 78) : 0
  };

  return (
    <Panel title="Chief of Staff" eyebrow={chief.signal} className="chief-panel">
      <div className="ai-core-wrap" aria-hidden="true">
        <div className="ai-core">
          <div className="ai-core-inner" />
        </div>
      </div>

      <div className="recommendation-copy">
        <span className="confidence">{chief.confidence}% confidence</span>
        <h3 dir="auto">{chief.title}</h3>
        <p dir="auto">{chief.body}</p>
      </div>
    </Panel>
  );
}

function ApiUnavailablePanel() {
  return (
    <section className="api-unavailable-panel" aria-label="Atlas API unavailable">
      <div className="ai-core-wrap" aria-hidden="true">
        <div className="ai-core">
          <div className="ai-core-inner" />
        </div>
      </div>
      <div>
        <span>Atlas Core Offline</span>
        <h2>ה־API לא מחובר, לכן אין cockpit אמיתי להציג.</h2>
        <p>
          Atlas לא מציג יותר נתוני דמו במסך הראשי. הרץ את סביבת הפיתוח המלאה, ואז המסך ייטען מנתונים חיים בלבד.
        </p>
        <code>./scripts/dev.sh</code>
      </div>
    </section>
  );
}

function JournalView({ activities }: { activities: JournalActivity[] }) {
  const [mode, setMode] = useState<"calendar" | "list">("calendar");
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [selectedDateKey, setSelectedDateKey] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  });
  const totalMinutes = activities.reduce((sum, activity) => sum + (activity.duration_minutes ?? 0), 0);
  const monthStart = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
  const monthEnd = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + 1, 0);
  const calendarStart = new Date(monthStart);
  calendarStart.setDate(monthStart.getDate() - monthStart.getDay());
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(calendarStart);
    day.setDate(calendarStart.getDate() + index);
    return day;
  });

  const activitiesByDay = activities.reduce<Record<string, JournalActivity[]>>((groups, activity) => {
    const key = formatDateKey(new Date(activity.occurred_at));
    groups[key] = [...(groups[key] ?? []), activity];
    return groups;
  }, {});
  const selectedActivities = activitiesByDay[selectedDateKey] ?? [];
  const selectedMinutes = selectedActivities.reduce((sum, activity) => sum + (activity.duration_minutes ?? 0), 0);
  const monthLabel = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(cursorDate);

  function moveMonth(offset: number) {
    setCursorDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  return (
    <section className="ledger-view" aria-label="Activity journal">
      <div className="modules-hero">
        <div>
          <span>Life Journal</span>
          <h2>יומן פעולות</h2>
          <p>רשימת הפעולות האמיתיות שנרשמו ב־Atlas. זה המקור ליומן החיים, ל־Life Pulse ולהמלצות.</p>
        </div>
        <div className="module-count">
          <strong>{activities.length}</strong>
          <span>{totalMinutes} דק׳</span>
        </div>
      </div>

      <div className="journal-toolbar">
        <div className="quick-log-tabs journal-mode-tabs">
          <button className={mode === "calendar" ? "active" : ""} type="button" onClick={() => setMode("calendar")}>
            לוח שנה
          </button>
          <button className={mode === "list" ? "active" : ""} type="button" onClick={() => setMode("list")}>
            רשימה
          </button>
        </div>

        {mode === "calendar" ? (
          <div className="calendar-nav">
            <button type="button" onClick={() => moveMonth(-1)}>
              הקודם
            </button>
            <strong>{monthLabel}</strong>
            <button type="button" onClick={() => moveMonth(1)}>
              הבא
            </button>
          </div>
        ) : null}
      </div>

      {mode === "calendar" ? (
        <div className="journal-calendar-layout">
          <section className="calendar-panel">
            <div className="calendar-weekdays">
              {["א", "ב", "ג", "ד", "ה", "ו", "ש"].map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {calendarDays.map((day) => {
                const key = formatDateKey(day);
                const dayActivities = activitiesByDay[key] ?? [];
                const minutes = dayActivities.reduce((sum, activity) => sum + (activity.duration_minutes ?? 0), 0);
                const isCurrentMonth = day >= monthStart && day <= monthEnd;
                const isSelected = key === selectedDateKey;
                return (
                  <button
                    className={`calendar-day ${isCurrentMonth ? "" : "muted"} ${dayActivities.length ? "has-activity" : ""} ${isSelected ? "selected" : ""}`}
                    key={key}
                    type="button"
                    onClick={() => setSelectedDateKey(key)}
                  >
                    <span>{day.getDate()}</span>
                    {dayActivities.length ? (
                      <>
                        <strong>{dayActivities.length}</strong>
                        <small>{minutes} דק׳</small>
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="calendar-day-panel">
            <div className="calendar-day-summary">
              <span>{new Date(selectedDateKey).toLocaleDateString("he-IL")}</span>
              <strong>{selectedActivities.length} פעולות</strong>
              <small>{selectedMinutes} דק׳</small>
            </div>
            <div className="calendar-day-list">
              {selectedActivities.length ? (
                selectedActivities.map((activity) => (
                  <article className="calendar-activity" key={activity.id}>
                    <div>
                      <strong>{activity.title}</strong>
                      <span>
                        {formatActivityTime(activity.occurred_at)} · {activity.module_name ?? "Atlas"} · {activity.duration_minutes ?? 0} דק׳
                      </span>
                    </div>
                    <Chip accent={accentForSlug(activity.discipline_slug)}>{disciplineLabel(activity.discipline_slug, activity.discipline_name)}</Chip>
                  </article>
                ))
              ) : (
                <p className="behavior-empty">אין פעילויות ביום הזה.</p>
              )}
            </div>
          </aside>
        </div>
      ) : (
        <div className="ledger-list">
          {activities.map((activity) => (
            <article className="ledger-row" key={activity.id}>
              <div className="ledger-time">
                <strong>{formatActivityTime(activity.occurred_at)}</strong>
                <span>{new Date(activity.occurred_at).toLocaleDateString("he-IL")}</span>
              </div>
              <div className="ledger-main">
                <div className="timeline-title-row">
                  <h3>{activity.title}</h3>
                  <Chip accent={accentForSlug(activity.discipline_slug)}>{disciplineLabel(activity.discipline_slug, activity.discipline_name)}</Chip>
                </div>
                <p>
                  {activity.module_name ?? "Atlas"} · {activity.duration_minutes ?? 0} דק׳ · {activity.source}
                </p>
                {activity.notes ? <small>{activity.notes}</small> : null}
              </div>
            </article>
          ))}
        </div>
      )}
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

const moduleTypes = ["project", "habit", "learning", "recovery", "relationship", "finance", "calendar"] as const;
const moduleStatuses = ["active", "paused", "completed", "archived"] as const;

function ModulesView({
  modules,
  disciplines,
  isSaving,
  onCreateModule,
  onUpdateModule
}: {
  modules: LifeModule[];
  disciplines: Discipline[];
  isSaving: boolean;
  onCreateModule: (payload: ModulePayload) => void;
  onUpdateModule: (moduleId: string, payload: ModuleUpdatePayload) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof moduleTypes)[number]>("project");
  const [disciplineId, setDisciplineId] = useState("");
  const [priority, setPriority] = useState("3");
  const [description, setDescription] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { status: string; priority: string }>>({});
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [behavior, setBehavior] = useState<ModuleBehavior | null>(null);
  const [behaviorDraft, setBehaviorDraft] = useState<Record<string, string>>({});
  const [isBehaviorLoading, setIsBehaviorLoading] = useState(false);

  const selectedDisciplineId = disciplineId || disciplines[0]?.id || "";
  const modulesByPriority = [...modules].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
  const selectedModule = modules.find((module) => module.id === (selectedModuleId || modulesByPriority[0]?.id));

  useEffect(() => {
    const moduleId = selectedModule?.id;
    if (!moduleId) {
      setBehavior(null);
      return;
    }
    let active = true;
    setIsBehaviorLoading(true);
    getModuleBehavior(moduleId)
      .then((nextBehavior) => {
        if (!active) {
          return;
        }
        setBehavior(nextBehavior);
        setBehaviorDraft(
          Object.fromEntries(
            Object.entries(nextBehavior.summary)
              .filter(([, value]) => typeof value === "number")
              .map(([key, value]) => [key, String(value)])
          )
        );
      })
      .finally(() => {
        if (active) {
          setIsBehaviorLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedModule?.id]);

  function disciplineName(id: string): string {
    return disciplines.find((discipline) => discipline.id === id)?.name ?? "Atlas";
  }

  function createNewModule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    const nextSlug = slugify(nextName);
    if (!nextName || !nextSlug || !selectedDisciplineId) {
      return;
    }
    onCreateModule({
      name: nextName,
      slug: nextSlug,
      type,
      discipline_id: selectedDisciplineId,
      description: description.trim() || undefined,
      priority: Number.parseInt(priority, 10) || 3
    });
    setName("");
    setDescription("");
    setPriority("3");
  }

  function draftFor(module: LifeModule) {
    return drafts[module.id] ?? { status: module.status, priority: String(module.priority) };
  }

  function setDraft(module: LifeModule, nextDraft: { status: string; priority: string }) {
    setDrafts((current) => ({ ...current, [module.id]: nextDraft }));
  }

  function saveModule(module: LifeModule) {
    const draft = draftFor(module);
    onUpdateModule(module.id, {
      status: draft.status,
      priority: Number.parseInt(draft.priority, 10) || module.priority
    });
  }

  function saveBehavior() {
    if (!selectedModule || !behavior) {
      return;
    }
    const editableKeysByType: Record<string, string[]> = {
      project: ["progress_percent", "tasks_open", "tasks_done", "bugs_open", "bugs_done", "features_open", "features_done"],
      habit: ["weekly_target"],
      learning: ["progress_percent", "learning_units_total", "learning_units_done"]
    };
    const keys = editableKeysByType[behavior.type] ?? [];
    const config = Object.fromEntries(keys.map((key) => [key, toConfigNumber(behaviorDraft[key] ?? toNumberDraft(behavior.config[key]))]));
    updateModuleBehavior(selectedModule.id, config).then((nextBehavior) => {
      setBehavior(nextBehavior);
      setBehaviorDraft(
        Object.fromEntries(
          Object.entries(nextBehavior.summary)
            .filter(([, value]) => typeof value === "number")
            .map(([key, value]) => [key, String(value)])
        )
      );
    });
  }

  function renderBehaviorFields() {
    if (!selectedModule || !behavior) {
      return <p className="behavior-empty">בחר module כדי לראות את ההתנהגות שלו.</p>;
    }
    if (isBehaviorLoading) {
      return <p className="behavior-empty">טוען behavior...</p>;
    }

    const summary = behavior.summary;
    const setDraft = (key: string, value: string) => setBehaviorDraft((current) => ({ ...current, [key]: value }));
    const input = (key: string, label: string) => (
      <label key={key}>
        <span>{label}</span>
        <input value={behaviorDraft[key] ?? toNumberDraft(summary[key])} type="number" min="0" onChange={(event) => setDraft(key, event.target.value)} />
      </label>
    );

    if (behavior.type === "project") {
      return (
        <>
          <div className="behavior-stats">
            <div>
              <strong>{String(summary.progress_percent ?? 0)}%</strong>
              <span>Progress</span>
            </div>
            <div>
              <strong>{String(summary.total_open ?? 0)}</strong>
              <span>Open</span>
            </div>
            <div>
              <strong>{String(summary.total_done ?? 0)}</strong>
              <span>Done</span>
            </div>
          </div>
          <div className="behavior-grid">
            {input("progress_percent", "Progress %")}
            {input("tasks_open", "Tasks open")}
            {input("tasks_done", "Tasks done")}
            {input("bugs_open", "Bugs open")}
            {input("bugs_done", "Bugs done")}
            {input("features_open", "Features open")}
            {input("features_done", "Features done")}
          </div>
        </>
      );
    }

    if (behavior.type === "habit") {
      return (
        <>
          <div className="behavior-stats">
            <div>
              <strong>{String(summary.weekly_completions ?? 0)}</strong>
              <span>This week</span>
            </div>
            <div>
              <strong>{String(summary.weekly_target ?? 0)}</strong>
              <span>Target</span>
            </div>
            <div>
              <strong>{String(summary.streak_days ?? 0)}</strong>
              <span>Streak</span>
            </div>
          </div>
          <div className="behavior-grid compact">{input("weekly_target", "Weekly target")}</div>
        </>
      );
    }

    if (behavior.type === "learning") {
      return (
        <>
          <div className="behavior-stats">
            <div>
              <strong>{String(summary.study_minutes ?? 0)}</strong>
              <span>Study min</span>
            </div>
            <div>
              <strong>{String(summary.learning_units_done ?? 0)}</strong>
              <span>Units done</span>
            </div>
            <div>
              <strong>{String(summary.progress_percent ?? 0)}%</strong>
              <span>Progress</span>
            </div>
          </div>
          <div className="behavior-grid">
            {input("progress_percent", "Progress %")}
            {input("learning_units_total", "Units total")}
            {input("learning_units_done", "Units done")}
          </div>
        </>
      );
    }

    return <p className="behavior-empty">זה placeholder module ב־MVP. ההתנהגות תתווסף בהמשך.</p>;
  }

  return (
    <section className="modules-view" aria-label="Atlas modules management">
      <div className="modules-hero">
        <div>
          <span>Module Registry</span>
          <h2>ניהול Life Modules</h2>
          <p>רק הבסיס ל־MVP: יצירה, סטטוס ועדיפות. ההתנהגות העמוקה של Project / Habit / Learning תגיע בשלבים הבאים.</p>
        </div>
        <div className="module-count">
          <strong>{modules.length}</strong>
          <span>modules</span>
        </div>
      </div>

      <div className="modules-layout">
        <form className="module-form panel" onSubmit={createNewModule}>
          <div className="panel-content">
            <header className="panel-header">
              <div>
                <span className="panel-eyebrow">Create</span>
                <h2>Module חדש</h2>
              </div>
              <div className="panel-icon">
                <Plus size={21} />
              </div>
            </header>

            <label>
              <span>שם</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="לדוגמה: ParkNet Admin" />
            </label>

            <div className="form-row">
              <label>
                <span>Type</span>
                <select value={type} onChange={(event) => setType(event.target.value as (typeof moduleTypes)[number])}>
                  {moduleTypes.map((moduleType) => (
                    <option key={moduleType} value={moduleType}>
                      {moduleTypeLabel(moduleType)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Priority</span>
                <input min="1" max="9" type="number" value={priority} onChange={(event) => setPriority(event.target.value)} />
              </label>
            </div>

            <label>
              <span>Discipline</span>
              <select value={selectedDisciplineId} onChange={(event) => setDisciplineId(event.target.value)}>
                {disciplines.map((discipline) => (
                  <option key={discipline.id} value={discipline.id}>
                    {disciplineLabel(discipline.slug, discipline.name)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Description</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="אופציונלי" />
            </label>

            <button className="quick-submit" type="submit" disabled={isSaving || !name.trim() || !selectedDisciplineId}>
              צור Module
            </button>
          </div>
        </form>

        <div className="module-list">
          {modulesByPriority.map((module) => {
            const draft = draftFor(module);
            const accent = accentForSlug(disciplines.find((discipline) => discipline.id === module.discipline_id)?.slug);
            return (
              <article className={`module-row ${selectedModule?.id === module.id ? "selected" : ""}`} key={module.id}>
                <div className="module-row-main">
                  <Chip accent={accent}>{moduleTypeLabel(module.type)}</Chip>
                  <div>
                    <h3>{module.name}</h3>
                    <p>
                      {disciplineName(module.discipline_id)} · {module.slug}
                    </p>
                  </div>
                </div>

                <div className="module-row-controls">
                  <label>
                    <span>Status</span>
                    <select value={draft.status} onChange={(event) => setDraft(module, { ...draft, status: event.target.value })}>
                      {moduleStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Priority</span>
                    <input
                      min="1"
                      max="9"
                      type="number"
                      value={draft.priority}
                      onChange={(event) => setDraft(module, { ...draft, priority: event.target.value })}
                    />
                  </label>
                  <button className="module-save" type="button" disabled={isSaving} onClick={() => saveModule(module)}>
                    <Save size={17} />
                    שמור
                  </button>
                  <button className="module-save module-inspect" type="button" onClick={() => setSelectedModuleId(module.id)}>
                    Behavior
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <section className="behavior-panel panel">
          <div className="panel-content">
            <header className="panel-header">
              <div>
                <span className="panel-eyebrow">MVP Behavior</span>
                <h2>{selectedModule ? selectedModule.name : "Module behavior"}</h2>
              </div>
              {selectedModule ? <Chip accent={accentForSlug(disciplines.find((discipline) => discipline.id === selectedModule.discipline_id)?.slug)}>{moduleTypeLabel(selectedModule.type)}</Chip> : null}
            </header>

            {renderBehaviorFields()}

            {behavior && ["project", "habit", "learning"].includes(behavior.type) ? (
              <button className="quick-submit" type="button" onClick={saveBehavior}>
                שמור Behavior
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </section>
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

  return (
    <main className="cockpit-shell">
      <header className="topbar">
        <div className="brand">
          <div className="mark" aria-hidden="true">
            A
          </div>
          <div>
            <h1>Atlas</h1>
            <p>Chief of Staff · Mission Control</p>
          </div>
        </div>

        <div className="north-star">
          <Sparkles size={18} />
          <span>What is the best thing I should do right now?</span>
        </div>

        <div className="top-actions">
          <button className={`nav-button ${view === "dashboard" ? "active" : ""}`} type="button" onClick={() => setView("dashboard")}>
            <Gauge size={18} />
            Dashboard
          </button>
          <button className={`nav-button ${view === "journal" ? "active" : ""}`} type="button" onClick={() => setView("journal")}>
            <History size={18} />
            Journal
          </button>
          <button className={`nav-button ${view === "audit" ? "active" : ""}`} type="button" onClick={() => setView("audit")}>
            <ShieldCheck size={18} />
            Audit
          </button>
          <button className={`nav-button ${view === "communication" ? "active" : ""}`} type="button" onClick={() => setView("communication")}>
            <MessageCircle size={18} />
            Comms
          </button>
          <button className={`nav-button ${view === "modules" ? "active" : ""}`} type="button" onClick={() => setView("modules")}>
            <ClipboardList size={18} />
            Modules
          </button>
          <button className="quick-log-main" type="button" onClick={() => setIsQuickLogOpen(true)}>
            <Plus size={22} strokeWidth={2.8} />
            רישום מהיר
          </button>
        </div>
      </header>

      <div className={`api-status ${error ? "api-status-warning" : ""}`}>
        {isLoading ? "Connecting to Atlas API..." : error || "Live data connected"}
      </div>

      {view === "dashboard" ? (
        dashboard ? (
          <section className="cockpit-grid" aria-label="Atlas cockpit dashboard">
            <WelcomePanel dashboard={dashboard} />
            <LifePulse dashboard={dashboard} />
            <ChiefOfStaff dashboard={dashboard} />
            <MissionCenter dashboard={dashboard} />
            <DashboardCalendar activities={activities} onOpenJournal={() => setView("journal")} />
          </section>
        ) : (
          <ApiUnavailablePanel />
        )
      ) : null}

      {view === "journal" ? <JournalView activities={activities} /> : null}

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
        />
      ) : null}

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
    </main>
  );
}
