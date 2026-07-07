import { describe, expect, it } from "vitest";
import type { DashboardModule } from "../api/atlas";
import {
  HOBBY_TILE_CAP,
  gapLabel,
  gapTone,
  hobbyRows,
  weeklySessionsTotal
} from "./hobby-logic";

function hobbyModule(
  name: string,
  summary: Record<string, unknown>,
  overrides: Partial<DashboardModule> = {}
): DashboardModule {
  return {
    id: `id-${name}`,
    name,
    slug: name.toLowerCase(),
    type: "hobby",
    status: "active",
    priority: 3,
    discipline_name: "Play",
    discipline_slug: "play",
    behavior: { module_id: `id-${name}`, type: "hobby", config: {}, summary },
    ...overrides
  };
}

describe("hobbyRows", () => {
  it("keeps only hobby modules and maps the summary", () => {
    const rows = hobbyRows([
      hobbyModule("Guitar", {
        days_since_last: 12,
        ideas_open: 3,
        next_idea: { id: "i1", title: "Karma Police intro" },
        weekly_activity_count: 0,
        category: "creative"
      }),
      hobbyModule("Project", {}, { type: "project" })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Guitar",
      daysSince: 12,
      ideasOpen: 3,
      nextIdea: { id: "i1", title: "Karma Police intro" },
      category: "creative"
    });
  });

  it("orders most-starving first, never-logged at the very top", () => {
    const rows = hobbyRows([
      hobbyModule("Climbing", { days_since_last: 2, weekly_activity_count: 2 }),
      hobbyModule("Guitar", { days_since_last: 12, weekly_activity_count: 0 }),
      hobbyModule("Chess", { days_since_last: null, weekly_activity_count: 0 })
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Chess", "Guitar", "Climbing"]);
  });

  it("defaults malformed summaries safely", () => {
    const rows = hobbyRows([hobbyModule("Weird", { category: "banana", next_idea: "junk" })]);
    expect(rows[0].category).toBe("creative");
    expect(rows[0].nextIdea).toBeNull();
    expect(rows[0].daysSince).toBeNull();
    expect(rows[0].ideasOpen).toBe(0);
  });
});

describe("gap formatting", () => {
  it("labels gaps in Hebrew", () => {
    expect(gapLabel(null)).toBe("אין סשנים עדיין");
    expect(gapLabel(0)).toBe("היום");
    expect(gapLabel(1)).toBe("אתמול");
    expect(gapLabel(8)).toBe("לפני 8 ימים");
  });

  it("turns warm at 7 days or never-logged", () => {
    expect(gapTone(6)).toBe("ok");
    expect(gapTone(7)).toBe("warm");
    expect(gapTone(null)).toBe("warm");
  });
});

describe("tile totals", () => {
  it("caps at 3 and sums weekly sessions", () => {
    const rows = hobbyRows([
      hobbyModule("A", { days_since_last: 1, weekly_activity_count: 2 }),
      hobbyModule("B", { days_since_last: 2, weekly_activity_count: 1 }),
      hobbyModule("C", { days_since_last: 3, weekly_activity_count: 0 }),
      hobbyModule("D", { days_since_last: 4, weekly_activity_count: 1 })
    ]);
    expect(rows.length).toBe(4);
    expect(rows.slice(0, HOBBY_TILE_CAP).map((row) => row.name)).toEqual(["D", "C", "B"]);
    expect(weeklySessionsTotal(rows)).toBe(4);
  });
});
