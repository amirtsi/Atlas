import type { Accent, DashboardModule } from "../api/atlas";

// Pure hobby-tile logic: mapping dashboard modules to rows, ordering, and
// gap formatting. Keep React out of this file — it is unit-tested directly.

export type HobbyCategory = "creative" | "physical" | "maker" | "games";

export type HobbyRow = {
  id: string;
  name: string;
  category: HobbyCategory;
  daysSince: number | null;
  ideasOpen: number;
  nextIdea: { id: string; title: string } | null;
  weeklyCount: number;
};

export const HOBBY_TILE_CAP = 3;
export const HOBBY_GAP_WARM_DAYS = 7;

export const HOBBY_CATEGORIES: HobbyCategory[] = ["creative", "physical", "maker", "games"];

export const HOBBY_CATEGORY_LABELS: Record<HobbyCategory, string> = {
  creative: "יצירה",
  physical: "גוף",
  maker: "מייקר",
  games: "משחקים"
};

const CATEGORY_ACCENTS: Record<HobbyCategory, Accent> = {
  creative: "purple",
  physical: "green",
  maker: "orange",
  games: "red"
};

export function categoryAccent(category: HobbyCategory): Accent {
  return CATEGORY_ACCENTS[category];
}

function toCategory(value: unknown): HobbyCategory {
  return value === "physical" || value === "maker" || value === "games" ? value : "creative";
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Never-logged (null gap) is the most starving; then longest gap; name as a stable tiebreak.
function starvingFirst(left: HobbyRow, right: HobbyRow): number {
  const leftGap = left.daysSince ?? Number.POSITIVE_INFINITY;
  const rightGap = right.daysSince ?? Number.POSITIVE_INFINITY;
  if (leftGap !== rightGap) {
    return rightGap - leftGap;
  }
  return left.name.localeCompare(right.name);
}

export function hobbyRows(modules: DashboardModule[]): HobbyRow[] {
  return modules
    .filter((module) => module.type === "hobby")
    .map((module) => {
      const summary = (module.behavior?.summary ?? {}) as Record<string, unknown>;
      const rawIdea = summary.next_idea as { id?: unknown; title?: unknown } | null | undefined;
      const nextIdea =
        rawIdea && typeof rawIdea === "object" && typeof rawIdea.id === "string" && typeof rawIdea.title === "string"
          ? { id: rawIdea.id, title: rawIdea.title }
          : null;
      return {
        id: module.id,
        name: module.name,
        category: toCategory(summary.category),
        daysSince: typeof summary.days_since_last === "number" ? summary.days_since_last : null,
        ideasOpen: toCount(summary.ideas_open),
        nextIdea,
        weeklyCount: toCount(summary.weekly_activity_count)
      };
    })
    .sort(starvingFirst);
}

export function gapLabel(daysSince: number | null): string {
  if (daysSince === null) {
    return "אין סשנים עדיין";
  }
  if (daysSince === 0) {
    return "היום";
  }
  if (daysSince === 1) {
    return "אתמול";
  }
  return `לפני ${daysSince} ימים`;
}

export function gapTone(daysSince: number | null): "warm" | "ok" {
  return daysSince === null || daysSince >= HOBBY_GAP_WARM_DAYS ? "warm" : "ok";
}

export function weeklySessionsTotal(rows: HobbyRow[]): number {
  return rows.reduce((sum, row) => sum + row.weeklyCount, 0);
}
