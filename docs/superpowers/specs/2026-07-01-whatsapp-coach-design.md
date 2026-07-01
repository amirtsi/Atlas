# Atlas WhatsApp Q&A Coach — Design Spec

- **Date:** 2026-07-01
- **Status:** Approved (design); ready for implementation planning
- **Thrust:** A — "Make Atlas smart." This is the first increment.

## 1. Summary

Let the owner **ask Atlas questions over WhatsApp and get answers grounded in real
logged data**. Today the WhatsApp loop only turns messages into logged activities.
This adds a second path: when a message is a *question* ("how's OSCP this week?",
"what did I do today?", "am I behind on recovery?"), Atlas answers it from its real
ledger and replies on the same WhatsApp line.

It reuses the existing Evolution WhatsApp pipe (no second number, no bridge
conflict) and Atlas's existing LLM adapter. It is the conversational foundation the
later coaching/forward-planning work builds on.

## 2. Goals / Non-goals

**Goals**
- Owner messages a question on WhatsApp → gets a correct, real-data-grounded answer
  on WhatsApp.
- Zero fabrication: answers derive only from real logged data; "not logged" when the
  data doesn't contain it.
- Reuse the existing webhook, service layer, LLM adapter, send path, audit trail.
- Keep the existing "log an activity" path working unchanged.

**Non-goals (explicitly deferred to later specs in thrust A)**
- No Hermes runtime. Atlas answers with its own LLM adapter; Hermes can later replace
  the reasoning step behind the same front door.
- No forward planning, goals, plans, proposals, or the re-plan loop.
- No new WhatsApp number and no Hermes WhatsApp bridge.
- No write actions from the question path (it is read-only).

## 3. Current state (what we build on)

- **Inbound**: `communication/router.py::receive_evolution_webhook` → secret check →
  owner allowlist → loop/idempotency guard → `_handle_owner_message` →
  `classify_message` → on match, `insert_activity`; else a clarification reply.
- **Outbound**: `_send_and_store_reply` sends via Evolution (dry-run safe) and stores
  the message.
- **LLM adapter**: `communication/classifier.py::_anthropic_text` already calls the
  Anthropic API (Claude Haiku) with a minimal payload, guarded by
  `ATLAS_ANTHROPIC_API_KEY`; rules are the no-credential fallback.
- **Service layer** (from the recent refactor): `dashboard/service.py`,
  `activity_ledger/service.py`, `life_modules` reads, board overviews — the read
  surface the coach composes.
- **Audit**: every mutation/message already records an audit event.

## 4. Architecture & data flow

One new decision point on the existing webhook:

```
WhatsApp message (owner)
  → Evolution webhook          [existing: secret + owner allowlist + loop guard]
  → classify_intent(text): log | question | other      ← NEW
      ├─ log      → classify_message → insert_activity → confirm reply   [existing]
      ├─ question → coach.answer_question(conn, text) → reply            ← NEW
      └─ other    → clarification reply                                  [existing]
  → store inbound + reply (communication_messages) + audit event        [existing]
```

`coach.answer_question`:
1. **Build a real-data context pack** (read-only) from the service layer: today/week
   signals, active modules + behavior summaries, recent activities, and — if the
   question names a module — that module's overview.
2. **Ask the LLM** (existing Anthropic adapter) with a strict grounded prompt.
3. **Return** the answer text (or an honest "not logged" when the data is
   insufficient), which the router sends via the existing reply path.

## 5. Components & boundaries

Each unit has one purpose, a clear interface, and is testable in isolation.

- **`communication/intent.py`** — `classify_intent(text) -> "log" | "question" |
  "other"`. Rules-first (Hebrew + English): question marks and question words
  (what/how/why/when/how many · מה/איך/למה/מתי/כמה) → `question`; a completed action
  ± duration → `log`; otherwise `other`. No credentials required. Bias: when
  genuinely ambiguous, prefer `log` (so a logged activity is never mistaken for a
  question). An optional LLM tiebreak may be added later but is not required.

- **`coach/context.py`** — `build_context(conn, text) -> dict`. Composes the service
  layer into a compact, real-data pack (the actual numbers pre-computed). No LLM, no
  writes — pure read + shape. Directly unit-testable.

- **`coach/service.py`** — `answer_question(conn, text) -> dict` with
  `{answer, grounded, method}`. Calls `build_context`, then the LLM adapter with the
  grounded system prompt; returns the answer. On no-key/LLM-error, returns the honest
  fallback text (never fabricates).

- **`communication/router.py::_handle_owner_message`** — add the intent branch:
  `question` → `coach.answer_question` → `_send_and_store_reply`; `log`/`other`
  unchanged. Store the classification/intent + `ai_generated` flag in the inbound
  message metadata and record an audit event (as today).

- **Config (`core/config.py`)** — add `coach_model: str` (default the classification
  model / Haiku). Reuse `ATLAS_ANTHROPIC_API_KEY`. Add `coach_enabled: bool = True`
  as an off-switch.

## 6. Honest-core guarantees

- **Read-only by construction** — the coach only receives real rows via the service
  layer; it has no write path.
- **Grounded prompt** — answer only from the supplied data; if not present, reply
  "I don't have that logged" in the owner's language. Never invent numbers,
  activities, or modules.
- **Real numbers pre-computed** — the context pack carries actual counts/minutes/
  streaks/unit progress, so the model quotes real values, not estimates.
- **Fail honest** — LLM unavailable/errored → graceful "can't answer right now,"
  never a fabricated answer (mirrors the classifier's fail-safe).
- **Audited** — question, answer, and `ai_generated: true` stored in
  `communication_messages` metadata + an audit event.

## 7. Error handling & fallbacks

| Condition | Behavior |
|---|---|
| No `ATLAS_ANTHROPIC_API_KEY` | Question path replies "I can log things, but answering questions needs the AI key configured." Logging path unaffected. |
| LLM timeout / HTTP error | Graceful "couldn't answer right now — try again," never fabrication. |
| Ambiguous intent | Prefer log-classify; only answer when it clearly reads as a question; else clarification. |
| Non-owner sender | Ignored (stored for audit), exactly as today. |
| `coach_enabled = false` | Question path falls back to the existing clarification reply. |

## 8. Testing strategy

Reuse the harness (`TestClient` + per-test temp DB + dry-run Evolution).

- **Intent unit tests** — representative he/en logs vs questions classify correctly;
  ambiguous cases resolve to the documented bias.
- **Context builder unit tests** — seed a temp DB with known activities/modules;
  assert the pack contains the real numbers and nothing invented.
- **Honest-core tests (deterministic, no real LLM)** — with no API key, a question
  about a module with zero activity yields the honest "not logged / needs key"
  fallback, never invented numbers. (The LLM call is isolated behind the adapter, so
  the fallback and context paths are tested without network.)
- **End-to-end webhook test** — a question message (dry-run) stores an answer reply +
  audit event; a log message still logs an activity (no regression).

## 9. Rollout

- Ships behind the existing key gate: with no key, logging works and questions return
  the graceful fallback — safe to merge before the key is set.
- Dry-run safe end-to-end (no live WhatsApp needed to test).
- Verify with the test suite + a manual dry-run question through the webhook.

## 10. How Hermes / forward planning fit later (context, not scope)

This spec deliberately keeps the reasoning step inside Atlas. Later specs in thrust A:
- Replace `coach.answer_question`'s LLM call with **Hermes** (adding persistent
  memory + learning) behind the same WhatsApp front door — no change to the webhook.
- Add the **forward-planning engine** (goals → plans → milestones, ledger-derived
  progress, the advisory proposal inbox) from `docs/planning-engine.md`.

The seam here (intent routing + a `coach` service over the service layer) is chosen so
those drop in without reworking the front door.

## 11. Success criteria

- From WhatsApp, "what did I do this week?" returns the real count/minutes.
- "How's OSCP?" returns real study minutes / unit progress, or "not logged" if none.
- A question about an empty module never invents numbers.
- Logging a normal activity still works unchanged.
- ruff clean, all tests green.
