import type { Accent, Drift, PlanStep } from "../api/atlas";

// The next step = lowest-sequence step not yet done. null when none remain / empty.
export function pickNextStep(steps: PlanStep[]): PlanStep | null {
  const pending = steps.filter((s) => s.progress.status !== "done");
  if (pending.length === 0) {
    return null;
  }
  return pending.reduce((best, s) => (s.sequence < best.sequence ? s : best));
}

// Drift → chip. null when drift is null (no target date) → the tile shows no chip.
export function driftChip(drift: Drift | null): { label: string; accent: Accent } | null {
  if (!drift) {
    return null;
  }
  return drift.on_track ? { label: "on track", accent: "green" } : { label: "behind", accent: "orange" };
}
