import { describe, expect, it } from "vitest";
import type { Drift, PlanStep } from "../api/atlas";
import { driftChip, pickNextStep } from "./coach-logic";

function step(sequence: number, status: string): PlanStep {
  return {
    id: `s${sequence}`,
    title: `step ${sequence}`,
    description: null,
    kind: "topic",
    sequence,
    progress: { done: 0, target: 1, ratio: 0, status, last_activity_at: null }
  };
}

function drift(on_track: boolean): Drift {
  return { expected_percent: 0.5, actual_percent: 0.3, drift: -0.2, projected_completion: null, on_track };
}

describe("pickNextStep", () => {
  it("returns the lowest-sequence step that is not done", () => {
    const steps = [step(2, "pending"), step(0, "done"), step(1, "in_progress")];
    expect(pickNextStep(steps)?.id).toBe("s1");
  });

  it("returns null when every step is done", () => {
    expect(pickNextStep([step(0, "done"), step(1, "done")])).toBeNull();
  });

  it("returns null for an empty plan", () => {
    expect(pickNextStep([])).toBeNull();
  });
});

describe("driftChip", () => {
  it("labels an on-track goal", () => {
    expect(driftChip(drift(true))).toEqual({ label: "on track", accent: "green" });
  });

  it("labels a behind goal", () => {
    expect(driftChip(drift(false))).toEqual({ label: "behind", accent: "orange" });
  });

  it("returns null when there is no drift data", () => {
    expect(driftChip(null)).toBeNull();
  });
});
