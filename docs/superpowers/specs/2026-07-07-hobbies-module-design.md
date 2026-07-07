# Hobbies Module — Design

**Date:** 2026-07-07
**Status:** Approved by owner (mockup reviewed: https://claude.ai/code/artifact/84ec50a5-b263-498e-bf8c-3351a37fc112)

## Purpose

Atlas should track hobbies and actively help the owner act on them. Two sides:

1. **Track** — hobby sessions logged honestly through the existing activity ledger.
2. **Act** — each hobby carries an *idea backlog* ("things I want to do"); Atlas surfaces one
   concrete "do this next" suggestion per hobby on the dashboard.

Owner's hobbies span four categories: creative, physical/outdoor, maker/craft, games/collections.
The model must serve all four, so the universal primitive is the *session*, with the idea backlog
as the act-on-it layer. No nudges, no scheduling, no rotation logic in v1 — suggestions only.

## Approach (chosen: A)

Extend the existing life-module system rather than building a standalone subsystem.
A hobby is a `life_modules` row with `type = 'hobby'`. This reuses:

- **Activity ledger** — sessions are ordinary `activities` rows (`activity_type: "hobby"`),
  so WhatsApp quick-log and the coach MCP tools (`recent_activities`, `atlas_snapshot`,
  proposals) see hobbies with no extra wiring.
- **Module CRUD** — create/edit/pause/archive flows, priority, discipline linkage all work as-is.
- **Honest-core rule** — every displayed number derives from real logged rows.

Rejected alternatives: (B) standalone hobbies subsystem — duplicates the module/ledger spine and
is invisible to coach/quick-log without extra wiring; (C) convention on existing types — delivers
no idea backlog, so it fails the "help me act" requirement.

## Data model

### `life_modules` (no schema change)

- `type = 'hobby'` added to `VALID_MODULE_TYPES` (backend/app/modules/life_modules/router.py)
  and to the frontend `moduleTypes` list (frontend/src/features/modules.tsx).
- Category stored in existing `config` JSON: `config.category` ∈
  `creative | physical | maker | games`. Optional; default `creative` in the UI picker.

### `hobby_ideas` (new table, added to SCHEMA_SQL baseline)

```sql
CREATE TABLE IF NOT EXISTS hobby_ideas (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open',   -- open | done | dropped
  pinned INTEGER NOT NULL DEFAULT 0,     -- pinned idea = explicit "next"
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

At most one idea per module is pinned; pinning an idea unpins any other idea of that module
(enforced in the endpoint, single transaction).

## Behavior (backend/app/modules/life_modules/behavior.py)

New `hobby` branch in `build_behavior`, summary fields all derived from real rows:

- `days_since_last` — days since the most recent activity for the module (`null` if none).
- `weekly_activity_count`, `weekly_minutes` — from existing `module_activity_summary`.
- `ideas_open` — count of `hobby_ideas` with `status = 'open'`.
- `next_idea` — `{id, title}` of the suggestion, or `null`:
  the **pinned** open idea if one exists, else the **oldest** open idea (by `created_at`).
- `category` — echoed from `config.category` for the UI.

No `progress_percent` for hobbies — hobbies don't "complete"; the tile shows gap + suggestion.

## API (life_modules router)

- `GET  /api/modules/{module_id}/ideas` — list ideas (filter `?status=open` supported).
- `POST /api/modules/{module_id}/ideas` — create `{title, notes?}`.
- `PATCH /api/ideas/{idea_id}` — update `{title?, notes?, pinned?, status?}`.
  - `status: "done"` accepts optional `log_session: {duration_minutes?, notes?}`;
    when present, marks the idea done **and** inserts the activity in one transaction
    ("Did it" = one tap). Activity title = idea title, `activity_type = "hobby"`,
    `source = "hobby_idea"`, `occurred_at` = now (UTC).
  - `status: "dropped"` archives without logging anything.
- `DELETE /api/ideas/{idea_id}` — hard delete (for typos; normal flow is drop).

Validation: idea endpoints 404 on unknown module/idea and 422 when the target module is not
`type = 'hobby'` or is archived. Audit events recorded like other entity writes.

## Frontend

### Modules page (frontend/src/features/modules.tsx)

- `"hobby"` added to `moduleTypes`; create/edit form shows a category picker
  (creative / physical / maker / games) when type is hobby, stored in `config.category`.
- Hobby detail view: stat row (days since · sessions/wk · minutes/wk · open ideas),
  idea backlog editor (add / edit / pin / drop / mark done), and actions
  **Did it** (mark next idea done + log session), **Log session** (activity only).

### Dashboard (frontend/src/features/dashboard.tsx + styles.css)

- **Grid change (the only layout change):** the bento middle row goes from three tiles to
  four — Mission Center · Life Timeline · Calendar · **Hobbies** — by moving `.bento` to a
  12-column grid with the existing named areas preserved. Row heights unchanged; still one
  kiosk screen, no scrolling.
- **Hobbies tile:** capped preview of up to 3 hobbies, each row: name + category chip,
  days-since gap (amber past 7 days — quiet signal, no red), and the `next_idea` suggestion
  line. Footer: sessions this week + "+N more · expand".
- **Expand modal:** all hobbies; per hobby: stats line, Did it / Log session buttons, and a
  collapsible idea backlog with full CRUD (add, edit, pin, drop) — consistent with the
  CRUD-in-expand-modal pattern used elsewhere.

Hobby ordering in tile and modal: longest gap first (most starving on top), `null` gap
(never logged) counts as the longest.

## Error handling

- "Did it" (done + log) is a single SQLite transaction — no orphaned idea/activity states.
- Pinning is transactional (unpin others, pin target).
- Idea writes against non-hobby or archived modules → 422; unknown ids → 404.
- Tile renders honestly when empty: when no active hobby modules exist, the tile is not
  rendered and the middle row keeps today's three-tile layout (the four-tile grid applies
  only when the tile is present); a hobby with no open ideas shows its gap stats and the
  suggestion line reads "אין רעיון פתוח — הוסף אחד", opening the modal.

## Testing

- **Backend (pytest, temp DB per the no-test-data-in-dev-DB rule):**
  ideas CRUD (create/list/patch/delete, 404/422 paths), pin exclusivity,
  done+log transaction (activity row created with right module/type/source; rollback on
  failure), behavior summary branch (suggestion picking: pinned beats oldest; empty backlog
  → `next_idea: null`; `days_since_last` correctness including never-logged).
- **Frontend:** `hobby-logic.test.ts` mirroring existing `*-logic.test.ts` files —
  suggestion/gap formatting, hobby ordering (longest gap first, never-logged first),
  tile cap at 3 with "+N more".

## Out of scope (v1)

- Photos/artifacts per idea, galleries.
- Hobby suggestions in the WhatsApp daily brief or nudges (the coach can already *see*
  hobby data via MCP; proactive messaging is a later decision).
- Per-category analytics.

All three slot in later without further schema changes.
