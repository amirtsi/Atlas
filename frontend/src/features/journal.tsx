import { useState } from "react";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";

import type {
  ActivityUpdatePayload,
  CreateActivityPayload,
  Discipline,
  JournalActivity,
  LifeModule
} from "../api/atlas";
import { Chip } from "../shared/ui";
import {
  accentForSlug,
  disciplineLabel,
  formatActivityTime,
  formatDateKey,
  moduleTypeLabel,
  toOptionalMinutes
} from "../shared/format";

// Activity editing + the journal view. EditableActivityRow and DayQuickAdd are
// also reused by the dashboard cockpit modals.

function ActivityEditForm({
  activity,
  modules,
  onSave,
  onCancel
}: {
  activity: JournalActivity;
  modules: LifeModule[];
  onSave: (payload: ActivityUpdatePayload) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(activity.title);
  const [duration, setDuration] = useState(activity.duration_minutes != null ? String(activity.duration_minutes) : "");
  const [notes, setNotes] = useState(activity.notes ?? "");
  const [moduleId, setModuleId] = useState(activity.module_id ?? "");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    const payload: ActivityUpdatePayload = {
      title: trimmed,
      duration_minutes: duration.trim() ? Number(duration) : null,
      notes: notes.trim() || null
    };
    // Only send module_id when it actually changed — null moves it to "general".
    if (moduleId !== (activity.module_id ?? "")) {
      payload.module_id = moduleId || null;
    }
    onSave(payload);
  }

  return (
    <form className="activity-edit-form quick-log-form" onSubmit={submit}>
      <label>
        <span>כותרת</span>
        <input autoFocus dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <div className="form-row">
        <label>
          <span>Module</span>
          <select value={moduleId} onChange={(event) => setModuleId(event.target.value)}>
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
            min="0"
            type="number"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            placeholder="אופציונלי"
          />
        </label>
      </div>
      <label>
        <span>הערה</span>
        <textarea dir="auto" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="אופציונלי" />
      </label>
      <div className="activity-edit-actions">
        <button className="quick-submit" type="submit" disabled={!title.trim()}>
          <Save size={15} /> שמור
        </button>
        <button className="ghost-button" type="button" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </form>
  );
}

export function EditableActivityRow({
  activity,
  modules,
  showDate = false,
  onUpdate,
  onDelete
}: {
  activity: JournalActivity;
  modules: LifeModule[];
  showDate?: boolean;
  onUpdate: (id: string, payload: ActivityUpdatePayload) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <article className="activity-row editing">
        <ActivityEditForm
          activity={activity}
          modules={modules}
          onSave={(payload) => {
            onUpdate(activity.id, payload);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </article>
    );
  }

  return (
    <article className="activity-row">
      <div className="activity-row-main">
        <div className="timeline-title-row">
          <strong dir="auto">{activity.title}</strong>
          <Chip accent={accentForSlug(activity.discipline_slug)}>
            {disciplineLabel(activity.discipline_slug, activity.discipline_name)}
          </Chip>
        </div>
        <span className="activity-row-meta">
          {showDate ? `${new Date(activity.occurred_at).toLocaleDateString("he-IL")} · ` : ""}
          {formatActivityTime(activity.occurred_at)} · {activity.module_name ?? activity.activity_type} · {activity.duration_minutes ?? 0} דק׳
        </span>
        {activity.notes ? <small className="activity-row-notes" dir="auto">{activity.notes}</small> : null}
      </div>
      <div className="activity-actions">
        {confirming ? (
          <>
            <button className="activity-action danger" type="button" onClick={() => onDelete(activity.id)}>
              מחק
            </button>
            <button className="activity-action" type="button" onClick={() => setConfirming(false)}>
              ביטול
            </button>
          </>
        ) : (
          <>
            <button className="icon-button small" type="button" aria-label="ערוך פעולה" onClick={() => setEditing(true)}>
              <Pencil size={15} />
            </button>
            <button className="icon-button small" type="button" aria-label="מחק פעולה" onClick={() => setConfirming(true)}>
              <Trash2 size={15} />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function DayQuickAdd({
  dateKey,
  modules,
  disciplines,
  onAdd
}: {
  dateKey: string;
  modules: LifeModule[];
  disciplines: Discipline[];
  onAdd: (payload: CreateActivityPayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [duration, setDuration] = useState("30");

  const selectedModule = modules.find((module) => module.id === moduleId);
  const fallbackDisciplineId = disciplines[0]?.id;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    // Stamp the activity on the selected day, keeping the current time-of-day.
    const now = new Date();
    const occurred = new Date(`${dateKey}T00:00:00`);
    occurred.setHours(now.getHours(), now.getMinutes(), 0, 0);
    onAdd({
      title: trimmed,
      module_id: moduleId || undefined,
      discipline_id: selectedModule ? selectedModule.discipline_id : fallbackDisciplineId,
      activity_type: selectedModule?.type ?? "manual",
      duration_minutes: toOptionalMinutes(duration),
      occurred_at: occurred.toISOString(),
      source: "manual"
    });
    setTitle("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button className="day-quick-add-trigger" type="button" onClick={() => setOpen(true)}>
        <Plus size={15} /> הוסף פעולה ליום זה
      </button>
    );
  }

  return (
    <form className="day-quick-add quick-log-form" onSubmit={submit}>
      <label>
        <span>מה נעשה?</span>
        <input autoFocus dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="לדוגמה: אימון" />
      </label>
      <div className="form-row">
        <label>
          <span>Module</span>
          <select value={moduleId} onChange={(event) => setModuleId(event.target.value)}>
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
          <input inputMode="numeric" min="1" type="number" value={duration} onChange={(event) => setDuration(event.target.value)} />
        </label>
      </div>
      <div className="activity-edit-actions">
        <button className="quick-submit" type="submit" disabled={!title.trim()}>
          <Plus size={15} /> הוסף
        </button>
        <button className="ghost-button" type="button" onClick={() => setOpen(false)}>
          ביטול
        </button>
      </div>
    </form>
  );
}

export function JournalView({
  activities,
  modules,
  disciplines,
  onUpdateActivity,
  onDeleteActivity,
  onAddActivity
}: {
  activities: JournalActivity[];
  modules: LifeModule[];
  disciplines: Discipline[];
  onUpdateActivity: (id: string, payload: ActivityUpdatePayload) => void;
  onDeleteActivity: (id: string) => void;
  onAddActivity: (payload: CreateActivityPayload) => void;
}) {
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
          </aside>
        </div>
      ) : (
        <div className="ledger-list">
          {activities.length ? (
            activities.map((activity) => (
              <EditableActivityRow
                key={activity.id}
                activity={activity}
                modules={modules}
                showDate
                onUpdate={onUpdateActivity}
                onDelete={onDeleteActivity}
              />
            ))
          ) : (
            <p className="behavior-empty">אין פעילויות עדיין. הוסף אחת מה־Quick Log או מהיומן.</p>
          )}
        </div>
      )}
    </section>
  );
}
