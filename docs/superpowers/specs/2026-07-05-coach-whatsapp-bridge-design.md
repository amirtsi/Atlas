# Coach Communication over the WhatsApp Bridge — Design

**Date:** 2026-07-05
**Status:** Approved (design review with owner)
**Depends on:** P4a Atlas MCP server (`app/mcp_server.py`), proposals module, communication module (Evolution bridge), daily-brief scheduler.

## Goal

Make Atlas smart and *active*: the coach plane (Hermes via MCP, and Atlas's own
engine) reaches the owner over the existing WhatsApp/Evolution bridge instead of
waiting passively in the dashboard. Three channels, one policy:

1. **Proposal pings + reply-to-approve** — every new proposal is pushed to the
   owner's WhatsApp; the owner can accept/dismiss by replying.
2. **Free-form coach messages** — a new `message_owner` MCP tool lets Hermes send
   rate-limited text observations/questions through the bridge.
3. **Proactive insight nudges** — Atlas itself (no Hermes required) pushes drift
   and inactivity warnings.

Volume policy chosen by owner: **real-time + daily caps + quiet hours**.

## Architecture

A new **`outbox`** table is the single funnel for all outbound coach
communication. Producers only enqueue rows; one dispatcher sends.

```
create_proposal hook ──┐
message_owner MCP tool ─┼──► outbox (queued) ──► dispatcher (asyncio task in
scheduler nudge pass ──┘                          app lifespan) ──► _send_and_store_reply
                                                                    └► communication_messages
owner reply "accept 12" ──► webhook ──► command parser ──► accept_proposal /
                                                           dismiss_proposal ──► ✅ reply
```

Why an outbox (vs. direct sends):

- Quiet hours require messages to *wait* somewhere that survives restarts (Pi).
- Caps/quiet-hours/retry are enforced in exactly one place (the dispatcher).
- The MCP server is a **separate short-lived process** (spawned over
  ssh + docker exec). It cannot call the app's send machinery, but it shares the
  SQLite database (WAL), so enqueue-row → dispatcher-picks-up is the natural
  cross-process bridge.
- Full audit trail of everything the coach plane ever sent.

## Data model

New table in `app/core/database.py`:

```sql
CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('proposal', 'coach_message', 'nudge')),
    body TEXT NOT NULL,
    ref_type TEXT,              -- e.g. 'proposal', 'goal', 'module'
    ref_id INTEGER,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sent', 'failed')),
    created_by TEXT NOT NULL DEFAULT 'atlas',   -- 'atlas' | 'hermes' | 'system'
    created_at TEXT NOT NULL,
    sent_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TEXT        -- retry backoff gate; NULL = eligible now
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
```

Sends also land in `communication_messages` via the existing
`_send_and_store_reply`, so the WhatsApp hub UI shows them unchanged.

## Module layout

- `app/modules/communication/outbox.py` — **new, dependency-light** (sqlite +
  config only; no FastAPI imports):
  - `enqueue(conn, *, kind, body, ref_type=None, ref_id=None, created_by='atlas') -> dict`
  - `coach_quota_remaining(conn, kind) -> int` (counts today's queued+sent rows)
  - `dispatch_pending(conn) -> int` (policy + send; returns number sent)
- Dispatcher loop: `run_outbox_dispatcher()` in
  `app/modules/communication/scheduler.py`, started as a second
  `asyncio.create_task` in `app/main.py` lifespan (mirrors the daily-brief task).
  Tick: every 60 s.
- Producers:
  - `proposals/service.py::create_proposal` — after insert, **lazy-import**
    `communication.outbox.enqueue` (matches the existing lazy-import pattern in
    `planning/service.py` and `scheduler.py`; proposals must not import
    communication at module level).
  - `app/mcp_server.py::message_owner` — imports `communication.outbox` directly
    (allowed; the forbidden direction is only `app.main` → `mcp_server`).
  - Nudge pass in `scheduler.py` (see Nudges below).

## Policy (dispatcher-enforced only)

Producers never send; every rule lives in `dispatch_pending`:

- **Quiet hours:** no sends between `quiet_start` and `quiet_end` local time
  (settings `ATLAS_QUIET_HOURS_START=22`, `ATLAS_QUIET_HOURS_END=8`, timezone
  from existing `ATLAS_TIMEZONE`). Rows created overnight stay `queued` and are
  released after quiet hours end. They are **not** merged into the daily-brief
  text — the brief stays as-is; held rows simply send after 08:00.
- **Daily caps** (counted per local calendar day over queued+sent rows):
  - `coach_message`: `ATLAS_COACH_MESSAGE_DAILY_CAP` (default 5)
  - `nudge`: `ATLAS_NUDGE_DAILY_CAP` (default 3)
  - `proposal`: uncapped, but **exactly one ping per proposal** (enqueue checks
    for an existing row with `ref_type='proposal' AND ref_id=?`).
- **Retry:** on send failure, `attempts += 1`, `last_error` recorded,
  `next_attempt_at = now + 2^attempts minutes`; after 5 attempts → `failed`.
- **No active provider:** rows stay `queued`; warning logged once per tick.
- The provider's existing `dry_run` config is honored (dry-run "sends" mark rows
  `sent`, as the fake send succeeds).

## Channel 1 — proposal ping + reply-to-approve

**Outbound.** `create_proposal` (all origins: `hermes`, `system`, user-created
via REST — Atlas is active even before Hermes is installed) enqueues a row whose
`created_by` mirrors the proposal's own `created_by`:

```
🤖 הצעה #<id> — <title>
<rationale>
Reply: accept <id> / dismiss <id> (אשר <id> / דחה <id>)
```

**Inbound.** A command parser runs at the **front** of
`_handle_owner_message` (`communication/router.py`), before the coach-question
and activity-classifier branches. Grammar (anchored, whole-message match after
trim; case-insensitive; optional `#`):

- Accept: `^(accept|approve|yes|ok|אשר|קבל|כן)\s*#?(\d+)?$`
- Dismiss: `^(dismiss|reject|no|דחה|לא)\s*#?(\d+)?$`

Anchoring is deliberate: a normal log message like "accept the offer from Dana"
must NOT match and must fall through to the classifier.

Resolution:

- Id given → call `accept_proposal`/`dismiss_proposal` (same services and audit
  as the dashboard). Not-pending/not-found → honest error reply (409/404 text).
- No id + exactly one pending proposal → act on it.
- No id + multiple pending → reply listing pending proposals (id + title), act
  on nothing.
- No id + none pending → "no pending proposals" reply.

Confirmation replies start with ✅ so the existing webhook loop-guards
(`_looks_like_atlas_reply`, `_matches_recent_outbound`) skip them unchanged.

## Channel 2 — `message_owner` MCP tool (tool #11)

New tool in `app/mcp_server.py`, registered in `WRITE_TOOLS`:

```
message_owner(text: str) -> dict
```

- Enqueues `kind='coach_message'`, `created_by='hermes'`. Touches **no other
  table**. Never sends directly.
- Returns `{"status": "queued", "outbox_id": ..., "quota_remaining_today": N}`.
- Quota exhausted → does NOT enqueue; returns an honest error object
  `{"error": "quota_exhausted", "cap": 5, "resets": "<next local midnight>"}`
  (mirrors the key-gated plan tools' honest-error pattern).
- Empty/whitespace text → validation error. Max length 1000 chars.

**Seam contract change (deliberate):** the MCP surface becomes
**read + propose + notify**. Safety updates:

- `tests/test_mcp_safety.py` `ALLOWED` set → 11 tools;
  `FORBIDDEN_SUBSTRINGS` unchanged (`message_owner` contains none).
- New test: `message_owner` writes only `outbox` rows (no proposals, no
  activities, no sends), and respects the cap.
- `scripts/verify_mcp_ready.py` `EXPECTED_TOOLS` → 11 tools; add a
  `message_owner` call to the readiness drill (assert row lands `queued`,
  `created_by='hermes'`).
- `docs/hermes-setup.md` operating brief and tool list updated; Hermes's brief
  gains: "You may message the owner directly via `message_owner`, capped per
  day — prefer proposals for anything actionable."

## Channel 3 — proactive nudges (Atlas-side)

An hourly pass (an hourly gate inside the `run_outbox_dispatcher` loop in
`scheduler.py`, skipped during quiet hours) checks two honest, real-data
conditions (v1):

1. **Plan drift** — a goal's active plan is behind (reuse the existing drift
   computation in `planning/service.py`, the same one `request_replan` uses).
2. **Module inactivity** — an `active` module with no logged activity for
   `ATLAS_NUDGE_INACTIVITY_DAYS` (default 4) days.

Each nudge enqueues `kind='nudge'`, `created_by='atlas'`, with
`ref_type='goal'|'module'` + `ref_id`. **Cooldown:** no new nudge for the same
`(ref_type, ref_id)` within 48 h (constant, not a setting, v1), checked against
outbox history. Daily cap 3 applies at dispatch. Nudge text states the observed
fact plus a pointer, e.g. "📉 Goal 'X' is behind plan (step 2/6, due 3 days
ago). Reply or open Atlas to re-plan." — no invented urgency, no fabricated
numbers.

## Error handling summary

- Evolution unreachable → retry with backoff (policy above), then `failed`.
- Restart mid-queue → rows persist; dispatcher resumes on startup.
- Concurrent writers (API process + MCP process) → existing WAL/locking
  conventions (`database.py` concurrency note already lists the MCP layer).
- Import cycles → `outbox.py` stays dependency-light; proposals lazy-imports.

## Testing (temp DBs only — never the live database)

1. `create_proposal` enqueues exactly one ping per proposal, all origins.
2. Command parser: bilingual accept/dismiss, with/without id, anchoring (log
   messages don't match), multi-pending listing, not-found/not-pending errors.
3. Dispatcher: quiet hours (frozen time), daily caps per kind, retry/backoff,
   `failed` after 5 attempts, dry-run provider marks `sent`, no-provider leaves
   `queued`.
4. `message_owner`: queues with quota; honest error at cap; writes only outbox.
5. Safety pins: 11 tools in `test_mcp_safety.py` + `verify_mcp_ready.py`.
6. Nudges: drift and inactivity trigger; 48 h cooldown; quiet-hours skip.

## Out of scope (v1)

- Installing/running Hermes itself (separate operational step, `hermes-setup.md`).
- Merging held overnight messages into the daily-brief text.
- Frontend changes (WhatsApp hub already displays sent messages; Coach inbox
  already shows proposals).
- Telegram or any second channel.
- Digest/batching modes; nudge cooldown/threshold tuning UI.
