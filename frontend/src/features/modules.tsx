import { useEffect, useState } from "react";
import { Activity, BookOpen, Bug, Check, ClipboardList, FlaskConical, GraduationCap, Plus, Rocket, Save, Server, Target, Trash2, Zap } from "lucide-react";
import { completeLearningUnit, completeProjectItem, createLearningUnit, createProjectItem, deleteLearningUnit, deleteProjectItem, getLearningOverview, getModuleBehavior, getProjectOverview, getWellbeingOverview, logWellbeingSession, quickLog, type Accent, type Discipline, type LearningOverview, type LearningUnitType, type LifeModule, type ModuleBehavior, type ModulePayload, type ModuleUpdatePayload, type ProjectItem, type ProjectItemType, type ProjectOverview, type WellbeingOverview, updateLearningUnit, updateModuleBehavior, updateProjectItem } from "../api/atlas";
import { Chip, ProgressBar } from "../shared/ui";
import { accentColorVar, accentForSlug, disciplineLabel, formatActivityTime, moduleTypeLabel, slugify, toConfigNumber, toNumberDraft, toOptionalMinutes } from "../shared/format";
import { HobbyBoard } from "./hobbies";
import { HOBBY_CATEGORIES, HOBBY_CATEGORY_LABELS, type HobbyCategory } from "./hobby-logic";

// Modules feature: the Project / Learning / Wellbeing boards, the ModulesView
// manager, and ModuleEditCard. Extracted from App.tsx.

const PROJECT_ITEM_META: Record<ProjectItemType, { label: string; singular: string; icon: React.ReactNode }> = {
  task: { label: "Tasks", singular: "Task", icon: <ClipboardList size={15} /> },
  bug: { label: "Bugs", singular: "Bug", icon: <Bug size={15} /> },
  feature: { label: "Features", singular: "Feature", icon: <Rocket size={15} /> }
};

function ProjectBoard({ moduleId, accent, onChanged }: { moduleId: string; accent: Accent; onChanged: () => void }) {
  const [overview, setOverview] = useState<ProjectOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newType, setNewType] = useState<ProjectItemType>("task");
  const [newTitle, setNewTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    getProjectOverview(moduleId)
      .then((next) => {
        if (active) {
          setOverview(next);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [moduleId]);

  async function reload() {
    setOverview(await getProjectOverview(moduleId));
    onChanged();
  }

  async function addItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      return;
    }
    setIsAdding(true);
    try {
      await createProjectItem(moduleId, { item_type: newType, title });
      setNewTitle("");
      await reload();
    } finally {
      setIsAdding(false);
    }
  }

  async function runItemAction(item: ProjectItem, action: () => Promise<unknown>) {
    setBusyId(item.id);
    try {
      await action();
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading && !overview) {
    return <p className="behavior-empty">טוען project…</p>;
  }
  if (!overview) {
    return <p className="behavior-empty">לא ניתן לטעון את ה-project.</p>;
  }

  const { summary, items, recent_activities } = overview;
  const groups: ProjectItemType[] = ["task", "bug", "feature"];
  const statByType: Record<ProjectItemType, { done: number; total: number }> = {
    task: { done: summary.tasks_done, total: summary.tasks_done + summary.tasks_open },
    bug: { done: summary.bugs_done, total: summary.bugs_done + summary.bugs_open },
    feature: { done: summary.features_done, total: summary.features_done + summary.features_open }
  };

  return (
    <div className="project-board">
      <div className="project-progress">
        <div className="project-progress-head">
          <strong>
            {summary.total_done}/{summary.total_done + summary.total_open} הושלמו
          </strong>
          <span>{summary.progress_percent}%</span>
        </div>
        <ProgressBar value={summary.progress_percent} accent={accent} />
        <div className="project-stat-row">
          {groups.map((type) => (
            <div className="project-stat" key={type}>
              {PROJECT_ITEM_META[type].icon}
              <span>{PROJECT_ITEM_META[type].label}</span>
              <strong>
                {statByType[type].done}/{statByType[type].total}
              </strong>
            </div>
          ))}
        </div>
      </div>

      <form className="project-add" onSubmit={addItem}>
        <select value={newType} onChange={(event) => setNewType(event.target.value as ProjectItemType)}>
          {groups.map((type) => (
            <option key={type} value={type}>
              {PROJECT_ITEM_META[type].singular}
            </option>
          ))}
        </select>
        <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="פריט חדש לסגירה" />
        <button className="project-add-btn" type="submit" disabled={isAdding || !newTitle.trim()}>
          <Plus size={16} />
          הוסף
        </button>
      </form>

      <div className="project-items">
        {items.length ? (
          items.map((item) => {
            const isDone = item.status === "done";
            return (
              <article className={`project-item ${isDone ? "done" : ""}`} key={item.id}>
                <button
                  className="project-check"
                  type="button"
                  disabled={busyId === item.id}
                  aria-label={isDone ? "פתח מחדש" : "סמן כהושלם — יירשם כפעולה"}
                  onClick={() =>
                    runItemAction(item, () =>
                      isDone ? updateProjectItem(moduleId, item.id, { status: "todo" }) : completeProjectItem(moduleId, item.id)
                    )
                  }
                >
                  {isDone ? <Check size={14} strokeWidth={3} /> : null}
                </button>
                <Chip accent={accent}>{PROJECT_ITEM_META[item.item_type].singular}</Chip>
                <span className="project-item-title">{item.title}</span>
                <button
                  className="project-del"
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => runItemAction(item, () => deleteProjectItem(moduleId, item.id))}
                  aria-label="מחק פריט"
                >
                  <Trash2 size={15} />
                </button>
              </article>
            );
          })
        ) : (
          <p className="behavior-empty">אין פריטים עדיין. הוסף task, bug או feature.</p>
        )}
      </div>

      {recent_activities.length ? (
        <div className="project-feed">
          <h4>פעילות שנרשמה מהמודול</h4>
          {recent_activities.slice(0, 4).map((activity) => (
            <div className="project-feed-row" key={activity.id}>
              <Zap size={13} />
              <span dir="auto">{activity.title}</span>
              <small>{formatActivityTime(activity.occurred_at)}</small>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const LEARNING_UNIT_META: Record<LearningUnitType, { label: string; singular: string; icon: React.ReactNode }> = {
  topic: { label: "Topics", singular: "Topic", icon: <BookOpen size={15} /> },
  lab: { label: "Labs", singular: "Lab", icon: <FlaskConical size={15} /> },
  machine: { label: "Machines", singular: "Machine", icon: <Server size={15} /> }
};

function LearningBoard({ moduleId, accent, onChanged }: { moduleId: string; accent: Accent; onChanged: () => void }) {
  const [overview, setOverview] = useState<LearningOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newType, setNewType] = useState<LearningUnitType>("machine");
  const [newTitle, setNewTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [studyMinutes, setStudyMinutes] = useState("45");
  const [isLoggingStudy, setIsLoggingStudy] = useState(false);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    getLearningOverview(moduleId)
      .then((next) => {
        if (active) {
          setOverview(next);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [moduleId]);

  async function reload() {
    setOverview(await getLearningOverview(moduleId));
    onChanged();
  }

  async function logStudy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!overview) {
      return;
    }
    setIsLoggingStudy(true);
    try {
      await quickLog({
        module_id: moduleId,
        title: `${overview.module.name} study`,
        activity_type: "study",
        duration_minutes: toOptionalMinutes(studyMinutes)
      });
      await reload();
    } finally {
      setIsLoggingStudy(false);
    }
  }

  async function addUnit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      return;
    }
    setIsAdding(true);
    try {
      await createLearningUnit(moduleId, { unit_type: newType, title });
      setNewTitle("");
      await reload();
    } finally {
      setIsAdding(false);
    }
  }

  async function runUnitAction(unitId: string, action: () => Promise<unknown>) {
    setBusyId(unitId);
    try {
      await action();
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading && !overview) {
    return <p className="behavior-empty">טוען learning…</p>;
  }
  if (!overview) {
    return <p className="behavior-empty">לא ניתן לטעון את המודול.</p>;
  }

  const { summary, units, recent_activities } = overview;
  const groups: LearningUnitType[] = ["topic", "lab", "machine"];

  return (
    <div className="project-board">
      <div className="project-progress">
        <div className="project-progress-head">
          <strong>
            {summary.learning_units_done}/{summary.learning_units_total} יחידות
          </strong>
          <span>{summary.progress_percent}%</span>
        </div>
        <ProgressBar value={summary.progress_percent} accent={accent} />
        <div className="project-stat-row">
          <div className="project-stat">
            <Target size={15} />
            <span>דק׳ השבוע</span>
            <strong>{summary.study_minutes}</strong>
          </div>
          <div className="project-stat">
            <Activity size={15} />
            <span>מפגשים</span>
            <strong>{summary.study_sessions}</strong>
          </div>
          <div className="project-stat">
            <GraduationCap size={15} />
            <span>יחידות</span>
            <strong>
              {summary.learning_units_done}/{summary.learning_units_total}
            </strong>
          </div>
        </div>
      </div>

      <form className="study-log" onSubmit={logStudy}>
        <GraduationCap size={16} />
        <span>למידה היום</span>
        <input
          inputMode="numeric"
          type="number"
          min="1"
          value={studyMinutes}
          onChange={(event) => setStudyMinutes(event.target.value)}
        />
        <span className="study-log-unit">דק׳</span>
        <button className="project-add-btn" type="submit" disabled={isLoggingStudy}>
          <Plus size={16} />
          רשום למידה
        </button>
      </form>

      <form className="project-add" onSubmit={addUnit}>
        <select value={newType} onChange={(event) => setNewType(event.target.value as LearningUnitType)}>
          {groups.map((type) => (
            <option key={type} value={type}>
              {LEARNING_UNIT_META[type].singular}
            </option>
          ))}
        </select>
        <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="יחידה חדשה ללמידה" />
        <button className="project-add-btn" type="submit" disabled={isAdding || !newTitle.trim()}>
          <Plus size={16} />
          הוסף
        </button>
      </form>

      <div className="project-items">
        {units.length ? (
          units.map((unit) => {
            const isDone = unit.status === "completed";
            return (
              <article className={`project-item ${isDone ? "done" : ""}`} key={unit.id}>
                <button
                  className="project-check"
                  type="button"
                  disabled={busyId === unit.id}
                  aria-label={isDone ? "פתח מחדש" : "סמן כהושלם — יירשם כלמידה"}
                  onClick={() =>
                    runUnitAction(unit.id, () =>
                      isDone
                        ? updateLearningUnit(moduleId, unit.id, { status: "not_started" })
                        : completeLearningUnit(moduleId, unit.id)
                    )
                  }
                >
                  {isDone ? <Check size={14} strokeWidth={3} /> : null}
                </button>
                <Chip accent={accent}>{LEARNING_UNIT_META[unit.unit_type].singular}</Chip>
                <span className="project-item-title">{unit.title}</span>
                <button
                  className="project-del"
                  type="button"
                  disabled={busyId === unit.id}
                  onClick={() => runUnitAction(unit.id, () => deleteLearningUnit(moduleId, unit.id))}
                  aria-label="מחק יחידה"
                >
                  <Trash2 size={15} />
                </button>
              </article>
            );
          })
        ) : (
          <p className="behavior-empty">אין יחידות עדיין. הוסף topic, lab או machine.</p>
        )}
      </div>

      {recent_activities.length ? (
        <div className="project-feed">
          <h4>פעילות שנרשמה מהמודול</h4>
          {recent_activities.slice(0, 4).map((activity) => (
            <div className="project-feed-row" key={activity.id}>
              <Zap size={13} />
              <span dir="auto">{activity.title}</span>
              <small>
                {formatActivityTime(activity.occurred_at)} · {activity.duration_minutes ?? 0} דק׳
              </small>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WellbeingBoard({ moduleId, accent, onChanged }: { moduleId: string; accent: Accent; onChanged: () => void }) {
  const [overview, setOverview] = useState<WellbeingOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [duration, setDuration] = useState("30");
  const [values, setValues] = useState<Record<string, number>>({});
  const [isLogging, setIsLogging] = useState(false);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    getWellbeingOverview(moduleId)
      .then((next) => {
        if (!active) {
          return;
        }
        setOverview(next);
        setValues(Object.fromEntries(next.metric_defs.map((def) => [def.key, Math.round((def.min + def.max) / 2)])));
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [moduleId]);

  async function logSession(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLogging(true);
    try {
      await logWellbeingSession(moduleId, { duration_minutes: toOptionalMinutes(duration), values });
      setOverview(await getWellbeingOverview(moduleId));
      onChanged();
    } finally {
      setIsLogging(false);
    }
  }

  if (isLoading && !overview) {
    return <p className="behavior-empty">טוען מודול…</p>;
  }
  if (!overview) {
    return <p className="behavior-empty">לא ניתן לטעון את המודול.</p>;
  }

  const { metric_defs, summary, recent_sessions, trends } = overview;

  return (
    <div className="project-board">
      <div className="wellbeing-headline">
        <div>
          <strong>{summary.sessions_week}</strong>
          <span>מפגשים השבוע</span>
        </div>
        <div>
          <strong>{summary.weekly_minutes}</strong>
          <span>דק׳ השבוע</span>
        </div>
      </div>

      <div className="wellbeing-metrics">
        {metric_defs.map((def) => {
          const stat = summary.metrics[def.key];
          const points = trends[def.key] ?? [];
          return (
            <div className="wb-metric" key={def.key}>
              <div className="wb-metric-head">
                <span>{def.label}</span>
                <strong>{stat?.latest ?? "—"}</strong>
              </div>
              <small>
                ממוצע {stat?.avg ?? "—"} · {stat?.count ?? 0} מדידות
              </small>
              <div className="wb-trend" aria-hidden="true">
                {points.length ? (
                  points.map((value, index) => {
                    const height = Math.max(8, Math.round(((value - def.min) / (def.max - def.min)) * 100));
                    return (
                      <span
                        className="wb-bar"
                        key={index}
                        style={{ height: `${height}%`, background: accentColorVar[accent] }}
                        title={String(value)}
                      />
                    );
                  })
                ) : (
                  <span className="wb-trend-empty">אין מדידות עדיין</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form className="wellbeing-log" onSubmit={logSession}>
        <div className="wb-log-head">
          <span>רישום מפגש</span>
          <label className="wb-duration">
            <input
              inputMode="numeric"
              type="number"
              min="1"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
            דק׳
          </label>
        </div>

        {metric_defs.map((def) => (
          <label className="wb-slider-row" key={def.key}>
            <span>
              {def.label} <small>{def.good === "low" ? "(נמוך = טוב)" : "(גבוה = טוב)"}</small>
            </span>
            <input
              type="range"
              min={def.min}
              max={def.max}
              value={values[def.key] ?? Math.round((def.min + def.max) / 2)}
              onChange={(event) => setValues((current) => ({ ...current, [def.key]: Number(event.target.value) }))}
            />
            <strong>{values[def.key] ?? "—"}</strong>
          </label>
        ))}

        <button className="project-add-btn wb-log-btn" type="submit" disabled={isLogging}>
          <Plus size={16} />
          רשום מפגש
        </button>
      </form>

      {recent_sessions.length ? (
        <div className="project-feed">
          <h4>מפגשים אחרונים</h4>
          {recent_sessions.slice(0, 4).map((session) => (
            <div className="project-feed-row" key={session.id}>
              <Zap size={13} />
              <span dir="auto">{session.title}</span>
              <small>
                {formatActivityTime(session.occurred_at)} · {session.duration_minutes ?? 0} דק׳
              </small>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const moduleTypes = ["project", "habit", "learning", "recovery", "relationship", "hobby", "finance", "calendar"] as const;
export const moduleStatuses = ["active", "paused", "completed", "archived"] as const;

export function ModulesView({
  modules,
  disciplines,
  isSaving,
  onCreateModule,
  onUpdateModule,
  onChanged
}: {
  modules: LifeModule[];
  disciplines: Discipline[];
  isSaving: boolean;
  onCreateModule: (payload: ModulePayload) => void;
  onUpdateModule: (moduleId: string, payload: ModuleUpdatePayload) => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof moduleTypes)[number]>("project");
  const [category, setCategory] = useState<HobbyCategory>("creative");
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
      priority: Number.parseInt(priority, 10) || 3,
      config: type === "hobby" ? { category } : undefined
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
      habit: ["weekly_target"]
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

            {type === "hobby" ? (
              <label>
                <span>קטגוריה</span>
                <select value={category} onChange={(event) => setCategory(event.target.value as HobbyCategory)}>
                  {HOBBY_CATEGORIES.map((option) => (
                    <option key={option} value={option}>
                      {HOBBY_CATEGORY_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

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
                <span className="panel-eyebrow">
                  {selectedModule?.type === "project"
                    ? "Project board · live"
                    : selectedModule?.type === "learning"
                      ? "Learning board · live"
                      : selectedModule?.type === "hobby"
                        ? "Hobby board · live"
                        : selectedModule?.type === "recovery" || selectedModule?.type === "relationship"
                          ? "Sessions · live"
                          : "MVP Behavior"}
                </span>
                <h2>{selectedModule ? selectedModule.name : "Module behavior"}</h2>
              </div>
              {selectedModule ? <Chip accent={accentForSlug(disciplines.find((discipline) => discipline.id === selectedModule.discipline_id)?.slug)}>{moduleTypeLabel(selectedModule.type)}</Chip> : null}
            </header>

            {selectedModule?.type === "project" ? (
              <ProjectBoard
                moduleId={selectedModule.id}
                accent={accentForSlug(disciplines.find((discipline) => discipline.id === selectedModule.discipline_id)?.slug)}
                onChanged={onChanged}
              />
            ) : selectedModule?.type === "learning" ? (
              <LearningBoard
                moduleId={selectedModule.id}
                accent={accentForSlug(disciplines.find((discipline) => discipline.id === selectedModule.discipline_id)?.slug)}
                onChanged={onChanged}
              />
            ) : selectedModule?.type === "hobby" ? (
              <HobbyBoard moduleId={selectedModule.id} onChanged={onChanged} />
            ) : selectedModule?.type === "recovery" || selectedModule?.type === "relationship" ? (
              <WellbeingBoard
                moduleId={selectedModule.id}
                accent={accentForSlug(disciplines.find((discipline) => discipline.id === selectedModule.discipline_id)?.slug)}
                onChanged={onChanged}
              />
            ) : (
              <>
                {renderBehaviorFields()}

                {behavior && behavior.type === "habit" ? (
                  <button className="quick-submit" type="button" onClick={saveBehavior}>
                    שמור Behavior
                  </button>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}


export function ModuleEditCard({
  module,
  disciplines,
  isSaving,
  onSave,
  onCancel
}: {
  module: LifeModule;
  disciplines: Discipline[];
  isSaving: boolean;
  onSave: (payload: ModuleUpdatePayload) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(module.name);
  const [disciplineId, setDisciplineId] = useState(module.discipline_id);
  const [priority, setPriority] = useState(String(module.priority));
  const [status, setStatus] = useState(module.status);
  const [description, setDescription] = useState(module.description ?? "");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    onSave({
      name: trimmed,
      discipline_id: disciplineId,
      priority: Number.parseInt(priority, 10) || module.priority,
      status,
      description: description.trim() || undefined
    });
  }

  return (
    <form className="quick-log-form module-edit-card" onSubmit={submit}>
      <label>
        <span>שם</span>
        <input autoFocus dir="auto" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="form-row">
        <label>
          <span>תחום</span>
          <select value={disciplineId} onChange={(event) => setDisciplineId(event.target.value)}>
            {disciplines.map((discipline) => (
              <option key={discipline.id} value={discipline.id}>
                {discipline.name}
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
        <span>סטטוס</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="active">פעיל</option>
          <option value="paused">מושהה</option>
          <option value="completed">הושלם</option>
        </select>
      </label>
      <label>
        <span>תיאור</span>
        <textarea dir="auto" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="אופציונלי" />
      </label>
      <div className="activity-edit-actions">
        <button className="quick-submit" type="submit" disabled={isSaving || !name.trim()}>
          <Save size={15} /> שמור
        </button>
        <button className="ghost-button" type="button" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </form>
  );
}

