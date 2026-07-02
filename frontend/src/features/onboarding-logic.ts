// Pure, testable helpers for the onboarding spotlight tour (no React/DOM).

export type Rect = { top: number; left: number; width: number; height: number };
export type Point = { left: number; top: number };
export type Size = { width: number; height: number };
export type Viewport = { width: number; height: number };

// Clamp a step index to [0, total-1]; dir +1 = next, -1 = back.
export function advance(index: number, total: number, dir: 1 | -1): number {
  return Math.max(0, Math.min(total - 1, index + dir));
}

// Keep a box fully inside the viewport with a margin.
export function clampToViewport(pos: Point, size: Size, viewport: Viewport, margin = 12): Point {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const maxTop = Math.max(margin, viewport.height - size.height - margin);
  return {
    left: Math.min(Math.max(pos.left, margin), maxLeft),
    top: Math.min(Math.max(pos.top, margin), maxTop)
  };
}

// Position the tooltip relative to a target rect. Centered when rect is null.
// Prefers below the target; flips above when it would overflow the bottom.
export function computeTooltipPosition(
  rect: Rect | null,
  tooltip: Size,
  viewport: Viewport,
  gap = 14,
  margin = 12
): Point {
  if (!rect) {
    return {
      left: (viewport.width - tooltip.width) / 2,
      top: (viewport.height - tooltip.height) / 2
    };
  }
  const below = rect.top + rect.height + gap;
  const fitsBelow = below + tooltip.height <= viewport.height - margin;
  const top = fitsBelow ? below : rect.top - gap - tooltip.height;
  const left = rect.left + rect.width / 2 - tooltip.width / 2;
  return clampToViewport({ left, top }, tooltip, viewport, margin);
}
