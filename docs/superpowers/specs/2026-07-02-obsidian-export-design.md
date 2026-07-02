# Obsidian Export — Design Spec

- **Date:** 2026-07-02
- **Status:** Approved (design); ready for build
- **Decisions (user):** direction = **Atlas → Obsidian projection** (capture is a possible later phase); transport = **plain files in a synced vault folder** (Syncthing to the Pi; a local path works identically on the Mac today).

## 1. Summary

Atlas renders its real data as markdown notes inside a dedicated **`Atlas/` folder in the
Obsidian vault**: a daily note per day (activities, stats, brief, next step) and one note
per active goal (plan checkboxes with real progress + drift). Files are **full rewrites,
idempotent, derived-only** — a projection of the ledger exactly like the dashboard, just
in markdown with wikilinks. Atlas owns only its subfolder and never touches other notes.

## 2. Goals / Non-goals

**Goals**
- `ATLAS_OBSIDIAN_VAULT` setting (path; empty = feature off).
- Renderers (pure): `render_daily_note(...)`, `render_goal_note(...)`.
- `export_to_vault()` — writes `Atlas/Daily/YYYY-MM-DD.md` (today, local tz) and
  `Atlas/Goals/<safe-title>.md` per non-abandoned goal; prunes goal notes for goals that
  no longer exist/are abandoned (inside `Atlas/Goals/` only).
- Triggers: `POST /obsidian/export` (manual) + an in-app periodic task (every 15 min,
  mirroring the daily-brief scheduler pattern) — only when a vault is configured.
- Docker: `docker-compose.obsidian.yml` overlay mounting the synced vault dir at `/vault`
  and setting the env. Deploy guide section incl. Syncthing sketch.
- Tests: renderers (pure), export to a temp vault dir, disabled-when-unset, idempotent
  rewrite, prune stays inside `Atlas/Goals/`.

**Non-goals (later)**
- No Obsidian → Atlas capture (explicit `#atlas` log-syntax parsing) — phase 2 if wanted.
- No backfill of historical daily notes (only "today" forward; a backfill command can come
  later). No Obsidian plugin; no REST-plugin transport.

## 3. Note formats

`Atlas/Daily/2026-07-02.md` (frontmatter marks provenance; full rewrite each export):

```markdown
---
generated_by: atlas
type: atlas-daily
date: 2026-07-02
---
# Atlas · יום חמישי 2.7.2026

## פעולות
- **20:00** פיזיותרפיה · Recovery · 30ד׳
- **18:00** אימון כוח · Gym · 50ד׳

## סיכום
- היום: 2 פעולות · 80ד׳ | השבוע: 10 פעולות · 600ד׳
- ⭐ Complete Gym once today — Gym is at 2/3 this week…
- 🎯 [[Atlas/Goals/Pass OSCP|Pass OSCP]] — הצעד הבא: AD attacks
```

`Atlas/Goals/Pass OSCP.md`:

```markdown
---
generated_by: atlas
type: atlas-goal
status: active
target_date: 2026-09-30
progress: 40
---
# 🎯 Pass OSCP

**סטטוס:** active · **התקדמות:** 40% · **סטייה:** מאחור (צפוי 60% · בפועל 40%)

## תוכנית (v2)
- [x] Enumeration — 120/120ד׳
- [ ] AD attacks — 30/60ד׳
- [ ] Buffer overflow — 0/90ד׳
```

Rules: checkbox `[x]` iff step status is `done`; progress numbers come from
`evaluate_step` (real, derived); drift line only when drift exists (no guessed on-track);
filenames sanitized (`/\:*?"<>|` and leading dots stripped; Hebrew kept — Obsidian is
unicode-safe).

## 4. Backend design

`app/modules/obsidian/service.py`:
- `vault_ready() -> Path | None` — resolved `Atlas/` root under the configured vault, or
  None when unset (feature off). Creates `Atlas/Daily` + `Atlas/Goals` on demand.
- Renderers are pure functions over dicts (dashboard payload, goal-plan payload) — unit
  testable without a vault.
- `export_to_vault() -> dict` — gathers `get_today_dashboard()` + today's activities +
  each non-abandoned goal's `get_goal_plan`, writes the files (UTF-8, full rewrite),
  prunes orphaned goal notes **only** inside `Atlas/Goals/`, returns
  `{written: [...], pruned: [...]}`. Audited (`entity_type="obsidian_export"`).
- `scheduler.py` (module-local): asyncio loop started from `main.py` lifespan when the
  vault is configured; runs `export_to_vault()` every 15 minutes; failures logged, never
  crash the app.

`app/modules/obsidian/router.py`: `POST /obsidian/export` → runs export → the result dict;
`GET /obsidian/status` → `{configured, vault, last_export_at}` (for a future UI card).
Registered in `main.py` under `/api/v1`.

`config.py`: `obsidian_vault: str = ""` (→ `ATLAS_OBSIDIAN_VAULT`).

## 5. Deployment

- Mac/dev: set `ATLAS_OBSIDIAN_VAULT=/Users/.../MyVault` in `backend/.env`.
- Pi: `docker-compose.obsidian.yml` overlay adds
  `volumes: ["${ATLAS_OBSIDIAN_VAULT_DIR}:/vault"]` + `ATLAS_OBSIDIAN_VAULT=/vault` to the
  backend; the vault dir on the Pi is a Syncthing-synced copy of the Mac/phone vault.
  Deploy-guide section documents the Syncthing pairing at a sketch level (user ops).

## 6. Honest-core & safety

- Export is a **derived projection** — no stored progress, nothing invented; the note is
  regenerated from the ledger every time (single source of truth stays the DB).
- Atlas writes **only inside `Atlas/`** in the vault; prune is constrained to
  `Atlas/Goals/*.md` with `generated_by: atlas` frontmatter (never deletes a user file).
- Frontmatter marks every generated file so the user knows edits will be overwritten.

## 7. Testing

- Renderers: daily note contains activities/stats/goal line; goal note checkboxes match
  step statuses; drift line omitted when drift is None; filename sanitization.
- Export: writes both files into a temp vault; unset vault → no-op `{configured: False}`;
  second run overwrites (no duplicates); a stale generated goal note gets pruned, a
  user-authored file in `Atlas/Goals/` (no frontmatter marker) survives; endpoint smoke.
- All against temp dirs/DBs — never the live vault or dev DB.

## 8. Success criteria

- With a vault configured, `POST /obsidian/export` produces the daily + goal notes and
  they render correctly in Obsidian; the periodic task keeps them fresh; ruff + pytest
  green; nothing outside `Atlas/` is ever written or deleted.
