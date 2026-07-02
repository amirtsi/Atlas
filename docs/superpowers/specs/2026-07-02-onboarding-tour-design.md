# Onboarding Spotlight Tour — Design Spec

- **Date:** 2026-07-02
- **Status:** Approved (design); ready for planning
- **Basis:** the unified command hero + Command Center; the fixed no-scroll bento kiosk.

## 1. Summary

A first-run **spotlight guided tour** that teaches the whole system by dimming the screen
and highlighting each real UI element in sequence with an RTL tooltip (title + body),
Back / Next / Skip, and progress dots. It auto-runs once on first visit (a localStorage
flag) and is re-launchable any time from a **help ("?")** button in the rail.

Because the dashboard is a fixed **no-scroll kiosk**, every target tile is always on-screen
— spotlight positioning needs no scrolling and stays stable. The tour anchors to
**existing CSS class hooks**, so no existing component changes for targeting.

## 2. Goals / Non-goals

**Goals**
- One self-contained `OnboardingTour` component (overlay + spotlight + tooltip + controls).
- A step list covering every feature surface: command hero, Life Pulse, Mission Center,
  Life Timeline, Calendar, News/Quotes, Quick-Log, and the rail navigation.
- Auto-run on first visit (persisted), plus a re-launch **help button** in the rail.
- Keyboard + accessibility: Esc = skip, ←/→ = back/next, focus on the tooltip,
  `prefers-reduced-motion` respected, `aria` dialog semantics.
- Pure web React; emerald/enterprise aesthetic; RTL Hebrew copy. No new dependency.

**Non-goals**
- No cross-view tour steps that navigate into Journal/Modules/etc. (the tour explains the
  rail nav by pointing at it, without switching views — single-screen tour).
- No backend, no analytics, no multi-tour/versioned re-onboarding beyond one flag.
- No tour library (Shepherd/Intro.js) — a ~1 file implementation.

## 3. Targeting (existing hooks — no component edits)

| Step | Selector | Feature |
|---|---|---|
| welcome | (none, centered) | intro |
| hero | `.tile-hero` | command center hero (next action + plan + proposals) |
| pulse | `.life-pulse-panel` | weekly balance across disciplines |
| missions | `.mission-panel` | active modules + real progress |
| timeline | `.timeline-panel` | today's real logged actions |
| calendar | `.dashboard-calendar-panel` | activity calendar |
| news | `.news-panel` | Hacker News + daily quote |
| quicklog | `.rail-log` | quick-log (give Atlas a real signal) |
| nav | `.rail-nav` | Journal / Modules / Audit / Comms |
| finish | (none, centered) | done + how to re-run |

Targets are resolved with `document.querySelector(selector)`; a step whose target is missing
is skipped automatically (defensive — e.g. a tile absent when the API is down).

## 4. Component design

`frontend/src/features/onboarding.tsx`:

- `OnboardingTour({ onClose })` — renders nothing but the overlay while active.
- `TOUR_STEPS: TourStep[]` where `TourStep = { selector?: string; title: string; body: string;
  placement?: "top" | "bottom" | "auto" }`.
- Internal state: `index` (current step). Derives the target rect via a `useLayoutEffect`
  that reads `getBoundingClientRect()` of `querySelector(step.selector)` on step change and on
  `resize` (listener). Centered steps (no selector) → no spotlight, tooltip centered.
- **Spotlight** = one absolutely-positioned div sized/placed at the target rect (plus a small
  pad) with `box-shadow: 0 0 0 9999px var(--tour-scrim)` to dim everything else and a rounded
  "hole". Smooth transition of top/left/width/height between steps (disabled under
  reduced-motion).
- **Tooltip** = a positioned card (title, body, `index+1 / total`, progress dots, Back/Next
  or Finish, and Skip) placed adjacent to the rect with viewport clamping; centered when no
  target. `role="dialog"`, `aria-label`, focus moved to it on step change.
- Overlay captures clicks (tour is non-interactive); Back/Next/Skip drive it. Keyboard:
  Escape → skip; ArrowRight/Enter → next (Finish on last); ArrowLeft → back.
- The overlay is fixed, full-viewport, high z-index (above modals), with its own `--tour-scrim`.

## 5. Trigger + persistence (App.tsx)

- `const [tourOpen, setTourOpen] = useState(false)` and a constant `ONBOARDING_KEY =
  "atlas_onboarding_v1"`.
- On first successful dashboard load, if `localStorage.getItem(ONBOARDING_KEY)` is null →
  `setTourOpen(true)`.
- On finish or skip → `localStorage.setItem(ONBOARDING_KEY, "done")` and `setTourOpen(false)`.
- A **help button** in the rail (a `?` icon, labeled "סיור") → `setTourOpen(true)` to re-run
  any time (does not clear the flag; just opens).
- Render `{tourOpen ? <OnboardingTour onClose={dismissTour} /> : null}` at the app root.

## 6. Accessibility & honest-core

- Tooltip is a labelled dialog; focus moves to it each step; Esc always exits.
- Full keyboard operation; `prefers-reduced-motion` disables the spotlight/tooltip transitions.
- Copy is generic feature explanation — it makes **no claims about the user's data** (honest
  core: the tour teaches the UI, it doesn't fabricate stats). Contrast meets AA on the scrim.

## 7. Testing

- **vitest (pure):** a small helper `nextIndex(current, total, dir)` / step-resolution logic
  and `clampTooltip(rect, viewport)` unit-tested (bounds, wrap/stop at ends).
- **Integration gate:** `npm run typecheck`, `npm run lint`, `npm run build` clean.
- **Manual (live):** first load auto-runs; each step spotlights the right tile with correct
  copy; Back/Next/Skip/keyboard work; finishing sets the flag (no auto-run on reload); the
  help button re-runs; reduced-motion removes animation.

## 8. Success criteria

- A new user sees a guided, visual tour of every feature on first load; it never reappears
  once completed/skipped; the help button re-runs it.
- Anchors to real tiles with no scrolling; no existing component behavior changes.
- vitest green; typecheck, lint, build clean.
