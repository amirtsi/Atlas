# Coach Communication over the WhatsApp Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atlas's coach plane (Hermes via MCP + Atlas's own engine) reaches the owner over the existing WhatsApp/Evolution bridge: proposal pings with reply-to-approve, a rate-limited `message_owner` MCP tool, and proactive drift/inactivity nudges — all through one persistent outbox queue with quiet hours and daily caps.

**Architecture:** A new `outbox` table is the single funnel. Producers (proposal-creation hook, `message_owner` tool, nudge pass) only enqueue rows. One dispatcher (a second asyncio task next to the daily-brief scheduler) drains the queue through the existing `_send_and_store_reply` path, enforcing all policy. Inbound, an anchored command parser at the front of `_handle_owner_message` turns owner replies ("accept a1b2c3" / "אשר a1b2c3") into `accept_proposal`/`dismiss_proposal` calls.

**Tech Stack:** FastAPI + sqlite3 (stdlib), FastMCP (`mcp` extra), pytest + TestClient, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-05-coach-whatsapp-bridge-design.md`

**Deviations from the spec (codebase reality — approved direction unchanged):**
1. Proposal ids are TEXT uuids (`new_id()`), not integers. The `outbox` table uses TEXT uuid ids, and `ref_id` is TEXT. Reply commands reference the **first 6 hex chars** of the proposal id ("accept a1b2c3"), resolved by prefix match — not "accept 12".
2. Daily caps and quota count per **UTC day** (`utc_now_iso()[:10]`), matching the existing daily-brief idempotency guard. `message_owner`'s `resets` field is the next UTC midnight.

## Global Constraints

- Tests NEVER touch the live dev DB — `tests/conftest.py` already gives every test a fresh temp DB; just use `with TestClient(app)` (its lifespan runs `initialize_database()`).
- Run tests from `backend/`: `.venv/bin/python -m pytest tests/<file> -v`.
- Quiet hours: `ATLAS_QUIET_HOURS_START=22`, `ATLAS_QUIET_HOURS_END=8` (local `ATLAS_TIMEZONE`, default Asia/Jerusalem). Caps: `ATLAS_COACH_MESSAGE_DAILY_CAP=5`, `ATLAS_NUDGE_DAILY_CAP=3`. Inactivity: `ATLAS_NUDGE_INACTIVITY_DAYS=4`.
- `outbox.py` stays dependency-light (sqlite + config + time only) — the MCP server process imports it. Router helpers are lazy-imported inside functions.
- `app/modules/proposals/service.py` must NOT import communication at module level (lazy import inside `create_proposal`).
- `app.main` must NEVER import `app.mcp_server` (pinned by `test_mcp_safety.py`).
- All command confirmation replies start with `✅` (existing webhook loop-guard prefix).
- New MCP tool surface is EXACTLY 11 tools; update every pin (`tests/test_mcp_safety.py`, `scripts/verify_mcp_ready.py`) in the same task that adds the tool, or the suite breaks.
- Retry: max 5 attempts, backoff `2^attempts` minutes via `next_attempt_at`.
- Timestamps: always `utc_now_iso()` / tz-aware ISO with `+00:00` (string-comparable).

---

### Task 1: Outbox table, settings, and core enqueue/quota/quiet-hours

**Files:**
- Modify: `backend/app/core/database.py` (SCHEMA_SQL — new table, no migration needed per the comment block at line ~291)
- Modify: `backend/app/core/config.py` (new settings after `daily_brief_minute`)
- Create: `backend/app/modules/communication/outbox.py`
- Test: `backend/tests/test_outbox.py`

**Interfaces:**
- Consumes: `app.core.database.new_id/rows_to_dicts/db_connection`, `app.core.time.utc_now_iso`, `app.core.config.get_settings`.
- Produces (later tasks rely on these exact names):
  - `enqueue(conn, *, kind: str, body: str, ref_type: str | None = None, ref_id: str | None = None, created_by: str = "atlas") -> dict`
  - `enqueue_proposal_ping(conn, proposal: dict) -> dict | None`
  - `coach_quota_remaining(conn, kind: str) -> int`
  - `in_quiet_hours(now_local: datetime, start_hour: int, end_hour: int) -> bool`
  - `short_ref(proposal_id: str) -> str` (first 6 chars)
  - Module constants: `KINDS`, `MAX_ATTEMPTS = 5`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_outbox.py`:

```python
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.core.database import db_connection
from app.main import app
from app.modules.communication import outbox

TZ = ZoneInfo("Asia/Jerusalem")


class OutboxCoreTest(unittest.TestCase):
    def test_enqueue_creates_queued_row(self) -> None:
        with TestClient(app):
            with db_connection() as conn:
                row = outbox.enqueue(conn, kind="coach_message", body="hello", created_by="hermes")
            self.assertEqual(row["status"], "queued")
            self.assertEqual(row["kind"], "coach_message")
            self.assertEqual(row["created_by"], "hermes")
            self.assertEqual(row["attempts"], 0)
            self.assertIsNone(row["sent_at"])

    def test_enqueue_rejects_unknown_kind(self) -> None:
        with TestClient(app):
            with db_connection() as conn:
                with self.assertRaises(ValueError):
                    outbox.enqueue(conn, kind="broadcast", body="nope")

    def test_coach_quota_counts_down_per_utc_day(self) -> None:
        with TestClient(app):
            with db_connection() as conn:
                self.assertEqual(outbox.coach_quota_remaining(conn, "coach_message"), 5)
                for i in range(5):
                    outbox.enqueue(conn, kind="coach_message", body=f"m{i}", created_by="hermes")
                self.assertEqual(outbox.coach_quota_remaining(conn, "coach_message"), 0)
                # nudges have their own independent cap
                self.assertEqual(outbox.coach_quota_remaining(conn, "nudge"), 3)

    def test_proposal_ping_is_idempotent_and_mirrors_created_by(self) -> None:
        proposal = {
            "id": "a1b2c3d4-0000-0000-0000-000000000000",
            "title": "Archive Gym?",
            "rationale": "No activity in 14 days",
            "created_by": "hermes",
        }
        with TestClient(app):
            with db_connection() as conn:
                first = outbox.enqueue_proposal_ping(conn, proposal)
                again = outbox.enqueue_proposal_ping(conn, proposal)
            self.assertIsNotNone(first)
            self.assertIsNone(again)
            self.assertEqual(first["kind"], "proposal")
            self.assertEqual(first["ref_type"], "proposal")
            self.assertEqual(first["ref_id"], proposal["id"])
            self.assertEqual(first["created_by"], "hermes")
            self.assertIn("a1b2c3", first["body"])          # short ref in the text
            self.assertIn("Archive Gym?", first["body"])
            self.assertIn("accept a1b2c3", first["body"])   # reply instructions
            self.assertIn("אשר a1b2c3", first["body"])


class QuietHoursTest(unittest.TestCase):
    def test_wrapping_window_22_to_8(self) -> None:
        self.assertTrue(outbox.in_quiet_hours(datetime(2026, 7, 5, 23, 0, tzinfo=TZ), 22, 8))
        self.assertTrue(outbox.in_quiet_hours(datetime(2026, 7, 5, 22, 0, tzinfo=TZ), 22, 8))
        self.assertTrue(outbox.in_quiet_hours(datetime(2026, 7, 5, 7, 59, tzinfo=TZ), 22, 8))
        self.assertFalse(outbox.in_quiet_hours(datetime(2026, 7, 5, 8, 0, tzinfo=TZ), 22, 8))
        self.assertFalse(outbox.in_quiet_hours(datetime(2026, 7, 5, 12, 0, tzinfo=TZ), 22, 8))

    def test_non_wrapping_and_disabled_windows(self) -> None:
        self.assertTrue(outbox.in_quiet_hours(datetime(2026, 7, 5, 12, 0, tzinfo=TZ), 9, 17))
        self.assertFalse(outbox.in_quiet_hours(datetime(2026, 7, 5, 20, 0, tzinfo=TZ), 9, 17))
        self.assertFalse(outbox.in_quiet_hours(datetime(2026, 7, 5, 12, 0, tzinfo=TZ), 8, 8))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_outbox.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.modules.communication.outbox'` (collection error).

- [ ] **Step 3: Implement**

3a. In `backend/app/core/database.py`, inside `SCHEMA_SQL`, after the `idx_proposals_status` index (line ~176), add:

```sql
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('proposal', 'coach_message', 'nudge')),
  body TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  created_by TEXT NOT NULL DEFAULT 'atlas',
  created_at TEXT NOT NULL,
  sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
```

3b. In `backend/app/core/config.py`, after `daily_brief_minute: int = 0` (line 40), add:

```python
    # Coach communication over the WhatsApp bridge (the outbox). Producers only
    # enqueue; the dispatcher enforces quiet hours (local time) and per-kind
    # daily caps (counted per UTC day, like the daily-brief idempotency guard).
    quiet_hours_start: int = 22
    quiet_hours_end: int = 8
    coach_message_daily_cap: int = 5
    nudge_daily_cap: int = 3
    nudge_inactivity_days: int = 4
```

3c. Create `backend/app/modules/communication/outbox.py`:

```python
"""Outbound coach-communication queue (the "outbox").

Producers — the proposal-creation hook, the message_owner MCP tool, and the
nudge pass — only ENQUEUE rows here; nothing sends at enqueue time. One
dispatcher (scheduler.run_outbox_dispatcher) drains the queue through the
existing bridge send path, so quiet hours, daily caps and retry backoff are
enforced in exactly one place, and messages survive restarts.

Dependency-light on purpose: sqlite + config + time only. The MCP server runs
as a separate process and imports this module; it must not drag in FastAPI.
Router helpers are lazy-imported inside dispatch to avoid an import cycle.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from sqlite3 import Connection

from app.core.config import get_settings
from app.core.database import db_connection, new_id, rows_to_dicts
from app.core.time import utc_now_iso

logger = logging.getLogger("atlas.outbox")

KINDS = ("proposal", "coach_message", "nudge")
MAX_ATTEMPTS = 5


def short_ref(proposal_id: str) -> str:
    """Human-typeable reference for a WhatsApp reply (uuid prefix)."""
    return proposal_id[:6]


def in_quiet_hours(now_local: datetime, start_hour: int, end_hour: int) -> bool:
    if start_hour == end_hour:
        return False
    if start_hour < end_hour:
        return start_hour <= now_local.hour < end_hour
    return now_local.hour >= start_hour or now_local.hour < end_hour


def enqueue(
    conn: Connection,
    *,
    kind: str,
    body: str,
    ref_type: str | None = None,
    ref_id: str | None = None,
    created_by: str = "atlas",
) -> dict:
    if kind not in KINDS:
        raise ValueError(f"unknown outbox kind: {kind}")
    row_id = new_id()
    conn.execute(
        "INSERT INTO outbox (id, kind, body, ref_type, ref_id, created_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (row_id, kind, body, ref_type, ref_id, created_by, utc_now_iso()),
    )
    row = conn.execute("SELECT * FROM outbox WHERE id = ?", (row_id,)).fetchone()
    return rows_to_dicts([row])[0]


def enqueue_proposal_ping(conn: Connection, proposal: dict) -> dict | None:
    """Queue the owner ping for a new proposal. Exactly one ping per proposal
    (idempotent); the row's created_by mirrors the proposal's origin."""
    existing = conn.execute(
        "SELECT 1 FROM outbox WHERE ref_type = 'proposal' AND ref_id = ? LIMIT 1",
        (proposal["id"],),
    ).fetchone()
    if existing:
        return None
    ref = short_ref(proposal["id"])
    lines = [f"🤖 הצעה {ref} — {proposal['title']}"]
    rationale = (proposal.get("rationale") or "").strip()
    if rationale:
        lines.append(rationale)
    lines.append(f"Reply: accept {ref} / dismiss {ref} (אשר {ref} / דחה {ref})")
    return enqueue(
        conn,
        kind="proposal",
        body="\n".join(lines),
        ref_type="proposal",
        ref_id=proposal["id"],
        created_by=proposal.get("created_by") or "system",
    )


def _count_created_today(conn: Connection, kind: str) -> int:
    today = utc_now_iso()[:10]
    row = conn.execute(
        "SELECT COUNT(*) FROM outbox WHERE kind = ? AND status != 'failed' "
        "AND substr(created_at, 1, 10) = ?",
        (kind, today),
    ).fetchone()
    return int(row[0])


def _daily_cap(kind: str) -> int | None:
    settings = get_settings()
    return {
        "coach_message": settings.coach_message_daily_cap,
        "nudge": settings.nudge_daily_cap,
    }.get(kind)


def coach_quota_remaining(conn: Connection, kind: str) -> int:
    cap = _daily_cap(kind)
    if cap is None:
        raise ValueError(f"kind has no daily cap: {kind}")
    return max(0, cap - _count_created_today(conn, kind))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_outbox.py -v`
Expected: all 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/database.py backend/app/core/config.py backend/app/modules/communication/outbox.py backend/tests/test_outbox.py
git commit -m "feat(outbox): coach-communication queue — table, settings, enqueue/quota/quiet-hours"
```

---

### Task 2: Proposal-ping hook in create_proposal

**Files:**
- Modify: `backend/app/modules/proposals/service.py` (end of `create_proposal`, line ~81)
- Test: `backend/tests/test_outbox.py` (append a class)

**Interfaces:**
- Consumes: `outbox.enqueue_proposal_ping` (Task 1).
- Produces: every `create_proposal` call (REST, system heuristics, MCP propose tools, planning propose/replan — they all funnel through this one function) leaves exactly one `outbox` row with `ref_type='proposal'`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_outbox.py`:

```python
class ProposalPingHookTest(unittest.TestCase):
    def _module_id(self, client) -> str:
        return client.get("/api/v1/modules").json()[0]["id"]

    def _pings(self, conn) -> list:
        return conn.execute(
            "SELECT * FROM outbox WHERE kind = 'proposal' ORDER BY created_at"
        ).fetchall()

    def test_create_proposal_enqueues_exactly_one_ping(self) -> None:
        from app.modules.proposals.service import create_proposal

        with TestClient(app) as client:
            module_id = self._module_id(client)
            with db_connection() as conn:
                proposal = create_proposal(
                    conn, "set_module_status", "Archive?", "stale",
                    {"module_id": module_id, "status": "archived"},
                )
                pings = self._pings(conn)
            self.assertEqual(len(pings), 1)
            self.assertEqual(pings[0]["ref_id"], proposal["id"])
            self.assertEqual(pings[0]["created_by"], "system")

    def test_mcp_propose_ping_attributed_to_hermes(self) -> None:
        from app import mcp_server

        with TestClient(app) as client:
            module_id = self._module_id(client)
            proposal = mcp_server.propose_module_status(module_id, "paused", "coach says pause")
            self.assertEqual(proposal["status"], "pending")
            with db_connection() as conn:
                pings = self._pings(conn)
            self.assertEqual(len(pings), 1)
            self.assertEqual(pings[0]["created_by"], "hermes")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_outbox.py -k ProposalPingHook -v`
Expected: FAIL — `len(pings)` is 0 (no hook yet).

- [ ] **Step 3: Implement**

In `backend/app/modules/proposals/service.py`, in `create_proposal`, replace the final `return proposal` with:

```python
    # Active coach plane: ping the owner over the WhatsApp bridge. Only an
    # outbox row is written here — the dispatcher enforces quiet hours/caps.
    # Lazy import (like planning/service.py and communication/scheduler.py)
    # so proposals never depends on communication at module level.
    from app.modules.communication.outbox import enqueue_proposal_ping

    enqueue_proposal_ping(conn, proposal)
    return proposal
```

- [ ] **Step 4: Run the module's tests plus the proposals suite**

Run: `cd backend && .venv/bin/python -m pytest tests/test_outbox.py tests/test_proposals_service.py tests/test_proposals_api.py tests/test_mcp_proposals.py -v`
Expected: all PASS (existing proposal tests must not break).

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/proposals/service.py backend/tests/test_outbox.py
git commit -m "feat(proposals): enqueue an owner WhatsApp ping for every new proposal"
```

---

### Task 3: Dispatcher policy — dispatch_pending

**Files:**
- Modify: `backend/app/modules/communication/outbox.py`
- Test: `backend/tests/test_outbox.py` (append a class)

**Interfaces:**
- Consumes: `_send_and_store_reply(conn, provider, recipient, text)` and `_active_evolution_provider(conn)` from `communication/router.py` (lazy-imported); `send_text_message` semantics: dry-run → `status="sent"`; `dry_run=False` without base_url/instance/api_key → `status="failed"` deterministically (no network) — the tests exploit this for retry paths.
- Produces:
  - `dispatch_pending(conn, *, now_local: datetime | None = None) -> list[dict]` — result dicts: `{"outbox_id", "status": "sent"|"held_daily_cap"|"retry_scheduled"|"failed", ...}`
  - `run_dispatch_tick() -> list[dict]` (opens its own `db_connection`; what the scheduler calls)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_outbox.py` (`_make_provider` mirrors `tests/test_whatsapp.py`):

```python
def _make_provider(client, config: dict) -> dict:
    response = client.post(
        "/api/v1/communication/providers",
        json={"name": "Evolution Test", "type": "evolution", "channel": "whatsapp", "config": config},
    )
    assert response.status_code == 201, response.text
    return response.json()


NOON = datetime(2026, 7, 5, 12, 0, tzinfo=TZ)
NIGHT = datetime(2026, 7, 5, 23, 0, tzinfo=TZ)


class DispatchPendingTest(unittest.TestCase):
    def test_sends_queued_rows_and_stores_messages(self) -> None:
        with TestClient(app) as client:
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})
            with db_connection() as conn:
                row = outbox.enqueue(conn, kind="coach_message", body="שלום מהמאמן", created_by="hermes")
                results = outbox.dispatch_pending(conn, now_local=NOON)
                sent = conn.execute("SELECT * FROM outbox WHERE id = ?", (row["id"],)).fetchone()
            self.assertEqual(results, [{"outbox_id": row["id"], "status": "sent", "message_id": results[0]["message_id"]}])
            self.assertEqual(sent["status"], "sent")
            self.assertIsNotNone(sent["sent_at"])
            messages = client.get(f"/api/v1/communication/messages?provider_id={provider['id']}").json()
            self.assertTrue(any(m["content_text"] == "שלום מהמאמן" and m["direction"] == "outbound" for m in messages))

    def test_quiet_hours_hold_everything(self) -> None:
        with TestClient(app) as client:
            _make_provider(client, {"dry_run": True, "instance": "atlas"})
            with db_connection() as conn:
                outbox.enqueue(conn, kind="coach_message", body="late night", created_by="hermes")
                self.assertEqual(outbox.dispatch_pending(conn, now_local=NIGHT), [])
                held = conn.execute("SELECT status FROM outbox").fetchone()
            self.assertEqual(held["status"], "queued")

    def test_daily_cap_holds_excess_nudges_but_not_proposals(self) -> None:
        with TestClient(app) as client:
            _make_provider(client, {"dry_run": True, "instance": "atlas"})
            with db_connection() as conn:
                for i in range(4):  # nudge cap is 3
                    outbox.enqueue(conn, kind="nudge", body=f"nudge {i}")
                for i in range(4):  # proposals are uncapped
                    outbox.enqueue_proposal_ping(conn, {"id": f"{i}{i}{i}{i}{i}{i}-fake", "title": f"p{i}", "rationale": "", "created_by": "system"})
                results = outbox.dispatch_pending(conn, now_local=NOON)
            statuses = [r["status"] for r in results]
            self.assertEqual(statuses.count("held_daily_cap"), 1)
            self.assertEqual(statuses.count("sent"), 7)  # 3 nudges + 4 proposal pings

    def test_failed_send_schedules_retry_then_fails_after_max_attempts(self) -> None:
        with TestClient(app) as client:
            # dry_run=False with no base_url/instance/api_key -> deterministic failure, no network
            _make_provider(client, {"dry_run": False})
            with db_connection() as conn:
                row = outbox.enqueue(conn, kind="coach_message", body="will fail", created_by="hermes")
                first = outbox.dispatch_pending(conn, now_local=NOON)
                after_first = dict(conn.execute("SELECT * FROM outbox WHERE id = ?", (row["id"],)).fetchone())
                # not eligible again until next_attempt_at
                second = outbox.dispatch_pending(conn, now_local=NOON)
                # force eligibility at max attempts
                conn.execute(
                    "UPDATE outbox SET attempts = 4, next_attempt_at = '2020-01-01T00:00:00+00:00' WHERE id = ?",
                    (row["id"],),
                )
                third = outbox.dispatch_pending(conn, now_local=NOON)
                final = dict(conn.execute("SELECT * FROM outbox WHERE id = ?", (row["id"],)).fetchone())
            self.assertEqual(first[0]["status"], "retry_scheduled")
            self.assertEqual(after_first["status"], "queued")
            self.assertEqual(after_first["attempts"], 1)
            self.assertIsNotNone(after_first["next_attempt_at"])
            self.assertIsNotNone(after_first["last_error"])
            self.assertEqual(second, [])
            self.assertEqual(third[0]["status"], "failed")
            self.assertEqual(final["status"], "failed")
            self.assertEqual(final["attempts"], 5)

    def test_no_active_provider_leaves_rows_queued(self) -> None:
        with TestClient(app):
            with db_connection() as conn:
                conn.execute("UPDATE communication_providers SET is_active = 0")
                outbox.enqueue(conn, kind="coach_message", body="orphan", created_by="hermes")
                self.assertEqual(outbox.dispatch_pending(conn, now_local=NOON), [])
                row = conn.execute("SELECT status FROM outbox").fetchone()
            self.assertEqual(row["status"], "queued")
```

Note: `initialize_database()` seeds a default active Evolution provider (`ensure_default_communication_provider`), so the no-provider test deactivates ALL providers first. In the other tests the extra seeded provider is harmless — `_active_evolution_provider` picks the most recently created one (the test's).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_outbox.py -k DispatchPending -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'dispatch_pending'`.

- [ ] **Step 3: Implement**

Append to `backend/app/modules/communication/outbox.py`:

```python
def _sent_today(conn: Connection, kind: str) -> int:
    today = utc_now_iso()[:10]
    row = conn.execute(
        "SELECT COUNT(*) FROM outbox WHERE kind = ? AND status = 'sent' "
        "AND substr(sent_at, 1, 10) = ?",
        (kind, today),
    ).fetchone()
    return int(row[0])


def dispatch_pending(conn: Connection, *, now_local: datetime | None = None) -> list[dict]:
    """Send eligible queued rows through the existing bridge send path.

    ALL policy lives here: quiet hours, per-kind daily caps, retry backoff.
    Returns one result dict per row acted on (for logging/tests)."""
    from zoneinfo import ZoneInfo

    from app.modules.communication.evolution import normalize_whatsapp_number
    from app.modules.communication.router import _active_evolution_provider, _send_and_store_reply

    settings = get_settings()
    now_local = now_local or datetime.now(ZoneInfo(settings.timezone))
    if in_quiet_hours(now_local, settings.quiet_hours_start, settings.quiet_hours_end):
        return []

    provider = _active_evolution_provider(conn)
    if provider is None:
        logger.warning("Outbox: no active WhatsApp provider; queued rows are held.")
        return []
    recipient = normalize_whatsapp_number(
        str((provider.get("config") or {}).get("default_recipient") or "")
    )
    if not recipient:
        logger.warning("Outbox: active provider has no default_recipient; queued rows are held.")
        return []

    rows = rows_to_dicts(
        conn.execute(
            "SELECT * FROM outbox WHERE status = 'queued' "
            "AND (next_attempt_at IS NULL OR next_attempt_at <= ?) "
            "ORDER BY created_at",
            (utc_now_iso(),),
        ).fetchall()
    )
    results: list[dict] = []
    for row in rows:
        cap = _daily_cap(row["kind"])
        if cap is not None and _sent_today(conn, row["kind"]) >= cap:
            results.append({"outbox_id": row["id"], "status": "held_daily_cap"})
            continue
        message_id = _send_and_store_reply(conn, provider, recipient, row["body"])
        message = conn.execute(
            "SELECT status, error FROM communication_messages WHERE id = ?", (message_id,)
        ).fetchone()
        if message["status"] == "failed":
            attempts = row["attempts"] + 1
            if attempts >= MAX_ATTEMPTS:
                conn.execute(
                    "UPDATE outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?",
                    (attempts, message["error"], row["id"]),
                )
                results.append({"outbox_id": row["id"], "status": "failed"})
            else:
                next_attempt = (
                    (datetime.now(UTC) + timedelta(minutes=2**attempts))
                    .replace(microsecond=0)
                    .isoformat()
                )
                conn.execute(
                    "UPDATE outbox SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?",
                    (attempts, message["error"], next_attempt, row["id"]),
                )
                results.append({"outbox_id": row["id"], "status": "retry_scheduled"})
        else:
            conn.execute(
                "UPDATE outbox SET status = 'sent', sent_at = ? WHERE id = ?",
                (utc_now_iso(), row["id"]),
            )
            results.append({"outbox_id": row["id"], "status": "sent", "message_id": message_id})
    return results


def run_dispatch_tick() -> list[dict]:
    """One dispatcher heartbeat (opens its own connection; scheduler calls this)."""
    with db_connection() as conn:
        return dispatch_pending(conn)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_outbox.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/communication/outbox.py backend/tests/test_outbox.py
git commit -m "feat(outbox): dispatcher policy — quiet hours, daily caps, retry backoff"
```

---

### Task 4: Dispatcher loop wired into app startup

**Files:**
- Modify: `backend/app/modules/communication/scheduler.py`
- Modify: `backend/app/main.py` (lifespan, lines 29–44)
- Test: `backend/tests/test_outbox.py` (append a class)

**Interfaces:**
- Consumes: `outbox.run_dispatch_tick` (Task 3).
- Produces: `run_outbox_dispatcher() -> None` (async, cancellable); `app.state.outbox_task`. Task 7 later inserts the hourly nudge gate into this loop.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_outbox.py`:

```python
class DispatcherWiringTest(unittest.TestCase):
    def test_app_lifespan_starts_outbox_dispatcher(self) -> None:
        with TestClient(app):
            self.assertTrue(hasattr(app.state, "outbox_task"))
            self.assertFalse(app.state.outbox_task.done())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_outbox.py -k DispatcherWiring -v`
Expected: FAIL — `app.state` has no attribute `outbox_task`.

- [ ] **Step 3: Implement**

3a. Append to `backend/app/modules/communication/scheduler.py` (note: the loop sleeps FIRST so tests using TestClient never race a live tick):

```python
async def run_outbox_dispatcher() -> None:
    """Long-lived heartbeat for the coach outbox: drain the queue every 60s.

    All policy (quiet hours, caps, retry) lives in outbox.dispatch_pending —
    this loop only provides the tick. Sleeps before the first tick so app
    startup (and tests) never race an immediate dispatch."""
    from app.modules.communication.outbox import run_dispatch_tick

    logger.info("Outbox dispatcher active — 60s tick.")
    while True:
        try:
            await asyncio.sleep(60)
            results = await asyncio.to_thread(run_dispatch_tick)
            if results:
                logger.info("Outbox dispatch: %s", results)
        except asyncio.CancelledError:
            logger.info("Outbox dispatcher stopped.")
            break
        except Exception:  # never let a transient error kill the loop
            logger.exception("Outbox dispatch tick failed; retrying next tick.")
```

3b. In `backend/app/main.py`:
- Line 13: change the scheduler import to
  `from app.modules.communication.scheduler import run_daily_brief_scheduler, run_outbox_dispatcher`
- In `lifespan`, after `obsidian_task = asyncio.create_task(...)` add:

```python
    outbox_task = asyncio.create_task(run_outbox_dispatcher())
    app.state.outbox_task = outbox_task
```

- In the `finally` block, after `obsidian_task.cancel()` add:

```python
        outbox_task.cancel()
```

- [ ] **Step 4: Run the full suite (startup touches everything)**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/communication/scheduler.py backend/app/main.py backend/tests/test_outbox.py
git commit -m "feat(scheduler): outbox dispatcher loop wired into app lifespan"
```

---

### Task 5: Reply command parser + executor

**Files:**
- Create: `backend/app/modules/communication/commands.py`
- Test: `backend/tests/test_whatsapp_commands.py`

**Interfaces:**
- Consumes: `proposals.service.accept_proposal/dismiss_proposal` (existing, same as dashboard), `outbox.short_ref`.
- Produces (Task 6 wires these into the router):
  - `parse_proposal_command(text: str | None) -> dict | None` — `{"action": "accept"|"dismiss", "ref": str|None}` (ref lowercased) or None
  - `execute_proposal_command(conn, command: dict) -> str` (the reply text)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_whatsapp_commands.py`:

```python
import unittest

from fastapi.testclient import TestClient

from app.core.database import db_connection
from app.main import app
from app.modules.communication.commands import execute_proposal_command, parse_proposal_command


class ParseCommandTest(unittest.TestCase):
    def test_accept_and_dismiss_verbs_english_and_hebrew(self) -> None:
        for text in ("accept a1b2c3", "APPROVE a1b2c3", "yes a1b2c3", "ok #a1b2c3", "אשר a1b2c3", "קבל a1b2c3"):
            self.assertEqual(parse_proposal_command(text), {"action": "accept", "ref": "a1b2c3"}, text)
        for text in ("dismiss a1b2c3", "reject a1b2c3", "דחה a1b2c3"):
            self.assertEqual(parse_proposal_command(text), {"action": "dismiss", "ref": "a1b2c3"}, text)

    def test_bare_verbs_have_no_ref(self) -> None:
        self.assertEqual(parse_proposal_command("accept"), {"action": "accept", "ref": None})
        self.assertEqual(parse_proposal_command("כן"), {"action": "accept", "ref": None})
        self.assertEqual(parse_proposal_command("לא"), {"action": "dismiss", "ref": None})

    def test_anchoring_rejects_ordinary_messages(self) -> None:
        for text in (
            "accept the offer from Dana",       # trailing words
            "I accept a1b2c3",                  # leading words
            "עשיתי פיזיותרפיה 30 דקות",          # normal activity log
            "accept 12",                        # ref too short (uuids, not ints)
            "", None,
        ):
            self.assertIsNone(parse_proposal_command(text), repr(text))


class ExecuteCommandTest(unittest.TestCase):
    def _pending_proposal(self, client) -> dict:
        from app.modules.proposals.service import create_proposal

        module_id = client.get("/api/v1/modules").json()[0]["id"]
        with db_connection() as conn:
            return create_proposal(
                conn, "set_module_status", "Archive?", "stale",
                {"module_id": module_id, "status": "archived"},
            )

    def test_accept_by_short_ref_applies_and_confirms(self) -> None:
        with TestClient(app) as client:
            proposal = self._pending_proposal(client)
            with db_connection() as conn:
                reply = execute_proposal_command(conn, {"action": "accept", "ref": proposal["id"][:6]})
                status = conn.execute("SELECT status FROM proposals WHERE id = ?", (proposal["id"],)).fetchone()[0]
            self.assertTrue(reply.startswith("✅"))
            self.assertIn("Archive?", reply)
            self.assertEqual(status, "accepted")

    def test_dismiss_without_ref_resolves_single_pending(self) -> None:
        with TestClient(app) as client:
            proposal = self._pending_proposal(client)
            with db_connection() as conn:
                reply = execute_proposal_command(conn, {"action": "dismiss", "ref": None})
                status = conn.execute("SELECT status FROM proposals WHERE id = ?", (proposal["id"],)).fetchone()[0]
            self.assertTrue(reply.startswith("✅"))
            self.assertEqual(status, "dismissed")

    def test_no_ref_with_multiple_pending_lists_them(self) -> None:
        with TestClient(app) as client:
            first = self._pending_proposal(client)
            second = self._pending_proposal(client)
            with db_connection() as conn:
                reply = execute_proposal_command(conn, {"action": "accept", "ref": None})
                pending = conn.execute("SELECT COUNT(*) FROM proposals WHERE status = 'pending'").fetchone()[0]
            self.assertIn(first["id"][:6], reply)
            self.assertIn(second["id"][:6], reply)
            self.assertEqual(pending, 2)  # nothing was applied

    def test_unknown_ref_and_empty_inbox_replies_honestly(self) -> None:
        with TestClient(app):
            with db_connection() as conn:
                no_pending = execute_proposal_command(conn, {"action": "accept", "ref": None})
                bad_ref = execute_proposal_command(conn, {"action": "accept", "ref": "ffffff"})
            self.assertTrue(no_pending.startswith("✅"))
            self.assertTrue(bad_ref.startswith("✅"))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_whatsapp_commands.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.modules.communication.commands'`.

- [ ] **Step 3: Implement**

Create `backend/app/modules/communication/commands.py`:

```python
"""Owner reply commands for the proposal inbox ("accept a1b2c3" / "דחה a1b2c3").

Anchored whole-message matching (^...$ after trim) so ordinary logged messages
("accept the offer from Dana") never match and fall through to the classifier.
Refs are uuid prefixes (>=4 hex chars; pings use the first 6) resolved against
PENDING proposals only. Every reply starts with ✅ so the webhook loop-guard
(_looks_like_atlas_reply) skips our own bounced confirmations.
"""
from __future__ import annotations

import re
from sqlite3 import Connection

from fastapi import HTTPException

from app.core.database import rows_to_dicts
from app.modules.communication.outbox import short_ref
from app.modules.proposals.service import accept_proposal, dismiss_proposal

_ACCEPT = r"accept|approve|yes|ok|אשר|קבל|כן"
_DISMISS = r"dismiss|reject|no|דחה|לא"
_COMMAND_RE = re.compile(
    rf"^(?:(?P<accept>{_ACCEPT})|(?P<dismiss>{_DISMISS}))\s*#?(?P<ref>[0-9a-fA-F-]{{4,36}})?$",
    re.IGNORECASE,
)


def parse_proposal_command(text: str | None) -> dict | None:
    match = _COMMAND_RE.match((text or "").strip())
    if not match:
        return None
    action = "accept" if match.group("accept") else "dismiss"
    ref = match.group("ref")
    return {"action": action, "ref": ref.lower() if ref else None}


def _pending(conn: Connection) -> list[dict]:
    return rows_to_dicts(
        conn.execute("SELECT * FROM proposals WHERE status = 'pending' ORDER BY created_at DESC").fetchall()
    )


def _pending_list_reply(pending: list[dict]) -> str:
    lines = ["✅ הצעות ממתינות:"]
    lines += [f"• {short_ref(p['id'])} — {p['title']}" for p in pending]
    lines.append("Reply: accept <id> / dismiss <id> (אשר / דחה)")
    return "\n".join(lines)


def execute_proposal_command(conn: Connection, command: dict) -> str:
    pending = _pending(conn)
    ref = command["ref"]
    if ref:
        matches = [p for p in pending if p["id"].lower().startswith(ref)]
        if not matches:
            return f"✅ לא נמצאה הצעה ממתינה שמתחילה ב-{ref}. (No pending proposal matching {ref}.)"
        if len(matches) > 1:
            return _pending_list_reply(matches)
    else:
        if not pending:
            return "✅ אין הצעות ממתינות. (No pending proposals.)"
        if len(pending) > 1:
            return _pending_list_reply(pending)
        matches = pending

    proposal = matches[0]
    try:
        if command["action"] == "accept":
            updated = accept_proposal(conn, proposal["id"])
            return f"✅ אושר: {updated['title']}"
        updated = dismiss_proposal(conn, proposal["id"])
        return f"✅ נדחה: {updated['title']}"
    except HTTPException as exc:
        return f"✅ לא בוצע: {exc.detail}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_whatsapp_commands.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/communication/commands.py backend/tests/test_whatsapp_commands.py
git commit -m "feat(commands): bilingual accept/dismiss reply parser + executor for proposals"
```

---

### Task 6: Wire commands into the webhook owner-message flow

**Files:**
- Modify: `backend/app/modules/communication/router.py` (imports at top; `_handle_owner_message`, line ~283)
- Test: `backend/tests/test_whatsapp_commands.py` (append a class)

**Interfaces:**
- Consumes: `parse_proposal_command` / `execute_proposal_command` (Task 5), existing `_send_and_store_reply`.
- Produces: webhook POST with an owner command text accepts/dismisses the proposal and replies; classification result carries `method="proposal_command"`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_whatsapp_commands.py` (payload helper mirrors `tests/test_whatsapp.py`):

```python
OWNER = "972546745182"


def _webhook_payload(sender: str, text: str, *, key_id: str) -> dict:
    return {
        "event": "messages.upsert",
        "data": {
            "key": {"id": key_id, "remoteJid": f"{sender}@s.whatsapp.net", "fromMe": False},
            "message": {"conversation": text},
        },
    }


class WebhookCommandFlowTest(unittest.TestCase):
    def test_owner_accepts_proposal_via_whatsapp_reply(self) -> None:
        from app.modules.proposals.service import create_proposal

        with TestClient(app) as client:
            provider = client.post(
                "/api/v1/communication/providers",
                json={"name": "Evolution Test", "type": "evolution", "channel": "whatsapp",
                      "config": {"dry_run": True, "instance": "atlas"}},
            ).json()
            module = client.get("/api/v1/modules").json()[0]
            with db_connection() as conn:
                proposal = create_proposal(
                    conn, "set_module_status", f"Archive {module['name']}?", "stale",
                    {"module_id": module["id"], "status": "archived"},
                )
            response = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, f"accept {proposal['id'][:6]}", key_id="cmd-1"),
            )
            self.assertEqual(response.status_code, 202)
            classification = response.json()["classification"]
            self.assertEqual(classification["method"], "proposal_command")
            self.assertIsNone(classification["activity_id"])  # a command never logs an activity
            # the accept actually applied through the validated service
            self.assertEqual(client.get(f"/api/v1/modules/{module['id']}").json()["status"], "archived")
            with db_connection() as conn:
                status = conn.execute("SELECT status FROM proposals WHERE id = ?", (proposal["id"],)).fetchone()[0]
            self.assertEqual(status, "accepted")

    def test_non_command_message_still_reaches_classifier(self) -> None:
        with TestClient(app) as client:
            provider = client.post(
                "/api/v1/communication/providers",
                json={"name": "Evolution Test", "type": "evolution", "channel": "whatsapp",
                      "config": {"dry_run": True, "instance": "atlas"}},
            ).json()
            response = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות", key_id="cmd-2"),
            )
            classification = response.json()["classification"]
            self.assertNotEqual(classification["method"], "proposal_command")
            self.assertTrue(classification["matched"])  # the activity loop is untouched
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_whatsapp_commands.py -k Webhook -v`
Expected: FAIL — `classification["method"]` is a classifier method (e.g. `rules`), not `proposal_command`.

- [ ] **Step 3: Implement**

3a. In `backend/app/modules/communication/router.py`, add to the imports (after the `classifier` import, line 8):

```python
from app.modules.communication.commands import execute_proposal_command, parse_proposal_command
```

3b. In `_handle_owner_message` (line ~283), insert directly after `settings = get_settings()` and BEFORE the coach-question branch:

```python
    # Proposal reply commands ("accept a1b2c3" / "אשר a1b2c3") come first: an
    # anchored whole-message match, so ordinary logs fall through untouched.
    command = parse_proposal_command(text)
    if command:
        reply_text = execute_proposal_command(conn, command)
        reply_message_id = _send_and_store_reply(conn, provider, sender, reply_text, in_reply_to=inbound_message_id)
        if inbound_message_id:
            conn.execute(
                "UPDATE communication_messages SET metadata = ?, updated_at = ? WHERE id = ?",
                (
                    json_dump(
                        {
                            "raw_event_type": normalized["event_type"],
                            "intent": "proposal_command",
                            "command": command,
                        }
                    ),
                    now,
                    inbound_message_id,
                ),
            )
        return {
            "matched": False,
            "module_id": None,
            "module_name": None,
            "discipline_id": None,
            "activity_type": None,
            "title": None,
            "duration_minutes": None,
            "confidence": 0.0,
            "method": "proposal_command",
            "intent": "proposal_command",
            "reply_text": reply_text,
            "activity_id": None,
            "reply_message_id": reply_message_id,
        }
```

- [ ] **Step 4: Run the WhatsApp suites**

Run: `cd backend && .venv/bin/python -m pytest tests/test_whatsapp_commands.py tests/test_whatsapp.py tests/test_whatsapp_hub.py tests/test_intent.py -v`
Expected: all PASS (existing two-way flow untouched).

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/communication/router.py backend/tests/test_whatsapp_commands.py
git commit -m "feat(whatsapp): reply-to-approve — owner accepts/dismisses proposals from WhatsApp"
```

---

### Task 7: Proactive nudges + hourly gate in the dispatcher loop

**Files:**
- Create: `backend/app/modules/communication/nudges.py`
- Modify: `backend/app/modules/communication/scheduler.py` (`run_outbox_dispatcher` from Task 4)
- Test: `backend/tests/test_nudges.py`

**Interfaces:**
- Consumes: `outbox.enqueue/in_quiet_hours`, `planning.service.get_goal_plan` (returns `{"goal", "plan", "steps", "overall_percent", "drift"}`; `drift` is None or has `on_track/actual_percent/expected_percent`), settings `nudge_inactivity_days`.
- Produces: `generate_nudges(conn) -> list[dict]`, `run_nudge_pass() -> list[dict]` (quiet-hours-aware, opens own connection); constant `COOLDOWN_HOURS = 48`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_nudges.py`:

```python
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.core.time import utc_now_iso
from app.main import app
from app.modules.communication import nudges

BEHIND = {"drift": {"on_track": False, "actual_percent": 0.1, "expected_percent": 0.6,
                    "drift": -0.5, "projected_completion": None}}
ON_TRACK = {"drift": {"on_track": True, "actual_percent": 0.5, "expected_percent": 0.4,
                      "drift": 0.1, "projected_completion": None}}


def _insert_active_goal(conn, title: str) -> str:
    goal_id = new_id()
    now = utc_now_iso()
    conn.execute(
        "INSERT INTO goals (id, title, status, active_plan_id, created_by, created_at, updated_at) "
        "VALUES (?, ?, 'active', ?, 'user', ?, ?)",
        (goal_id, title, new_id(), now, now),
    )
    return goal_id


class NudgeTest(unittest.TestCase):
    def test_inactive_modules_get_nudges_with_cooldown(self) -> None:
        # Fresh DB: seeded active modules have zero activities ever -> all stale.
        with TestClient(app):
            with db_connection() as conn:
                first = nudges.generate_nudges(conn)
                second = nudges.generate_nudges(conn)  # cooldown: nothing new
            module_nudges = [n for n in first if n["ref_type"] == "module"]
            self.assertGreaterEqual(len(module_nudges), 1)
            self.assertTrue(all(n["kind"] == "nudge" and n["created_by"] == "atlas" for n in module_nudges))
            self.assertIn("no logged activity", module_nudges[0]["body"])
            self.assertEqual([n for n in second if n["ref_type"] == "module"], [])

    def test_behind_goal_gets_drift_nudge_on_track_does_not(self) -> None:
        with TestClient(app):
            with db_connection() as conn:
                behind_id = _insert_active_goal(conn, "OSCP cert")
                on_track_id = _insert_active_goal(conn, "ParkNet v2")

                def fake_plan(conn_, goal_id):
                    return BEHIND if goal_id == behind_id else ON_TRACK

                with patch.object(nudges, "get_goal_plan", side_effect=fake_plan):
                    created = nudges.generate_nudges(conn)
            goal_nudges = [n for n in created if n["ref_type"] == "goal"]
            self.assertEqual([n["ref_id"] for n in goal_nudges], [behind_id])
            self.assertIn("OSCP cert", goal_nudges[0]["body"])
            self.assertIn("behind plan", goal_nudges[0]["body"])

    def test_run_nudge_pass_skips_quiet_hours(self) -> None:
        with TestClient(app):
            with patch.object(nudges, "_now_local") as fake_now:
                from datetime import datetime
                from zoneinfo import ZoneInfo

                fake_now.return_value = datetime(2026, 7, 5, 23, 30, tzinfo=ZoneInfo("Asia/Jerusalem"))
                self.assertEqual(nudges.run_nudge_pass(), [])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_nudges.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.modules.communication.nudges'`.

- [ ] **Step 3: Implement**

3a. Create `backend/app/modules/communication/nudges.py`:

```python
"""Proactive insight nudges — honest, real-data conditions only (v1).

1) Plan drift: a goal's active plan is behind (same drift computation
   request_replan uses — nothing invented).
2) Module inactivity: an active module with no logged activity for
   ATLAS_NUDGE_INACTIVITY_DAYS days.

Each (ref_type, ref_id) gets a 48h cooldown so the owner is never nagged twice
about the same thing; the dispatcher's daily nudge cap does the rest.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from sqlite3 import Connection
from zoneinfo import ZoneInfo

from app.core.config import get_settings
from app.core.database import db_connection, rows_to_dicts
from app.modules.communication.outbox import enqueue, in_quiet_hours
from app.modules.planning.service import get_goal_plan

COOLDOWN_HOURS = 48


def _now_local() -> datetime:
    return datetime.now(ZoneInfo(get_settings().timezone))


def _recently_nudged(conn: Connection, ref_type: str, ref_id: str) -> bool:
    cutoff = (datetime.now(UTC) - timedelta(hours=COOLDOWN_HOURS)).replace(microsecond=0).isoformat()
    row = conn.execute(
        "SELECT 1 FROM outbox WHERE kind = 'nudge' AND ref_type = ? AND ref_id = ? "
        "AND created_at >= ? LIMIT 1",
        (ref_type, ref_id, cutoff),
    ).fetchone()
    return row is not None


def generate_nudges(conn: Connection) -> list[dict]:
    created: list[dict] = []

    goals = rows_to_dicts(
        conn.execute(
            "SELECT * FROM goals WHERE status = 'active' AND active_plan_id IS NOT NULL"
        ).fetchall()
    )
    for goal in goals:
        view = get_goal_plan(conn, goal["id"]) or {}
        drift = view.get("drift")
        if drift is None or drift["on_track"]:
            continue
        if _recently_nudged(conn, "goal", goal["id"]):
            continue
        body = (
            f"📉 Goal '{goal['title']}' is behind plan: "
            f"{int(drift['actual_percent'] * 100)}% done vs "
            f"{int(drift['expected_percent'] * 100)}% expected. "
            "Reply or open Atlas to re-plan."
        )
        created.append(enqueue(conn, kind="nudge", body=body, ref_type="goal", ref_id=goal["id"]))

    days = get_settings().nudge_inactivity_days
    cutoff = (datetime.now(UTC) - timedelta(days=days)).replace(microsecond=0).isoformat()
    stale = conn.execute(
        """
        SELECT lm.id, lm.name FROM life_modules lm
        WHERE lm.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM activities a WHERE a.module_id = lm.id AND a.occurred_at >= ?
          )
        ORDER BY lm.name
        """,
        (cutoff,),
    ).fetchall()
    for module in stale:
        if _recently_nudged(conn, "module", module["id"]):
            continue
        body = f"⏳ '{module['name']}' — no logged activity in {days} days."
        created.append(enqueue(conn, kind="nudge", body=body, ref_type="module", ref_id=module["id"]))

    return created


def run_nudge_pass() -> list[dict]:
    """One scheduler-driven pass (opens its own connection). Skipped in quiet
    hours per the spec — nothing should even be generated overnight."""
    settings = get_settings()
    if in_quiet_hours(_now_local(), settings.quiet_hours_start, settings.quiet_hours_end):
        return []
    with db_connection() as conn:
        return generate_nudges(conn)
```

3b. In `backend/app/modules/communication/scheduler.py`, replace the Task 4 `run_outbox_dispatcher` body with the hourly-gated version (same 60s tick; `UTC` needs importing — change line 13 to `from datetime import UTC, datetime, timedelta`):

```python
async def run_outbox_dispatcher() -> None:
    """Long-lived heartbeat for the coach outbox: drain the queue every 60s and
    run the nudge pass hourly. All send policy lives in outbox.dispatch_pending;
    quiet-hours skipping for nudges lives in nudges.run_nudge_pass. Sleeps
    before the first tick so app startup (and tests) never race a dispatch."""
    from app.modules.communication.nudges import run_nudge_pass
    from app.modules.communication.outbox import run_dispatch_tick

    logger.info("Outbox dispatcher active — 60s tick, hourly nudge pass.")
    last_nudge_pass: datetime | None = None
    while True:
        try:
            await asyncio.sleep(60)
            now = datetime.now(UTC)
            if last_nudge_pass is None or now - last_nudge_pass >= timedelta(hours=1):
                queued = await asyncio.to_thread(run_nudge_pass)
                if queued:
                    logger.info("Nudge pass queued %d nudge(s).", len(queued))
                last_nudge_pass = now
            results = await asyncio.to_thread(run_dispatch_tick)
            if results:
                logger.info("Outbox dispatch: %s", results)
        except asyncio.CancelledError:
            logger.info("Outbox dispatcher stopped.")
            break
        except Exception:  # never let a transient error kill the loop
            logger.exception("Outbox tick failed; retrying next tick.")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_nudges.py tests/test_outbox.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/modules/communication/nudges.py backend/app/modules/communication/scheduler.py backend/tests/test_nudges.py
git commit -m "feat(nudges): hourly drift + inactivity nudges with 48h cooldown"
```

---

### Task 8: message_owner MCP tool (tool #11) + safety pins

**Files:**
- Modify: `backend/app/mcp_server.py` (new tool + docstring; WRITE_TOOLS list, line ~161)
- Modify: `backend/tests/test_mcp_safety.py` (ALLOWED set, line 6)
- Modify: `backend/scripts/verify_mcp_ready.py` (EXPECTED_TOOLS line 25; drill in `_run`)
- Test: `backend/tests/test_mcp_message_owner.py`

**Interfaces:**
- Consumes: `outbox.enqueue/coach_quota_remaining` (Task 1).
- Produces: MCP tool `message_owner(text: str) -> dict` returning `{"status": "queued", "outbox_id", "quota_remaining_today"}` or honest error objects. The seam contract becomes read + propose + **notify**.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mcp_message_owner.py`:

```python
import unittest

from fastapi.testclient import TestClient

from app import mcp_server
from app.core.database import db_connection
from app.main import app


class MessageOwnerTest(unittest.TestCase):
    def test_queues_with_quota_and_touches_only_outbox(self) -> None:
        with TestClient(app):
            result = mcp_server.message_owner("You logged nothing on OSCP this week — want a re-plan?")
            self.assertEqual(result["status"], "queued")
            self.assertEqual(result["quota_remaining_today"], 4)
            with db_connection() as conn:
                row = conn.execute("SELECT * FROM outbox WHERE id = ?", (result["outbox_id"],)).fetchone()
                proposals = conn.execute("SELECT COUNT(*) FROM proposals").fetchone()[0]
                activities = conn.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
                messages = conn.execute("SELECT COUNT(*) FROM communication_messages").fetchone()[0]
            self.assertEqual(row["kind"], "coach_message")
            self.assertEqual(row["created_by"], "hermes")
            self.assertEqual(row["status"], "queued")  # queued, NOT sent — dispatcher sends
            self.assertEqual(proposals, 0)
            self.assertEqual(activities, 0)
            self.assertEqual(messages, 0)

    def test_quota_exhaustion_returns_honest_error_and_queues_nothing(self) -> None:
        with TestClient(app):
            for i in range(5):
                self.assertEqual(mcp_server.message_owner(f"m{i}")["status"], "queued")
            result = mcp_server.message_owner("one too many")
            self.assertEqual(result["error"], "quota_exhausted")
            self.assertEqual(result["cap"], 5)
            self.assertIn("resets", result)
            with db_connection() as conn:
                count = conn.execute("SELECT COUNT(*) FROM outbox WHERE kind = 'coach_message'").fetchone()[0]
            self.assertEqual(count, 5)

    def test_rejects_empty_and_oversized_text(self) -> None:
        with TestClient(app):
            self.assertEqual(mcp_server.message_owner("   ")["status_code"], 422)
            self.assertEqual(mcp_server.message_owner("x" * 1001)["status_code"], 422)
            with db_connection() as conn:
                count = conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
            self.assertEqual(count, 0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/python -m pytest tests/test_mcp_message_owner.py -v`
Expected: FAIL — `AttributeError: module 'app.mcp_server' has no attribute 'message_owner'`.

- [ ] **Step 3: Implement**

3a. In `backend/app/mcp_server.py`:

- Update the module docstring's first paragraph (lines 3–7) to:

```python
"""Atlas MCP server (P4a + coach bridge).

A stdio MCP server exposing Atlas as a READ + PROPOSE + NOTIFY surface for an
external agent (e.g. Hermes). It reuses Atlas's own db_connection() and service
layer in-process. It can read real state, create PENDING proposals, and queue
rate-limited messages to the owner (message_owner -> outbox; the app-side
dispatcher sends them, enforcing quiet hours and a daily cap). By design it
exposes no accept/dismiss/apply/delete/raw-SQL tool — nothing changes
fact-plane state without the owner accepting a proposal in the inbox.
```

(keep the `Run:`/`NOTE:` lines that follow unchanged)

- Add imports (top of file, after the existing `app.core.database` import):

```python
from datetime import date, timedelta

from app.core.config import get_settings
from app.core.time import utc_now_iso
from app.modules.communication.outbox import coach_quota_remaining, enqueue
```

- Add the tool after `request_replan` (line ~146), and add `message_owner` to the `WRITE_TOOLS` list:

```python
def message_owner(text: str) -> dict:
    """Queue a short WhatsApp message to the owner (rate-limited; never sends
    directly — Atlas's dispatcher sends it, enforcing quiet hours + daily cap)."""
    cleaned = (text or "").strip()
    if not cleaned:
        return {"error": "text must not be empty", "status_code": 422}
    if len(cleaned) > 1000:
        return {"error": "text too long (max 1000 characters)", "status_code": 422}
    with db_connection() as conn:
        remaining = coach_quota_remaining(conn, "coach_message")
        if remaining <= 0:
            resets = f"{date.fromisoformat(utc_now_iso()[:10]) + timedelta(days=1)}T00:00:00+00:00"
            return {"error": "quota_exhausted", "cap": get_settings().coach_message_daily_cap, "resets": resets}
        row = enqueue(conn, kind="coach_message", body=cleaned, created_by="hermes")
    return {"status": "queued", "outbox_id": row["id"], "quota_remaining_today": remaining - 1}
```

```python
WRITE_TOOLS = [
    propose_module_status,
    propose_module_priority,
    propose_plan,
    request_replan,
    message_owner,
]
```

3b. In `backend/tests/test_mcp_safety.py`, add `"message_owner",` to the `ALLOWED` set (after `"request_replan",`). `FORBIDDEN_SUBSTRINGS` stays unchanged — `message_owner` contains none of them.

3c. In `backend/scripts/verify_mcp_ready.py`:
- Add `"message_owner",` to `EXPECTED_TOOLS`.
- In `_run`, after the pending-inbox assertion (line ~90), add:

```python
            note = _payload(await session.call_tool("message_owner", {"text": "readiness check"}))
            assert note.get("status") == "queued", "message_owner did not queue"
            print("  notify OK; message_owner queued (app-side dispatcher sends it)")
```

- Update the docstring's "checks the exact 10-tool surface" to "checks the exact 11-tool surface".

- [ ] **Step 4: Run the MCP suites**

Run: `cd backend && .venv/bin/python -m pytest tests/test_mcp_message_owner.py tests/test_mcp_safety.py tests/test_mcp_proposals.py tests/test_mcp_reads.py -v`
Expected: all PASS — safety pins now assert exactly 11 tools.

- [ ] **Step 5: Run the stdio readiness drill end-to-end**

Run: `cd backend && .venv/bin/python scripts/verify_mcp_ready.py`
Expected: prints `handshake OK; 11 tools`, the read/propose lines, `notify OK`, then `MCP READY`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/mcp_server.py backend/tests/test_mcp_safety.py backend/tests/test_mcp_message_owner.py backend/scripts/verify_mcp_ready.py
git commit -m "feat(mcp): message_owner tool #11 — rate-limited owner notify via the outbox"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/hermes-setup.md`
- Modify: `docs/atlas-mcp-setup.md`

- [ ] **Step 1: Update `docs/hermes-setup.md`**

1a. In the "Architecture recap" bullet list (after the diagram), append a bullet:

```markdown
- Hermes can also **message you directly** through Atlas's own WhatsApp line via the
  `message_owner` tool: messages queue in Atlas's outbox and Atlas sends them
  (quiet hours 22:00–08:00 local, max 5/day, honest quota errors). This is the
  sanctioned direct channel — Hermes's own WhatsApp bridge still must not be
  pointed at the Evolution number.
```

1b. In "Step 3 — give Hermes its operating brief", extend the quoted brief with (before "Everything you propose…"):

```markdown
> You may send the owner short messages via `message_owner` (max 5/day; Atlas
> enforces quiet hours and sends on your behalf). Prefer proposals for anything
> actionable — messages are for observations and questions only.
```

1c. In "Step 4 — verify the loop end to end", append:

```markdown
4. Ask Hermes to send you a short note via `message_owner`; within a minute
   (outside quiet hours) it should arrive on your WhatsApp, and appear in the
   hub's message list. Reply `accept <id>` to a proposal ping — the proposal is
   applied and audited exactly as if you'd clicked Accept in the Coach inbox.
```

- [ ] **Step 2: Update `docs/atlas-mcp-setup.md`**

Find the tool list (`grep -n "request_replan" docs/atlas-mcp-setup.md`) and append after the propose tools:

```markdown
- `message_owner(text)` — queue a rate-limited WhatsApp message to the owner
  (Atlas's dispatcher sends it; quiet hours + 5/day cap; never sends directly).
```

Also update any "10 tools" phrasing to "11 tools" (`grep -n "10" docs/atlas-mcp-setup.md`).

- [ ] **Step 3: Commit**

```bash
git add docs/hermes-setup.md docs/atlas-mcp-setup.md
git commit -m "docs: coach bridge — message_owner tool, reply-to-approve, updated Hermes brief"
```

---

### Task 10: Full verification

- [ ] **Step 1: Full test suite**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: everything passes, zero failures.

- [ ] **Step 2: Readiness drill (again, on the final tree)**

Run: `cd backend && .venv/bin/python scripts/verify_mcp_ready.py`
Expected: `MCP READY` with 11 tools.

- [ ] **Step 3: Manual smoke (optional, real bridge — dev machine)**

Start the API (`cd backend && .venv/bin/uvicorn app.main:app --reload`), create a pending proposal via `POST /api/v1/proposals`, and confirm: within ~60s (outside quiet hours) an outbox row flips to `sent` and a 🤖 message appears in `GET /api/v1/communication/messages` (dry-run provider — no real WhatsApp needed).
