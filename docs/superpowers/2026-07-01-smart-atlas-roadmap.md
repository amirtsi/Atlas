# Roadmap — Finishing "Make Atlas Smart" (Thrust A)

- **Date:** 2026-07-01
- **Status:** proposed sequence, for approval
- **Where we are:** the first increment shipped — the WhatsApp Q&A coach (conversational Q&A over real data). This roadmap sequences the rest.

Each phase is its own **spec → plan → subagent-driven build** cycle (the loop that just shipped the coach). Order is by dependency and value. Nothing here is built yet.

---

## P0 — Loose ends & go-live (small, do first)
Clear the deck before new subsystems.
- **Loop-guard harden** — the backup loop guard only matches `✅`/`☀️` prefixes; make it also skip messages whose stored metadata marks them `auto_reply`/`ai_generated`, so a bounced coach reply can't be re-processed (Note-to-Self edge). *(Cheap, isolated.)*
- **Coach go-live** — set `ATLAS_ANTHROPIC_API_KEY`, verify a real WhatsApp question round-trips end-to-end.
- **Minor test tweaks** (optional) — the two Minor findings logged during the coach build.
- **Deliverable:** coach is live and robust.
- **Size:** S · **Depends on:** nothing · **Own spec?** No — direct small build.

## P1 — Proposal Inbox (the advisory spine)
The mechanism that makes every future coaching/planning action *advisory* (propose → you approve).
- New `proposals` domain: table (type, payload, rationale, status, audit), accept/dismiss endpoints, audit trail.
- A Coach inbox surface in the dashboard (respect no-scroll + CRUD-in-modals).
- **Deliverable:** anything (a recommendation, later a plan) can be proposed and approved.
- **Size:** M · **Depends on:** service layer + typed responses (done) · **Own spec?** Yes.

## P2 — Goals & Plans engine (the forward-planning core)
The headline capability. From `docs/planning-engine.md`.
- Tables: `goals`, `plans` (versioned), `plan_steps`, `plan_step_links`.
- `evaluate_step` — ledger-derived progress; planned-vs-actual drift; projected completion.
- The re-plan loop — hybrid cadence (event-driven cheap recompute + daily reasoning pass).
- Plans arrive through the **P1 proposal inbox** (advisory); progress is always a `SELECT` over `activities`.
- **Deliverable:** declare a goal (e.g. OSCP) → get a proposed plan → track real progress → drift-driven re-plan proposals.
- **Size:** L (may split: **P2a** goals/plans + progress, **P2b** drift + re-plan) · **Depends on:** P1 · **Own spec(s)?** Yes.

## P3 — Coach UI (surface the plan)
Make the plan visible with weight.
- Dashboard surfaces: proposals inbox, active goals + plan progress, the **forward** daily brief.
- Priorities/recommendations become projections of the active plan.
- **Deliverable:** the cockpit shows the coach's guidance and plan state.
- **Size:** M · **Depends on:** P1, P2 · **Own spec?** Yes.

## P4 — Hermes runtime (the brain, last)
Swap the reasoning step for Hermes — deliberately last, because Hermes needs the tool surface (P1/P2) to exist first.
- Atlas exposes an **MCP server**: read tools (ledger/dashboard/plan position) + propose tools (write into the P1 inbox), reusing the service layer.
- Hermes consumes it; replaces the coach's in-Atlas LLM step, adding persistent memory + learning; drafts plans/re-plans as proposals.
- Channel decision (Telegram additive vs WhatsApp takeover) resolved here.
- **Deliverable:** the coach/planner is genuinely Hermes — memory, autonomy, cron.
- **Size:** L · **Depends on:** P1, P2 (the tools it calls) · **Own spec(s)?** Yes.

---

## Recommended order & rationale
**P0 → P1 → P2 → P3 → P4.**
- Proposal inbox (P1) is the spine everything advisory hangs on — build it before the engine.
- Atlas-first, Hermes-last (P4): the coach already proved "Atlas reasons behind the front door"; Hermes needs the MCP/proposal surface to exist before it can drive anything. Bringing it earlier means building against tools that don't exist yet.
- Each phase leaves working, shippable software.

## Key decisions to confirm before P1
1. **Atlas-first vs Hermes-earlier** — recommend Atlas-first (above). Confirm?
2. **P2 split** — build goals/plans/progress (P2a) and ship, then drift/re-plan (P2b)? Recommend yes.
3. **UI depth (P3)** — full coach surface, or minimal (inbox + goal progress) first? Recommend minimal first.
