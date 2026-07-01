# Proposal Inbox — Design Spec (P1)

- **Date:** 2026-07-01
- **Status:** Approved (design); ready for implementation planning
- **Roadmap phase:** P1 of `docs/superpowers/2026-07-01-smart-atlas-roadmap.md`

## 1. Summary

The **advisory spine** for the smart-Atlas thrust: a generic **Proposal Inbox** where
a suggested change is created as `pending`, surfaced to the owner, and applied **only**
when the owner accepts it. This is the mechanism that lets the coach (and later the
planning engine and Hermes) suggest changes with a voice but no unilateral power.

P1 ships the inbox plus its first concrete proposal types — **module lifecycle /
priority** — which apply real changes to modules that exist today, proving the full
**propose → approve → apply-via-validated-path** loop end to end.

## 2. Goals / Non-goals

**Goals**
- A `proposals` domain: create, list, accept (applies the change), dismiss (no change).
- Two working proposal types acting on existing modules: `set_module_priority`,
  `set_module_status`.
- An honest creator: `generate_module_proposals` scans **real** data (a module with no
  logged activity in N days) and proposes archiving it.
- A dashboard "Coach" inbox surface: pending proposals with Accept / Dismiss + rationale.
- Accept applies through a validated module service path; everything audited.

**Non-goals (later phases)**
- No plan/goal proposal types (P2).
- No Hermes / automatic generation cadence beyond a manual `/generate` trigger (P4 / a
  scheduler hook later).
- No new coaching intelligence — proposals here are rule-generated or API-created.

## 3. Current state (what we build on)

- `life_modules` has `priority` (int) and `status` (active|paused|completed|archived);
  `router.py::_set_status` already flips status + `archived_at` + audits, and
  `VALID_STATUSES` is defined there. `update_module` applies arbitrary fields via
  `apply_update`.
- Service-layer pattern established (`activity_ledger/service.py`,
  `dashboard/service.py`); routers should not reach into other routers' internals.
- `user_version` migration mechanism exists; **new tables** land via the `IF NOT EXISTS`
  baseline in `SCHEMA_SQL` (no version bump needed).
- `shared/schemas.py` holds request/response models (`AtlasModel` = extra="forbid";
  `AtlasResponse` = extra="allow"). `record_audit_event` + `audit_events` exist.
- Frontend is decomposed into `src/shared` + `src/features`; `App.tsx` is the shell.
  Memory constraints: dashboard is no-scroll (capped previews + expand modals);
  widgets should support CRUD in modals.

## 4. Data model

Add to `SCHEMA_SQL` (baseline, `IF NOT EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                       -- set_module_priority | set_module_status
  title TEXT NOT NULL,                      -- human summary
  rationale TEXT,                           -- WHY, grounded in real data
  payload TEXT NOT NULL DEFAULT '{}',       -- JSON args for the change
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | dismissed
  created_by TEXT NOT NULL DEFAULT 'system',-- system | user (later: hermes)
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
```

Add `"payload"` to the JSON-parsed key list in `row_to_dict` (so `payload` returns a dict).

## 5. Proposal types + payloads

| type | payload | accept applies |
|---|---|---|
| `set_module_priority` | `{"module_id": str, "priority": int}` | set the module's priority |
| `set_module_status` | `{"module_id": str, "status": str}` (archived\|paused\|active) | set the module's status |

## 6. Flow + accept dispatch

```
create → status=pending
  accept  → dispatch by type → apply via life_modules service → audit → status=accepted, resolved_at set
  dismiss → audit → status=dismissed, resolved_at set (no change applied)
```

Accept/dismiss on a non-pending proposal → 409. Accept whose payload references a missing
module → 404 (proposal stays pending). Unknown type → 422.

**Dispatch is a handler registry, not a conditional (OCP).** Accept looks the type up in
a `dict[str, ProposalHandler]` and calls the handler; adding a new type (P2's plan, a
P4 Hermes type) registers a handler without editing the dispatcher:

```python
ProposalHandler = Callable[[Connection, dict], dict]  # (conn, payload) -> changed entity

_HANDLERS: dict[str, ProposalHandler] = {
    "set_module_priority": _apply_set_module_priority,
    "set_module_status": _apply_set_module_status,
    # P2 adds: "activate_plan": _apply_activate_plan   (no change to accept_proposal)
}

def accept_proposal(conn, proposal_id) -> dict:
    proposal = get_or_404(conn, "proposals", proposal_id)
    if proposal["status"] != "pending":
        raise HTTPException(409, "Proposal already resolved")
    handler = _HANDLERS.get(proposal["type"])
    if handler is None:
        raise HTTPException(422, "Unknown proposal type")
    handler(conn, proposal["payload"])          # applies via life_modules service (may 404)
    # mark accepted + resolved_at + audit
    return updated_proposal
```

The two P1 handlers (`_apply_set_module_priority`, `_apply_set_module_status`) are thin
wrappers over the `life_modules` service functions (§7). `create_proposal` validates the
type is a known handler key up front, so an unknown type is rejected at create too.

## 7. `life_modules` service extraction (small, in-pattern)

So accept applies changes through validated logic (not raw SQL, not a router reach-in):

- Create `life_modules/service.py`:
  - `set_module_status(conn, module_id, status) -> dict` — validate `status in VALID_STATUSES`
    (422 otherwise), `get_or_404`, update status + `archived_at`, audit, return module.
    (Moves the body of the current `_set_status`.)
  - `set_module_priority(conn, module_id, priority) -> dict` — `get_or_404`, update
    priority, audit, return module.
  - Move `VALID_STATUSES` here.
- Refactor `life_modules/router.py`: the archive/pause/resume endpoints call
  `set_module_status`; import `VALID_STATUSES` from the service (used by `update_module`).
  No behavior change — verified by the existing module tests.

## 8. Endpoints (`proposals/router.py`, prefix `/proposals`)

- `POST /proposals` (201) → `ProposalCreate` → validates type + that `payload.module_id`
  exists → creates pending → `ProposalOut`.
- `GET /proposals?status=pending` → `list[ProposalOut]` (default pending; `status=all` for all).
- `POST /proposals/{id}/accept` → apply + resolve → `ProposalOut`.
- `POST /proposals/{id}/dismiss` → resolve → `ProposalOut`.
- `POST /proposals/generate` → run `generate_module_proposals`, return the created list.

Register the router in `main.py` under `/api/v1`.

## 9. Proposal generation (the honest creator)

`generate_module_proposals(conn) -> list[dict]`:
- For each `active` module with **zero activities in the last 14 days** (real query over
  `activities.occurred_at`), create a `set_module_status` → `archived` proposal, titled
  e.g. `"Archive {name}? No activity in 14 days"`, rationale citing the real gap.
- Idempotent: skip a module that already has a `pending` proposal of that type for it.
- No LLM; pure real-data heuristic.

## 10. Frontend — Coach inbox

- `api/atlas.ts`: `getProposals(status?)`, `acceptProposal(id)`, `dismissProposal(id)`,
  types `Proposal`.
- `src/features/coach-inbox.tsx`: a dashboard tile listing pending proposals (title +
  rationale + Accept/Dismiss); capped preview with an expand modal for the full list
  (no-scroll constraint). On accept/dismiss, refresh + re-fetch dashboard.
- Wire the tile into `App.tsx`'s dashboard view.

## 11. Honest-core guarantees

- Nothing changes until the owner accepts.
- Accept applies **only** through the `life_modules` service (validated: status whitelist,
  module existence) — no raw mutation, no fabrication.
- Rationale is grounded in real data (the generator cites actual activity gaps).
- Every create/accept/dismiss records an `audit_events` row.

## 12. Error handling

| Condition | Behavior |
|---|---|
| Unknown `type` on create/accept | 422 |
| `payload.module_id` missing/unknown | 404 (create rejects; accept leaves pending) |
| accept/dismiss a non-pending proposal | 409 |
| `set_module_status` with invalid status | 422 (from the service) |

## 13. Testing (TestClient + per-test temp DB)

- **Service:** `set_module_status`/`set_module_priority` apply + audit; invalid status → 422.
- **Proposals:** create pending; accept `set_module_priority` → module priority changed +
  status accepted; accept `set_module_status` archive → module archived; dismiss → no
  change, status dismissed; accept on already-resolved → 409; unknown type → 422; bad
  module_id → 404.
- **Generator:** a module with no recent activity yields one archive proposal; a module
  with recent activity yields none; running twice does not duplicate (idempotent).
- **Regression:** existing `life_modules` module tests still pass after the extraction.

## 14. Success criteria

- Create a proposal, accept it, and see the module actually change (priority/status) with
  an audit trail; dismiss leaves everything unchanged.
- `generate_module_proposals` proposes only for genuinely stale modules, grounded in real
  activity data, and never duplicates.
- The dashboard shows pending proposals with working Accept/Dismiss.
- ruff clean, all tests green.

## 15. How P2 / P4 build on this

- **P2** adds a `plan` proposal type (a proposed goal plan) — same inbox, same
  accept-dispatch pattern; accepting activates the plan.
- **P4** (Hermes) becomes a `created_by = "hermes"` producer of proposals via the MCP
  server — no change to the inbox or the accept path.
