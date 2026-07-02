# A Coach That Learns — Design Spec

- **Date:** 2026-07-02
- **Status:** Approved (design); ready for build
- **Basis:** `dashboard/service.py` recommendation engine; the command hero + Command Center.

## 1. Summary

Turn the recommendation engine from a one-item, partly OSCP-hardcoded rule chain into a
**generalized, ranked, keyed** coach whose suggestions derive entirely from real signals
across the user's own modules/disciplines/goals — and that **remembers your feedback**:
dismissing (or marking helpful) a recommendation persists, snoozing it for the day and
logging your taste as the signal a smarter coach (Hermes) can weight later.

Honest core intact: recommendations are still **derived live** from real data — only your
**feedback** is stored (keyed by a stable recommendation identity), never the recommendation
content.

## 2. Goals / Non-goals

**Goals**
- Rewrite recommendation generation: multiple **keyed** recommendations from generic rules
  over active modules/goals/disciplines — **no hardcoded OSCP / discipline strings**.
- Rank and return the top N (was `[:1]`); the hero shows the top, the Command Center shows
  the list.
- Persist feedback in a `recommendation_feedback` table; a recommendation is **snoozed for the
  day** once it has feedback today. `dismissed` and `helpful` both snooze; the action is the
  taste signal.
- Endpoint to record feedback; Command Center recommendation cards get dismiss + helpful.
- Tests (pytest) + frontend gates.

**Non-goals**
- No ML/weighting yet — feedback is logged for a future coach/Hermes to use.
- No hero-inline dismiss (keep the headline clean); feedback lives in the Command Center.
- No change to the P1 proposal inbox (recommendations are advisory nudges, not applied changes).

## 3. Data model

Add to `SCHEMA_SQL` (baseline, `IF NOT EXISTS`, no version bump):

```sql
CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id TEXT PRIMARY KEY,
  rec_key TEXT NOT NULL,
  action TEXT NOT NULL,          -- dismissed | helpful
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rec_feedback_key ON recommendation_feedback(rec_key);
```

## 4. Generation (generalized + keyed)

Replace `_module_recommendation` + `_build_recommendations` with `build_recommendations(conn,
recent_activities, weekly_balance, active_modules)` returning a **ranked list** of
`{key, severity, title, body}`. Rules (each derived from real signals; keys are stable):

| Rule | Key | When | Severity |
|---|---|---|---|
| Habit behind | `habit_behind:{module_id}` | active habit, `weekly_completions < weekly_target` | warning if 0 else info |
| Learning light | `learning_light:{module_id}` | active learning, `study_minutes < 45` | warning |
| Project open | `project_open:{module_id}` | active project, `total_open > 0` | info |
| Stale module | `stale_module:{module_id}` | active module, no activity in 14 days (real query) | warning |
| Goal behind | `goal_drift:{goal_id}` | active goal whose plan drift `on_track` is False | warning |
| Discipline gap | `discipline_gap:{slug}` | a discipline with active modules but 0 minutes this week | info |
| No signal today | `log_nudge` | zero activities today | info |

All copy is built from real names (`module["name"]`, goal title, discipline name) — **no
literal "OSCP"**. Rank: `warning` before `info`, then a fixed rule order for determinism.
Return the top **5**.

**Snooze filter:** exclude any recommendation whose `key` has a `recommendation_feedback` row
with `created_at >= start-of-today` (UTC midnight). One query builds the snoozed-key set.

`get_today_dashboard` calls the new generator (passing `conn`), returns the filtered ranked
list as `recommendations` (each item now includes `key`); `today_focus` still uses
`recommendations[0]`.

## 5. Feedback endpoint

New `recommendations` module (or fold into dashboard): `record_recommendation_feedback(conn,
rec_key, action)` — validate `action in {"dismissed","helpful"}` (422 otherwise), insert row,
`record_audit_event(entity_type="recommendation", entity_id=rec_key, action=...)`, return
`{"rec_key", "action"}`.

Router: `POST /recommendations/{rec_key}/feedback` → `RecommendationFeedback{action}` →
record → 200. Register under `/api/v1`.

## 6. Frontend

`api/atlas.ts`:
- `DashboardRecommendation` gains `key: string`.
- `sendRecommendationFeedback(recKey, action: "dismissed" | "helpful"): Promise<...>` →
  `POST /recommendations/{recKey}/feedback`.

`features/coach.tsx` (Command Center recommendations cards):
- Each recommendation card gets two icon-buttons: **helpful** (✓, `ThumbsUp`) and **dismiss**
  (×). Click → `sendRecommendationFeedback(key, ...)` → `onChanged()` (refresh dashboard, which
  re-derives & re-filters). Busy-guarded; aria-labelled.
- The hero (`RightNowHero`) is unchanged (shows the top recommendation as the headline; no
  inline buttons).

## 7. Honest-core & a11y

- Recommendations derive from real signals; only feedback is persisted (keyed, audited).
- Snooze is time-bounded (the day) — nothing is silenced permanently or fabricated.
- Feedback buttons have aria-labels; disabled while busy.

## 8. Testing

- **pytest:** generation produces the right keys for seeded module/goal states; copy contains
  the real module name, never a literal "OSCP" for a non-OSCP module; ranking puts `warning`
  first; dismissing a key removes it from the dashboard's `recommendations` (same day) while
  other keys remain; `helpful` also snoozes; feedback endpoint validates `action` (422) and
  audits; `log_nudge` appears only with zero activity today.
- **Frontend:** typecheck/lint/build clean; live — dismiss a recommendation in the Command
  Center, it disappears and stays gone on refresh; a second one remains.

## 9. Success criteria

- The coach surfaces several real, generalized recommendations (no OSCP hardcoding); dismiss/
  helpful persist and snooze for the day; the hero shows the current top one.
- ruff + pytest green; frontend typecheck/lint/build clean.
