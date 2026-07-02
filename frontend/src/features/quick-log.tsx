import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  type ActivityTemplate,
  type ActivityTemplatePayload,
  type Discipline,
  type LifeModule,
  type PlanStep,
  type QuickLogPayload,
  getGoalPlan,
  getGoals
} from "../api/atlas";
import { moduleTypeLabel, toOptionalMinutes } from "../shared/format";

export function QuickLogSheet({
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
  onCustomLog: (payload: QuickLogPayload, stepId?: string) => void;
  onCreateTemplate: (payload: ActivityTemplatePayload) => void;
}) {
  const [mode, setMode] = useState<"templates" | "custom" | "template">("templates");
  const [customTitle, setCustomTitle] = useState("");
  const [customModuleId, setCustomModuleId] = useState("");
  const [customDuration, setCustomDuration] = useState("30");
  const [customNotes, setCustomNotes] = useState("");
  const [customStepId, setCustomStepId] = useState("");
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateModuleId, setTemplateModuleId] = useState("");
  const [templateDuration, setTemplateDuration] = useState("30");

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let active = true;
    // Best-effort: offer the top active goal's not-done steps to attach to.
    (async () => {
      try {
        const goals = await getGoals("active");
        if (!goals.length) {
          return;
        }
        const plan = await getGoalPlan(goals[0].id);
        if (active) {
          setPlanSteps(plan.steps.filter((s) => s.progress.status !== "done"));
        }
      } catch {
        if (active) {
          setPlanSteps([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [isOpen]);

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
    onCustomLog(
      {
        title,
        module_id: customModuleId || undefined,
        discipline_id: selectedCustomModule ? selectedCustomModule.discipline_id : fallbackDisciplineId,
        activity_type: selectedCustomModule?.type ?? "manual",
        duration_minutes: toOptionalMinutes(customDuration),
        notes: customNotes.trim() || undefined
      },
      customStepId || undefined
    );
    setCustomStepId("");
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
            {planSteps.length ? (
              <label>
                <span>קשר לצעד בתוכנית (אופציונלי)</span>
                <select value={customStepId} onChange={(event) => setCustomStepId(event.target.value)}>
                  <option value="">ללא</option>
                  {planSteps.map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
