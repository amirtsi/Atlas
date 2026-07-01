import type { Accent } from "../api/atlas";

// Pure presentation/formatting helpers shared across features. No React, no I/O.

export function disciplineLabel(slug?: string | null, name?: string | null): string {
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

export function accentForSlug(slug?: string | null): Accent {
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

export const accentColorVar: Record<Accent, string> = {
  blue: "var(--blue)",
  purple: "var(--purple)",
  green: "var(--green)",
  orange: "var(--orange)",
  red: "var(--red)",
  neutral: "rgba(255, 255, 255, 0.45)"
};

export function formatActivityTime(occurredAt: string): string {
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

export function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function toOptionalMinutes(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function toNumberDraft(value: unknown, fallback = 0): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback);
}

export function summaryNumber(summary: Record<string, unknown>, key: string, fallback = 0): number {
  const value = summary[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function toConfigNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function moduleTypeLabel(type: string): string {
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

export function moduleStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: "פעיל",
    paused: "מושהה",
    completed: "הושלם",
    archived: "בארכיון"
  };
  return labels[status] ?? status;
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function severityAccent(severity: string): Accent {
  if (severity === "critical") return "red";
  if (severity === "warning") return "orange";
  return "blue";
}

export function severityLabel(severity: string): string {
  if (severity === "critical") return "דחוף";
  if (severity === "warning") return "דורש תשומת לב";
  return "המלצה";
}
