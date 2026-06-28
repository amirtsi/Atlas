import { useEffect, useMemo, useRef, useState } from "react";
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
  Maximize2,
  Newspaper,
  Plus,
  Quote as QuoteIcon,
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
  onOpen,
  children
}: {
  title: string;
  eyebrow?: string;
  icon?: React.ReactNode;
  className?: string;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  const interactive = Boolean(onOpen);
  const interactiveProps = interactive
    ? {
        role: "button",
        tabIndex: 0,
        "aria-haspopup": "dialog" as const,
        "aria-label": `${title} — הצג פירוט`,
        onClick: onOpen,
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen?.();
          }
        }
      }
    : {};

  return (
    <section className={`panel ${interactive ? "panel-interactive" : ""} ${className}`} {...interactiveProps}>
      <div className="panel-content">
        <header className="panel-header">
          <div>
            {eyebrow ? <span className="panel-eyebrow">{eyebrow}</span> : null}
            <h2>{title}</h2>
          </div>
          {interactive ? (
            <div className="panel-expand" aria-hidden="true">
              <Maximize2 size={15} />
            </div>
          ) : icon ? (
            <div className="panel-icon">{icon}</div>
          ) : null}
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

const accentColorVar: Record<Accent, string> = {
  blue: "var(--blue)",
  purple: "var(--purple)",
  green: "var(--green)",
  orange: "var(--orange)",
  red: "var(--red)",
  neutral: "rgba(255, 255, 255, 0.45)"
};

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
    body: recommendation?.body ?? "Atlas צריך חיבור API ופעילות אמיתית כדי להמליץ על הצעד הבא.",
    confidence: recommendation ? (recommendation.severity === "warning" ? 86 : 78) : 0
  };

  return (
    <Panel title="Chief of Staff" eyebrow={chief.signal} className="chief-panel" onOpen={onOpen}>
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
  const confidence = recommendation
    ? recommendation.severity === "critical"
      ? 92
      : recommendation.severity === "warning"
        ? 86
        : 78
    : 0;

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
          {recommendation ? <span className="hero-confidence">{confidence}% confidence</span> : null}
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

const MOTIVATION_QUOTES: { text: string; author: string }[] = [
  { text: "You have power over your mind — not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { text: "Discipline equals freedom.", author: "Jocko Willink" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Aristotle" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "המעשים הקטנים שאתה עושה היום בונים את מי שתהיה מחר.", author: "Atlas" },
  { text: "Small daily improvements over time lead to stunning results.", author: "Robin Sharma" },
  { text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
  { text: "What gets measured gets managed.", author: "Peter Drucker" },
  { text: "ההצלחה היא סך כל המאמצים הקטנים שחוזרים על עצמם יום אחרי יום.", author: "Robert Collier" },
  { text: "The successful warrior is the average man, with laser-like focus.", author: "Bruce Lee" },
  { text: "Well begun is half done.", author: "Aristotle" },
  { text: "Do something today that your future self will thank you for.", author: "Unknown" }
];

function QuoteStrip() {
  const quote = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0).getTime();
    const dayOfYear = Math.floor((now.getTime() - start) / 86_400_000);
    return MOTIVATION_QUOTES[dayOfYear % MOTIVATION_QUOTES.length];
  }, []);

  return (
    <aside className="quote-strip" aria-label="ציטוט היום">
      <QuoteIcon size={16} aria-hidden="true" />
      <p dir="auto">
        {quote.text} <small>— {quote.author}</small>
      </p>
    </aside>
  );
}

type NewsItem = { id: number; title: string; url: string; score: number };

function useTechNews() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const ids: number[] = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json").then((response) => {
          if (!response.ok) {
            throw new Error("news");
          }
          return response.json();
        });
        const stories = await Promise.all(
          ids.slice(0, 10).map((id) =>
            fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((response) => response.json())
          )
        );
        if (!active) {
          return;
        }
        setItems(
          stories.filter(Boolean).map((story) => ({
            id: story.id,
            title: story.title,
            url: typeof story.url === "string" ? story.url : `https://news.ycombinator.com/item?id=${story.id}`,
            score: typeof story.score === "number" ? story.score : 0
          }))
        );
        setStatus("ready");
      } catch {
        if (active) {
          setStatus("error");
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  return { items, status };
}

function NewsList({ items }: { items: NewsItem[] }) {
  return (
    <ul className="news-list">
      {items.map((item, index) => (
        <li className="news-item" key={item.id}>
          <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
            <span className="news-rank">{index + 1}</span>
            <span className="news-title" dir="auto">{item.title}</span>
            <span className="news-score">▲ {item.score}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function NewsTile() {
  const { items, status } = useTechNews();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Panel
        title="Tech News"
        eyebrow="Hacker News · top stories"
        icon={<Newspaper size={21} />}
        className="news-panel"
        onOpen={() => setIsOpen(true)}
      >
        {status === "loading" ? <p className="news-empty">טוען חדשות טכנולוגיה…</p> : null}
        {status === "error" ? <p className="news-empty">לא ניתן לטעון חדשות כרגע. בדוק חיבור לרשת.</p> : null}
        {status === "ready" ? <NewsList items={items.slice(0, 4)} /> : null}
      </Panel>

      {isOpen ? (
        <Modal eyebrow="Hacker News" title="Tech News" onClose={() => setIsOpen(false)}>
          {status === "ready" ? (
            <NewsList items={items} />
          ) : (
            <p className="news-empty">{status === "error" ? "לא ניתן לטעון חדשות כרגע." : "טוען…"}</p>
          )}
        </Modal>
      ) : null}
    </>
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

type CockpitModalKind = "today" | "pulse" | "missions" | "chief" | "calendar";

function severityAccent(severity: string): Accent {
  if (severity === "critical") return "red";
  if (severity === "warning") return "orange";
  return "blue";
}

function Modal({
  eyebrow,
  title,
  onClose,
  children
}: {
  eyebrow?: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={sheetRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            {eyebrow ? <span>{eyebrow}</span> : null}
            <h2 dir="auto">{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="סגור">
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function CockpitModal({
  kind,
  dashboard,
  activities,
  onClose,
  onOpenJournal
}: {
  kind: CockpitModalKind;
  dashboard: DashboardResponse | null;
  activities: JournalActivity[];
  onClose: () => void;
  onOpenJournal: () => void;
}) {
  if (kind === "today") {
    const signals = dashboard?.real_signals;
    const recommendation = dashboard?.recommendations[0];
    const recent = dashboard?.recent_activities.slice(0, 6) ?? [];
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
                <div className="detail-row" key={activity.id}>
                  <div>
                    <strong dir="auto">{activity.title}</strong>
                    <span>
                      {formatActivityTime(activity.occurred_at)} · {activity.module_name ?? activity.activity_type} · {activity.duration_minutes ?? 0} דק׳
                    </span>
                  </div>
                  <Chip accent={accentForSlug(activity.discipline_slug)}>{disciplineLabel(activity.discipline_slug, activity.discipline_name)}</Chip>
                </div>
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
    const modules = dashboard?.active_modules ?? [];
    return (
      <Modal eyebrow="Active modules" title="Mission Center" onClose={onClose}>
        {modules.length ? (
          <div className="detail-list">
            {modules.map((module) => {
              const summary = module.behavior?.summary ?? {};
              const progress = summaryNumber(summary, "progress_percent", 50);
              const accent = accentForSlug(module.discipline_slug);
              return (
                <article className="mission-card" key={module.id}>
                  <div className="mission-topline">
                    <strong>{module.name}</strong>
                    <Chip accent={accent}>{module.status === "active" ? "פעיל" : module.status}</Chip>
                  </div>
                  <ProgressBar value={progress} accent={accent} />
                  <div className="next-action">
                    <Zap size={15} />
                    <span>{disciplineLabel(module.discipline_slug, module.discipline_name)} · {moduleTypeLabel(module.type)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="behavior-empty">אין modules פעילים.</p>
        )}
      </Modal>
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

  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekActivities = activities.filter((activity) => new Date(activity.occurred_at) >= weekStart).slice(0, 14);
  return (
    <Modal eyebrow="This week" title="יומן השבוע" onClose={onClose}>
      {weekActivities.length ? (
        <div className="detail-list">
          {weekActivities.map((activity) => (
            <div className="detail-row" key={activity.id}>
              <div>
                <strong dir="auto">{activity.title}</strong>
                <span>
                  {new Date(activity.occurred_at).toLocaleDateString("he-IL")} · {formatActivityTime(activity.occurred_at)} · {activity.duration_minutes ?? 0} דק׳
                </span>
              </div>
              <Chip accent={accentForSlug(activity.discipline_slug)}>{disciplineLabel(activity.discipline_slug, activity.discipline_name)}</Chip>
            </div>
          ))}
        </div>
      ) : (
        <p className="behavior-empty">אין פעילויות השבוע.</p>
      )}
      <button className="modal-action" type="button" onClick={onOpenJournal}>
        <History size={16} />
        פתח יומן מלא
      </button>
    </Modal>
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
