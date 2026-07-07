import { useCallback, useEffect, useState } from "react";
import { Check, Palette, Pin, Plus, Save, Trash2, X } from "lucide-react";

import {
  completeHobbyIdea,
  createHobbyIdea,
  dropHobbyIdea,
  getModuleBehavior,
  listHobbyIdeas,
  quickLog,
  updateHobbyIdea,
  type DashboardResponse,
  type HobbyIdea,
  type ModuleBehavior
} from "../api/atlas";
import { Chip, Modal, Panel } from "../shared/ui";
import {
  HOBBY_CATEGORY_LABELS,
  HOBBY_TILE_CAP,
  categoryAccent,
  gapLabel,
  gapTone,
  hobbyRows,
  weeklySessionsTotal,
  type HobbyRow
} from "./hobby-logic";

// Hobbies feature: kiosk tile + expand modal + the modules-page board.
// All hobby UI lives here; dashboard/modules only import and mount.

export function HobbiesTile({ dashboard, onChanged }: { dashboard: DashboardResponse | null; onChanged?: () => void }) {
  const rows = hobbyRows(dashboard?.active_modules ?? []);
  const [isOpen, setIsOpen] = useState(false);

  if (!rows.length) {
    return null;
  }

  return (
    <>
      <Panel
        title="Hobbies"
        eyebrow="Idea backlog · act on it"
        icon={<Palette size={21} />}
        className="hobbies-panel"
        onOpen={() => setIsOpen(true)}
      >
        <div className="hobby-tile-rows">
          {rows.slice(0, HOBBY_TILE_CAP).map((row) => (
            <div className="hobby-tile-row" key={row.id}>
              <div className="hobby-tile-line">
                <strong dir="auto">{row.name}</strong>
                <Chip accent={categoryAccent(row.category)}>{HOBBY_CATEGORY_LABELS[row.category]}</Chip>
                <span className={`hobby-gap hobby-gap-${gapTone(row.daysSince)}`}>{gapLabel(row.daysSince)}</span>
              </div>
              <p className="hobby-next" dir="auto">
                {row.nextIdea ? (
                  <>
                    <span className="hobby-next-tag">NEXT</span>
                    {row.nextIdea.title}
                  </>
                ) : (
                  "אין רעיון פתוח — הוסף אחד"
                )}
              </p>
            </div>
          ))}
        </div>
        <footer className="hobby-tile-foot">
          <span>{weeklySessionsTotal(rows)} סשנים השבוע</span>
          {rows.length > HOBBY_TILE_CAP ? <span>+{rows.length - HOBBY_TILE_CAP} עוד</span> : null}
        </footer>
      </Panel>

      {isOpen ? (
        <Modal eyebrow="Idea backlog" title="Hobbies" onClose={() => setIsOpen(false)}>
          <div className="hobby-modal">
            {rows.map((row) => (
              <HobbyModalRow key={row.id} row={row} onChanged={onChanged} />
            ))}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function HobbyModalRow({ row, onChanged }: { row: HobbyRow; onChanged?: () => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [backlogKey, setBacklogKey] = useState(0);

  async function didIt() {
    if (!row.nextIdea || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await completeHobbyIdea(row.id, row.nextIdea.id);
      setBacklogKey((v) => v + 1);
      onChanged?.();
    } finally {
      setIsBusy(false);
    }
  }

  async function logSession() {
    if (isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await quickLog({ module_id: row.id, title: `סשן ${row.name}`, activity_type: "hobby" });
      setBacklogKey((v) => v + 1);
      onChanged?.();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <article className="hobby-modal-row">
      <div className="hobby-modal-head">
        <strong dir="auto">{row.name}</strong>
        <Chip accent={categoryAccent(row.category)}>{HOBBY_CATEGORY_LABELS[row.category]}</Chip>
        <span className="spacer" />
        <button className="hobby-action primary" type="button" disabled={!row.nextIdea || isBusy} onClick={didIt}>
          <Check size={14} />
          עשיתי את זה
        </button>
        <button className="hobby-action" type="button" disabled={isBusy} onClick={logSession}>
          לוג סשן
        </button>
        <button className="hobby-action" type="button" onClick={() => setIsExpanded((value) => !value)}>
          {isExpanded ? "סגור" : "רעיונות"}
        </button>
      </div>
      <p className="hobby-modal-stats" dir="auto">
        {gapLabel(row.daysSince)} · {row.weeklyCount} סשנים השבוע · {row.ideasOpen} רעיונות פתוחים
        {row.nextIdea ? <> · הבא: {row.nextIdea.title}</> : null}
      </p>
      {isExpanded ? <IdeaBacklog moduleId={row.id} onChanged={onChanged} refreshKey={backlogKey} /> : null}
    </article>
  );
}

export function IdeaBacklog({
  moduleId,
  onChanged,
  refreshKey
}: {
  moduleId: string;
  onChanged?: () => void;
  refreshKey?: number;
}) {
  const [ideas, setIdeas] = useState<HobbyIdea[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const reload = useCallback(() => {
    setIsLoading(true);
    listHobbyIdeas(moduleId)
      .then(setIdeas)
      .finally(() => setIsLoading(false));
  }, [moduleId]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  async function run(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await action();
      reload();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  async function addIdea(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title || isAdding) {
      return;
    }
    setIsAdding(true);
    try {
      await createHobbyIdea(moduleId, { title });
      setNewTitle("");
      reload();
      onChanged?.();
    } finally {
      setIsAdding(false);
    }
  }

  async function saveEdit(id: string) {
    const title = editTitle.trim();
    if (!title) {
      return;
    }
    await run(id, () => updateHobbyIdea(moduleId, id, { title }));
    setEditId(null);
  }

  const openIdeas = ideas.filter((idea) => idea.status === "open");
  const closedIdeas = ideas.filter((idea) => idea.status !== "open");

  return (
    <div className="hobby-backlog">
      <span className="hobby-backlog-title">רעיונות</span>
      {isLoading ? <p className="hobby-backlog-empty">טוען…</p> : null}
      {!isLoading && !openIdeas.length ? <p className="hobby-backlog-empty">אין רעיון פתוח — הוסף אחד</p> : null}

      {openIdeas.map((idea) => (
        <div className="hobby-idea" key={idea.id}>
          {idea.pinned ? <span className="hobby-idea-pin">NEXT</span> : null}
          {editId === idea.id ? (
            <>
              <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} dir="auto" />
              <button className="hobby-action" type="button" disabled={busyId === idea.id} onClick={() => saveEdit(idea.id)}>
                <Save size={13} />
              </button>
              <button className="hobby-action" type="button" onClick={() => setEditId(null)}>
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              <span className="title" dir="auto">{idea.title}</span>
              <button
                className="hobby-action"
                type="button"
                disabled={busyId === idea.id}
                onClick={() => run(idea.id, () => completeHobbyIdea(moduleId, idea.id))}
                title="עשיתי את זה — סוגר ורושם סשן"
              >
                <Check size={13} />
              </button>
              {!idea.pinned ? (
                <button
                  className="hobby-action"
                  type="button"
                  disabled={busyId === idea.id}
                  onClick={() => run(idea.id, () => updateHobbyIdea(moduleId, idea.id, { pinned: true }))}
                  title="הצמד כרעיון הבא"
                >
                  <Pin size={13} />
                </button>
              ) : null}
              <button
                className="hobby-action"
                type="button"
                onClick={() => {
                  setEditId(idea.id);
                  setEditTitle(idea.title);
                }}
                title="עריכה"
              >
                עריכה
              </button>
              <button
                className="hobby-action danger"
                type="button"
                disabled={busyId === idea.id}
                onClick={() => run(idea.id, () => dropHobbyIdea(moduleId, idea.id))}
                title="ויתור — בלי לרשום סשן"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      ))}

      {closedIdeas.slice(0, 3).map((idea) => (
        <div className="hobby-idea hobby-idea-closed" key={idea.id}>
          <span className="title" dir="auto">{idea.title}</span>
          <small>{idea.status === "done" ? "בוצע" : "ירד"}</small>
        </div>
      ))}

      <form className="hobby-idea-add" onSubmit={addIdea}>
        <input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder="רעיון חדש…"
          dir="auto"
        />
        <button className="hobby-action" type="submit" disabled={isAdding}>
          <Plus size={13} />
          הוסף
        </button>
      </form>
    </div>
  );
}

export function HobbyBoard({ moduleId, onChanged }: { moduleId: string; onChanged: () => void }) {
  const [behavior, setBehavior] = useState<ModuleBehavior | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    getModuleBehavior(moduleId).then((next) => {
      if (active) {
        setBehavior(next);
      }
    });
    return () => {
      active = false;
    };
  }, [moduleId, refreshKey]);

  const summary = (behavior?.summary ?? {}) as Record<string, unknown>;
  const daysSince = typeof summary.days_since_last === "number" ? summary.days_since_last : null;

  function handleChanged() {
    setRefreshKey((value) => value + 1);
    onChanged();
  }

  return (
    <div className="hobby-board">
      <div className="hobby-stat-row">
        <div className="hobby-stat">
          <strong>{daysSince ?? "—"}</strong>
          <span>ימים מאז</span>
        </div>
        <div className="hobby-stat">
          <strong>{Number(summary.weekly_activity_count ?? 0)}</strong>
          <span>סשנים השבוע</span>
        </div>
        <div className="hobby-stat">
          <strong>{Number(summary.weekly_minutes ?? 0)}</strong>
          <span>דקות השבוע</span>
        </div>
        <div className="hobby-stat">
          <strong>{Number(summary.ideas_open ?? 0)}</strong>
          <span>רעיונות פתוחים</span>
        </div>
      </div>
      <IdeaBacklog moduleId={moduleId} onChanged={handleChanged} />
    </div>
  );
}
