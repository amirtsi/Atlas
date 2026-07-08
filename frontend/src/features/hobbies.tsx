import { useCallback, useEffect, useState } from "react";
import { Check, Palette, Pin, Plus, SkipForward, Trash2 } from "lucide-react";

import {
  completeHobbyIdea,
  createHobbyIdea,
  deferHobbyIdea,
  deleteHobbyIdea,
  dropHobbyIdea,
  getModuleBehavior,
  listHobbyIdeas,
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
  type HobbyRow
} from "./hobby-logic";

// Hobbies feature: kiosk tile + the idea-deck modal. A hobby answers two
// questions — how long since the last session, and what's the next idea.
// No weekly counts (Habit's job), no task checklists (Project's job).

export function HobbiesTile({ dashboard, onChanged }: { dashboard: DashboardResponse | null; onChanged?: () => void }) {
  const rows = hobbyRows(dashboard?.active_modules ?? []);
  const [isOpen, setIsOpen] = useState(false);

  if (!rows.length) {
    return null;
  }

  return (
    <>
      <Panel
        title="תחביבים"
        eyebrow="מה הדבר הבא?"
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
              <p className="hobby-next">
                {row.nextIdea ? (
                  <>
                    <span className="hobby-next-tag">הבא</span>
                    <bdi>{row.nextIdea.title}</bdi>
                  </>
                ) : (
                  "החפיסה ריקה — הוסף רעיון"
                )}
              </p>
            </div>
          ))}
        </div>
        <footer className="hobby-tile-foot">
          <span>{rows.length > HOBBY_TILE_CAP ? `עוד ${rows.length - HOBBY_TILE_CAP} · הרחב` : "הרחב"}</span>
        </footer>
      </Panel>

      {isOpen ? (
        <Modal eyebrow="חפיסת רעיונות" title="תחביבים" onClose={() => setIsOpen(false)}>
          <div className="hobby-modal">
            {rows.map((row) => (
              <HobbyDeck
                key={row.id}
                moduleId={row.id}
                name={row.name}
                category={row.category}
                daysSince={row.daysSince}
                nextIdea={row.nextIdea}
                ideasOpen={row.ideasOpen}
                onChanged={onChanged}
              />
            ))}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

type HobbyDeckProps = {
  moduleId: string;
  name?: string;
  category?: HobbyRow["category"];
  daysSince: number | null;
  nextIdea: { id: string; title: string } | null;
  ideasOpen: number;
  onChanged?: () => void;
};

// One hobby's deck: the next-idea card (עשיתי / דלג / ויתור) + the editor
// behind it. Used by the dashboard modal and the modules page alike.
function HobbyDeck({ moduleId, name, category, daysSince, nextIdea, ideasOpen, onChanged }: HobbyDeckProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  async function cardAction(action: (moduleId: string, ideaId: string) => Promise<unknown>) {
    if (!nextIdea || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await action(moduleId, nextIdea.id);
      setEditorKey((value) => value + 1);
      onChanged?.();
    } finally {
      setIsBusy(false);
    }
  }

  const restCount = Math.max(0, ideasOpen - 1);

  return (
    <article className="hobby-deck">
      <div className="hobby-deck-head">
        {name ? (
          <>
            <strong dir="auto">{name}</strong>
            {category ? <Chip accent={categoryAccent(category)}>{HOBBY_CATEGORY_LABELS[category]}</Chip> : null}
          </>
        ) : null}
        <span className={`hobby-gap hobby-gap-${gapTone(daysSince)}`}>{gapLabel(daysSince)}</span>
      </div>

      {nextIdea ? (
        <div className="hobby-next-card">
          <span className="hobby-next-tag">הבא</span>
          <span className="hobby-next-title" dir="auto">{nextIdea.title}</span>
          <span className="hobby-card-actions">
            <button className="hobby-action primary" type="button" disabled={isBusy} onClick={() => cardAction(completeHobbyIdea)}>
              <Check size={14} />
              עשיתי
            </button>
            <button className="hobby-action" type="button" disabled={isBusy} onClick={() => cardAction(deferHobbyIdea)} title="לסוף החפיסה">
              <SkipForward size={13} />
              דלג
            </button>
            <button className="hobby-action ghost" type="button" disabled={isBusy} onClick={() => cardAction(dropHobbyIdea)} title="יורד מהחפיסה בלי לרשום סשן">
              ויתור
            </button>
          </span>
        </div>
      ) : (
        <div className="hobby-next-card hobby-next-card-empty">החפיסה ריקה — הוסף רעיון אחד ותמיד יהיה "הבא"</div>
      )}

      <p className="hobby-deck-more">
        {restCount ? `עוד ${restCount} רעיונות בחפיסה · ` : null}
        <button className="hobby-editor-link" type="button" onClick={() => setIsEditorOpen((value) => !value)}>
          {isEditorOpen ? "סגור עריכה" : "עריכת רעיונות"}
        </button>
      </p>

      {isEditorOpen ? <DeckEditor moduleId={moduleId} refreshKey={editorKey} onChanged={onChanged} /> : null}
    </article>
  );
}

// The editor behind the card: add / pin / delete. No statuses, no checkboxes.
function DeckEditor({ moduleId, refreshKey, onChanged }: { moduleId: string; refreshKey?: number; onChanged?: () => void }) {
  const [ideas, setIdeas] = useState<HobbyIdea[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const reload = useCallback(() => {
    setIsLoading(true);
    listHobbyIdeas(moduleId, "open")
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

  return (
    <div className="hobby-editor">
      {isLoading ? <p className="hobby-editor-empty">טוען…</p> : null}
      {!isLoading && !ideas.length ? <p className="hobby-editor-empty">אין רעיונות בחפיסה</p> : null}

      {ideas.map((idea) => (
        <div className="hobby-idea" key={idea.id}>
          {idea.pinned ? <span className="hobby-idea-pin">הבא</span> : null}
          <span className="title" dir="auto">{idea.title}</span>
          {!idea.pinned ? (
            <button
              className="hobby-action"
              type="button"
              disabled={busyId === idea.id}
              onClick={() => run(idea.id, () => updateHobbyIdea(moduleId, idea.id, { pinned: true }))}
              title="הצמד לראש החפיסה"
            >
              <Pin size={13} />
            </button>
          ) : null}
          <button
            className="hobby-action danger"
            type="button"
            disabled={busyId === idea.id}
            onClick={() => run(idea.id, () => deleteHobbyIdea(moduleId, idea.id))}
            title="מחיקה"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      <form className="hobby-idea-add" onSubmit={addIdea}>
        <input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          placeholder="רעיון חדש לחפיסה…"
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

// Modules page: same deck, fed by the module's behavior summary. The panel
// header already names the module, so the deck head shows only the gap.
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
  const rawIdea = summary.next_idea as { id?: unknown; title?: unknown } | null | undefined;
  const nextIdea =
    rawIdea && typeof rawIdea === "object" && typeof rawIdea.id === "string" && typeof rawIdea.title === "string"
      ? { id: rawIdea.id, title: rawIdea.title }
      : null;

  function handleChanged() {
    setRefreshKey((value) => value + 1);
    onChanged();
  }

  return (
    <div className="hobby-board">
      <HobbyDeck
        moduleId={moduleId}
        daysSince={typeof summary.days_since_last === "number" ? summary.days_since_last : null}
        nextIdea={nextIdea}
        ideasOpen={typeof summary.ideas_open === "number" ? summary.ideas_open : 0}
        onChanged={handleChanged}
      />
    </div>
  );
}
