import { describe, expect, it } from "vitest";

import { advance, clampToViewport, computeTooltipPosition } from "./onboarding-logic";

describe("advance", () => {
  it("moves forward and backward within bounds", () => {
    expect(advance(0, 5, 1)).toBe(1);
    expect(advance(2, 5, -1)).toBe(1);
  });
  it("stops at the ends", () => {
    expect(advance(0, 5, -1)).toBe(0);
    expect(advance(4, 5, 1)).toBe(4);
  });
});

describe("clampToViewport", () => {
  it("pushes a box back inside the viewport", () => {
    const pos = clampToViewport({ left: -50, top: 10_000 }, { width: 200, height: 100 }, { width: 1000, height: 800 });
    expect(pos.left).toBe(12);
    expect(pos.top).toBe(800 - 100 - 12);
  });
});

describe("computeTooltipPosition", () => {
  const vp = { width: 1000, height: 800 };
  const tip = { width: 300, height: 160 };

  it("centers when there is no target", () => {
    expect(computeTooltipPosition(null, tip, vp)).toEqual({ left: 350, top: 320 });
  });

  it("places below a target with room underneath", () => {
    const pos = computeTooltipPosition({ top: 100, left: 400, width: 200, height: 120 }, tip, vp);
    expect(pos.top).toBe(100 + 120 + 14); // below
    expect(pos.left).toBe(400 + 100 - 150); // centered on target
  });

  it("flips above when the target is near the bottom", () => {
    const rect = { top: 700, left: 400, width: 200, height: 80 };
    const pos = computeTooltipPosition(rect, tip, vp);
    expect(pos.top).toBe(700 - 14 - 160); // above
  });
});
