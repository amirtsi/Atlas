# Atlas Technical Planning Document

## 1. Product Definition

Atlas is a personal Life Operating System for one primary user. It is a structured dashboard and life journal that moves life management out of memory, notes, and scattered apps into a visual system organized by disciplines and modules.

Atlas V1 is not a generic todo app, calendar app, habit tracker, or project management tool. It can contain tasks, calendar events, habits, logs, and project progress, but those are implementation details inside a broader life-management model.

The core product promise:

- Show what matters today.
- Make real-life activity logging fast enough to use daily.
- Connect work, health, recovery, learning, relationships, and finance into one dashboard.
- Track progress by discipline without forcing every area into the same workflow.
- Provide simple recommendations based on recent activity, balance, overload, and missed commitments.

### Target User

Atlas V1 is built for a single advanced personal user running the system locally on:

- Raspberry Pi 5.
- 10-13 inch touchscreen.
- Browser kiosk mode.
- Local network access.
- Dark dashboard UI.
- Hebrew RTL support from day one.

### Product Principles

- Everything is a module.
- Modules belong to disciplines.
- Activities are the primary source of truth for what happened.
- Metrics are optional and can be quantitative or qualitative.
- Logging must take less than 10 seconds for common actions.
- V1 should favor clarity, reliability, and local ownership over complex automation.
- V1 is a modular monolith, not microservices.

### MVP Scope

The MVP should include:

- Discipline management.
- Module management.
- Activity ledger.
- Dashboard.
- Habit module behavior.
- Project module behavior.
- Learning module behavior.
- Recovery module behavior.
- Basic metrics.
- Rule-based AI Coach recommendations.
- Local SQLite persistence.
- Docker Compose deployment.
- Hebrew RTL capable frontend layout.

Out of scope for V1:

- Multi-user accounts.
- External calendar sync.
- Mobile app.
- Push notifications.
- Full LLM agent workflows.
- Microservices.
- Complex permission model.
- Public hosting.

## 2. Domain Model

Atlas follows this core model:

```text
Discipline -> Module -> Activities -> Metrics
```

### Discipline

A discipline is a major area of life. It groups modules and provides dashboard balance.

Examples:

- Career / Work.
- Health.
- Fitness.
- Recovery.
- Learning.
- Cybersecurity / OSCP.
- Relationship.
- Finance.
- Personal development.

Core fields:

- `id`.
- `name`.
- `slug`.
- `description`.
- `color`.
- `icon`.
- `sort_order`.
- `is_active`.
- `created_at`.
- `updated_at`.

### Module

A module is a typed unit of life management inside a discipline.

Examples:

- ParkNet project.
- Gym habit.
- Algo Fit recovery program.
- OSCP learning goal.
- Relationship quality-time tracker.
- Finance review.

Core fields:

- `id`.
- `discipline_id`.
- `type`.
- `name`.
- `slug`.
- `description`.
- `status`.
- `priority`.
- `config`.
- `start_date`.
- `target_date`.
- `archived_at`.
- `created_at`.
- `updated_at`.

Module status values:

- `active`.
- `paused`.
- `completed`.
- `archived`.

Initial module types:

- `project`.
- `habit`.
- `learning`.
- `recovery`.
- `relationship`.
- `calendar`.
- `ledger`.
- `ai_coach`.
- `analytics`.

### Activity

An activity is a fast log of a real completed action. Activities are the main daily input mechanism.

Examples:

- Fixed bug in ParkNet.
- Code review.
- Deployment.
- Gym workout.
- Algo Fit session.
- Physiotherapy.
- OSCP study.
- Hack The Box lab.
- Quality time with partner.
- Rest day.

Core fields:

- `id`.
- `discipline_id`.
- `module_id`.
- `activity_type`.
- `title`.
- `notes`.
- `occurred_at`.
- `duration_minutes`.
- `energy_level`.
- `mood_level`.
- `source`.
- `metadata`.
- `created_at`.
- `updated_at`.

Activity source values:

- `manual`.
- `quick_log`.
- `calendar`.
- `import`.
- `system`.

### Metric

A metric is an optional measurement attached to a module, activity, or daily summary.

Quantitative examples:

- Workouts completed.
- Study hours.
- Bugs fixed.
- PRs closed.
- Machines solved.

Qualitative examples:

- Energy level 1-5.
- Pain level 1-10.
- Quality time rating 1-5.
- Focus level 1-5.

Core fields:

- `id`.
- `discipline_id`.
- `module_id`.
- `activity_id`.
- `metric_key`.
- `value_number`.
- `value_text`.
- `scale_min`.
- `scale_max`.
- `unit`.
- `recorded_at`.
- `created_at`.

### Module-Specific Models

Atlas should keep common data in shared tables and module-specific data in dedicated tables. This keeps the monolith simple while preserving clean boundaries.

Project module:

- Roadmap items.
- Releases.
- Tasks.
- Bugs.
- Features.
- Activity feed.
- Progress.

Habit module:

- Weekly target.
- Frequency.
- Streak.
- Completion log.
- Progress.

Recovery module:

- Physiotherapy sessions.
- Pain level.
- Mobility.
- Recovery notes.
- Weekly report.

Learning module:

- Study sessions.
- Study modules.
- Labs.
- Machines solved.
- Readiness score.

## 3. Modular Monolith Architecture

Atlas V1 should be a modular monolith:

- One frontend.
- One backend.
- One database.
- One Docker Compose stack.
- Internal module boundaries.
- Shared authentication can be minimal or disabled locally for V1.
- No network calls between internal modules.

### Why Modular Monolith

The first version serves one user on one local device. Microservices would add unnecessary operational overhead:

- More deployments.
- More network failure modes.
- More data consistency problems.
- More observability requirements.
- More Raspberry Pi resource usage.

A modular monolith gives the project the right V1 tradeoff:

- Simple deployment.
- Shared local database.
- Clear internal boundaries.
- Easier refactoring.
- Future extraction path if needed.

### Backend Recommendation

Recommended backend for Atlas V1:

- FastAPI.
- Python 3.12+.
- SQLite for MVP.
- SQLAlchemy 2.x.
- Alembic migrations.
- Pydantic schemas.
- Uvicorn.

FastAPI is a strong fit because:

- Small operational footprint.
- Good API ergonomics.
- Good SQLite support.
- Easy typed schemas.
- Practical for Raspberry Pi deployment.

NestJS is also viable, but FastAPI is likely simpler for a local-first personal dashboard.

### Frontend Recommendation

Recommended frontend:

- React.
- TypeScript.
- Vite.
- TailwindCSS.
- shadcn/ui.
- TanStack Query.
- React Router.
- Recharts or Tremor-style chart primitives.

Frontend principles:

- Dashboard-first experience.
- Touch-friendly controls.
- Dark UI by default.
- RTL-aware layout.
- Dense but readable information.
- Fast quick-log workflow.

### Internal Backend Module Boundary

Each backend module should own:

- Routes.
- Service layer.
- Repository layer.
- Pydantic schemas.
- Module-specific database models.
- Module-specific business rules.

Shared infrastructure should own:

- Database session.
- Config.
- Logging.
- Time utilities.
- Base models.
- Common errors.
- Pagination.
- Dashboard aggregation contracts.

Cross-module interaction should happen through internal service interfaces, not direct table access from unrelated modules.

## 4. Folder Structure

Recommended repository structure:

```text
atlas/
  backend/
    app/
      main.py
      core/
        config.py
        database.py
        errors.py
        logging.py
        time.py
      shared/
        pagination.py
        schemas.py
        enums.py
      modules/
        disciplines/
          router.py
          service.py
          repository.py
          models.py
          schemas.py
        modules/
          router.py
          service.py
          repository.py
          models.py
          schemas.py
        activity_ledger/
          router.py
          service.py
          repository.py
          models.py
          schemas.py
        dashboard/
          router.py
          service.py
          schemas.py
        ai_coach/
          router.py
          service.py
          rules.py
          schemas.py
        project/
          router.py
          service.py
          repository.py
          models.py
          schemas.py
        habit/
          router.py
          service.py
          repository.py
          models.py
          schemas.py
        recovery/
          router.py
          service.py
          repository.py
          models.py
          schemas.py
        learning/
          router.py
          service.py
          repository.py
          models.py
          schemas.py
        analytics/
          router.py
          service.py
          schemas.py
      migrations/
        env.py
        versions/
    tests/
      modules/
      integration/
    pyproject.toml
    alembic.ini

  frontend/
    src/
      app/
        App.tsx
        router.tsx
        providers.tsx
      api/
        client.ts
        queries.ts
      components/
        layout/
          AppShell.tsx
          Sidebar.tsx
          Header.tsx
          KioskFrame.tsx
        dashboard/
          TodayFocus.tsx
          CalendarOverview.tsx
          ActiveModules.tsx
          RecentActivities.tsx
          HabitStatus.tsx
          ProjectProgress.tsx
          RecoveryStatus.tsx
          LearningProgress.tsx
          WeeklyBalance.tsx
        quick-log/
          QuickLogButton.tsx
          QuickLogDialog.tsx
          ActivityTemplateGrid.tsx
        modules/
          ModuleCard.tsx
          ModuleHeader.tsx
          ModuleMetrics.tsx
        ui/
      features/
        dashboard/
        disciplines/
        modules/
        activity-ledger/
        project/
        habit/
        recovery/
        learning/
        ai-coach/
      i18n/
        index.ts
        he.ts
        en.ts
      styles/
        globals.css
      main.tsx
    package.json
    vite.config.ts

  deploy/
    docker-compose.yml
    backend.Dockerfile
    frontend.Dockerfile
    nginx.conf
    raspberry-pi/
      kiosk.service
      setup.md

  docs/
    atlas-product-brief.md
    architecture.md
    api.md
```

For the first implementation pass, it is acceptable to keep docs, backend, frontend, and deploy in one repository.

## 5. Database Schema

SQLite should be the MVP database. Use SQLAlchemy models and Alembic migrations from the start so PostgreSQL migration is not painful later.

### Schema Principles

- Use UUID primary keys stored as text for portability.
- Store timestamps in UTC.
- Store user-facing dates with timezone-aware handling in the application layer.
- Use JSON columns for module config and metadata where flexibility is useful.
- Keep module-specific tables separate from shared core tables.
- Avoid premature generic entity-attribute-value modeling.

### Core Tables

#### `disciplines`

```sql
CREATE TABLE disciplines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  color TEXT,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### `life_modules`

```sql
CREATE TABLE life_modules (
  id TEXT PRIMARY KEY,
  discipline_id TEXT NOT NULL REFERENCES disciplines(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  priority INTEGER NOT NULL DEFAULT 3,
  config TEXT NOT NULL DEFAULT '{}',
  start_date TEXT,
  target_date TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Recommended indexes:

```sql
CREATE INDEX idx_life_modules_discipline_id ON life_modules(discipline_id);
CREATE INDEX idx_life_modules_type ON life_modules(type);
CREATE INDEX idx_life_modules_status ON life_modules(status);
```

#### `activities`

```sql
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  discipline_id TEXT REFERENCES disciplines(id),
  module_id TEXT REFERENCES life_modules(id),
  activity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  occurred_at TEXT NOT NULL,
  duration_minutes INTEGER,
  energy_level INTEGER,
  mood_level INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Recommended indexes:

```sql
CREATE INDEX idx_activities_occurred_at ON activities(occurred_at);
CREATE INDEX idx_activities_module_id ON activities(module_id);
CREATE INDEX idx_activities_discipline_id ON activities(discipline_id);
CREATE INDEX idx_activities_activity_type ON activities(activity_type);
```

#### `metrics`

```sql
CREATE TABLE metrics (
  id TEXT PRIMARY KEY,
  discipline_id TEXT REFERENCES disciplines(id),
  module_id TEXT REFERENCES life_modules(id),
  activity_id TEXT REFERENCES activities(id),
  metric_key TEXT NOT NULL,
  value_number REAL,
  value_text TEXT,
  scale_min REAL,
  scale_max REAL,
  unit TEXT,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Recommended indexes:

```sql
CREATE INDEX idx_metrics_key_recorded_at ON metrics(metric_key, recorded_at);
CREATE INDEX idx_metrics_module_id ON metrics(module_id);
CREATE INDEX idx_metrics_activity_id ON metrics(activity_id);
```

#### `activity_templates`

Used for sub-10-second logging.

```sql
CREATE TABLE activity_templates (
  id TEXT PRIMARY KEY,
  discipline_id TEXT REFERENCES disciplines(id),
  module_id TEXT REFERENCES life_modules(id),
  title TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  default_duration_minutes INTEGER,
  default_metadata TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### `daily_focus`

```sql
CREATE TABLE daily_focus (
  id TEXT PRIMARY KEY,
  focus_date TEXT NOT NULL UNIQUE,
  primary_module_id TEXT REFERENCES life_modules(id),
  secondary_module_id TEXT REFERENCES life_modules(id),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Project Module Tables

#### `project_items`

```sql
CREATE TABLE project_items (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 3,
  due_date TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`item_type` values:

- `task`.
- `bug`.
- `feature`.
- `roadmap`.

#### `project_releases`

```sql
CREATE TABLE project_releases (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  target_date TEXT,
  released_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Habit Module Tables

#### `habit_settings`

```sql
CREATE TABLE habit_settings (
  module_id TEXT PRIMARY KEY REFERENCES life_modules(id),
  weekly_target INTEGER NOT NULL,
  frequency_type TEXT NOT NULL,
  target_duration_minutes INTEGER,
  reset_day INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

#### `habit_completions`

```sql
CREATE TABLE habit_completions (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  activity_id TEXT REFERENCES activities(id),
  completed_at TEXT NOT NULL,
  duration_minutes INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL
);
```

### Recovery Module Tables

#### `recovery_sessions`

```sql
CREATE TABLE recovery_sessions (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  activity_id TEXT REFERENCES activities(id),
  session_type TEXT NOT NULL,
  pain_level INTEGER,
  mobility_level INTEGER,
  duration_minutes INTEGER,
  notes TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

#### `recovery_weekly_reports`

```sql
CREATE TABLE recovery_weekly_reports (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  week_start TEXT NOT NULL,
  pain_avg REAL,
  mobility_avg REAL,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Learning Module Tables

#### `learning_units`

```sql
CREATE TABLE learning_units (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  title TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

`unit_type` examples:

- `module`.
- `lab`.
- `machine`.
- `exam_topic`.

#### `learning_sessions`

```sql
CREATE TABLE learning_sessions (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  activity_id TEXT REFERENCES activities(id),
  learning_unit_id TEXT REFERENCES learning_units(id),
  duration_minutes INTEGER NOT NULL,
  focus_level INTEGER,
  notes TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### AI Coach Tables

#### `recommendations`

```sql
CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  status TEXT NOT NULL DEFAULT 'active',
  generated_at TEXT NOT NULL,
  dismissed_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);
```

Severity values:

- `info`.
- `warning`.
- `critical`.

Status values:

- `active`.
- `dismissed`.
- `accepted`.
- `expired`.

## 6. API Endpoints

Use REST endpoints for V1. Keep them boring, predictable, and easy to test.

Base path:

```text
/api/v1
```

### Health

```text
GET /health
```

Returns service and database health.

### Disciplines

```text
GET    /api/v1/disciplines
POST   /api/v1/disciplines
GET    /api/v1/disciplines/{discipline_id}
PATCH  /api/v1/disciplines/{discipline_id}
DELETE /api/v1/disciplines/{discipline_id}
```

Delete should soft-disable or archive if related modules exist.

### Life Modules

```text
GET    /api/v1/modules
POST   /api/v1/modules
GET    /api/v1/modules/{module_id}
PATCH  /api/v1/modules/{module_id}
POST   /api/v1/modules/{module_id}/archive
POST   /api/v1/modules/{module_id}/pause
POST   /api/v1/modules/{module_id}/resume
```

Query parameters:

- `discipline_id`.
- `type`.
- `status`.
- `limit`.
- `offset`.

### Activity Ledger

```text
GET    /api/v1/activities
POST   /api/v1/activities
GET    /api/v1/activities/{activity_id}
PATCH  /api/v1/activities/{activity_id}
DELETE /api/v1/activities/{activity_id}
POST   /api/v1/activities/quick-log
```

The quick-log endpoint should accept either:

- `template_id`.
- Or minimal activity fields: `module_id`, `title`, `activity_type`, `duration_minutes`.

### WhatsApp Activity Logging MVP+

WhatsApp can be added after MVP as an optional communication channel for Activity Ledger input.

Selected provider:

- [`evolution-foundation/evolution-api`](https://github.com/evolution-foundation/evolution-api)

Purpose:

- Let the user log completed real-life activity without opening Atlas.
- Use LLM-based natural language understanding to classify the message into `Discipline`, `LifeModule`, and `Activity`.
- Reply only with a short confirmation or one clarification question.

Non-goals:

- Do not manage WhatsApp.
- Do not become an inbox.
- Do not send long summaries.
- Do not expose broad Atlas data over chat.

Example mappings:

```text
"Finished physiotherapy" -> Recovery activity
"Fixed the Parking Flow bug" -> ParkNet activity
"Studied OSCP for 45 minutes" -> Learning activity, duration 45
"Went to the gym" -> Fitness activity
```

Recommended endpoints when implemented:

```text
GET  /api/v1/integrations/whatsapp/webhook
POST /api/v1/integrations/whatsapp/webhook
GET  /api/v1/integrations/whatsapp/status
POST /api/v1/integrations/whatsapp/test-classify
```

This integration should call the same internal Activity Ledger service used by Quick Log. WhatsApp is only another input channel.

Evolution API should be treated as an external infrastructure service. Atlas should interact with it through a small provider adapter and should store only normalized inbound messages, classification output, and resulting activity links.

### Activity Templates

```text
GET    /api/v1/activity-templates
POST   /api/v1/activity-templates
PATCH  /api/v1/activity-templates/{template_id}
DELETE /api/v1/activity-templates/{template_id}
```

### Metrics

```text
GET  /api/v1/metrics
POST /api/v1/metrics
GET  /api/v1/modules/{module_id}/metrics
```

### Dashboard

```text
GET /api/v1/dashboard/today
GET /api/v1/dashboard/week
GET /api/v1/dashboard/balance
```

`GET /dashboard/today` should return one aggregated payload:

- Today's focus.
- Calendar overview.
- Active modules.
- Recent activities.
- Habit status.
- Project progress.
- Recovery status.
- Learning progress.
- Weekly balance.
- Active recommendations.

### Daily Focus

```text
GET   /api/v1/focus/today
PUT   /api/v1/focus/today
GET   /api/v1/focus/{date}
PUT   /api/v1/focus/{date}
```

### Project Module

```text
GET    /api/v1/project/{module_id}/overview
GET    /api/v1/project/{module_id}/items
POST   /api/v1/project/{module_id}/items
PATCH  /api/v1/project/{module_id}/items/{item_id}
DELETE /api/v1/project/{module_id}/items/{item_id}
GET    /api/v1/project/{module_id}/releases
POST   /api/v1/project/{module_id}/releases
PATCH  /api/v1/project/{module_id}/releases/{release_id}
```

### Habit Module

```text
GET   /api/v1/habit/{module_id}/overview
GET   /api/v1/habit/{module_id}/settings
PUT   /api/v1/habit/{module_id}/settings
POST  /api/v1/habit/{module_id}/complete
GET   /api/v1/habit/{module_id}/completions
```

### Recovery Module

```text
GET  /api/v1/recovery/{module_id}/overview
POST /api/v1/recovery/{module_id}/sessions
GET  /api/v1/recovery/{module_id}/sessions
GET  /api/v1/recovery/{module_id}/weekly-report
```

### Learning Module

```text
GET    /api/v1/learning/{module_id}/overview
GET    /api/v1/learning/{module_id}/units
POST   /api/v1/learning/{module_id}/units
PATCH  /api/v1/learning/{module_id}/units/{unit_id}
POST   /api/v1/learning/{module_id}/sessions
GET    /api/v1/learning/{module_id}/sessions
```

### AI Coach

```text
GET  /api/v1/coach/recommendations
POST /api/v1/coach/recommendations/generate
POST /api/v1/coach/recommendations/{recommendation_id}/dismiss
POST /api/v1/coach/recommendations/{recommendation_id}/accept
```

For MVP, recommendation generation can run:

- On dashboard load.
- On manual refresh.
- Later on a scheduled background job.

## 7. Frontend Pages and Components

### Routes

Recommended MVP routes:

```text
/                         Dashboard
/ledger                   Activity Ledger
/quick-log                Full quick-log screen for touchscreen mode
/disciplines              Discipline list
/disciplines/:id          Discipline detail
/modules                  All modules
/modules/:id              Module detail router
/modules/:id/project      Project module view
/modules/:id/habit        Habit module view
/modules/:id/recovery     Recovery module view
/modules/:id/learning     Learning module view
/coach                    AI Coach recommendations
/settings                 Local settings
```

### App Shell

The app shell should include:

- Persistent left or right navigation depending on language direction.
- Top bar with current date, quick-log button, and status.
- Main dashboard content.
- Kiosk-safe layout with large touch targets.
- RTL-aware spacing and alignment.

### Dashboard Components

Required dashboard components:

- `TodayFocus`.
- `CalendarOverview`.
- `ActiveModules`.
- `RecentActivities`.
- `HabitStatus`.
- `ProjectProgress`.
- `RecoveryStatus`.
- `LearningProgress`.
- `WeeklyBalance`.
- `CoachRecommendations`.

Dashboard behavior:

- Load from one dashboard API payload.
- Show skeleton loading state.
- Show stale/error state if backend is unavailable.
- Keep quick-log always reachable.
- Support manual refresh.

### Quick Log Components

Quick logging is critical. It should be optimized before advanced analytics.

Components:

- `QuickLogButton`.
- `QuickLogDialog`.
- `ActivityTemplateGrid`.
- `DurationPicker`.
- `EnergyPicker`.
- `NotesField`.
- `RecentActivityRepeat`.

Fast paths:

- One-tap template log.
- Template plus duration adjustment.
- Repeat previous activity.
- Manual custom activity.

Target interaction:

- Common activity logging should take less than 10 seconds.
- Most logs should require 1-3 taps.

### Module Detail Components

Shared:

- `ModuleHeader`.
- `ModuleStatsStrip`.
- `ModuleActivityFeed`.
- `ModuleMetricChart`.
- `ModuleActions`.

Project:

- Roadmap panel.
- Release panel.
- Task/bug/feature table.
- Activity feed.
- Progress summary.

Habit:

- Weekly target.
- Streak.
- Completion calendar.
- Log completion button.
- Frequency summary.

Recovery:

- Physiotherapy sessions.
- Pain trend.
- Mobility trend.
- Weekly report.
- Notes timeline.

Learning:

- Study sessions.
- Modules/labs/machines.
- Readiness score.
- Time studied this week.
- Completion progress.

### RTL and Hebrew Support

The frontend should support RTL from the first implementation:

- Use `dir="rtl"` when Hebrew is active.
- Keep layout components direction-aware.
- Avoid hardcoded `left` and `right` where `start` and `end` are more appropriate.
- Use logical CSS properties where possible.
- Keep icons and progress indicators visually correct in RTL.
- Store labels separately in `i18n/he.ts` and `i18n/en.ts`.

MVP can start with English labels while the layout remains RTL-capable, or with Hebrew labels if desired. The architecture should not assume LTR.

## 8. Module Interface Design

Every module type should implement a common internal interface so the dashboard and analytics modules can treat them consistently while allowing different behavior.

### Backend Module Contract

Conceptual interface:

```text
ModuleProvider
  type: string
  get_overview(module_id, date_range) -> ModuleOverview
  get_dashboard_card(module_id, today) -> DashboardCard
  get_recent_activity(module_id, limit) -> Activity[]
  get_metrics(module_id, date_range) -> MetricSeries[]
  validate_config(config) -> ValidatedConfig
  handle_activity_created(activity) -> void
```

This does not need to be a complex plugin system in V1. It can be a simple registry:

```text
module_type -> provider instance
```

Example:

```text
project -> ProjectModuleProvider
habit -> HabitModuleProvider
recovery -> RecoveryModuleProvider
learning -> LearningModuleProvider
```

### Shared Overview Shape

Each module provider should return a common overview envelope:

```text
ModuleOverview
  module_id
  module_type
  title
  status
  summary
  progress_percent
  primary_metric
  secondary_metrics
  recent_activities
  alerts
  updated_at
```

Module-specific data can live under:

```text
details: object
```

Examples:

- Project details: open bugs, completed tasks, next release.
- Habit details: streak, weekly target, completions this week.
- Recovery details: pain average, mobility trend, sessions this week.
- Learning details: study hours, machines solved, readiness score.

### Activity Handling

When an activity is created:

1. Activity Ledger stores the common activity record.
2. If the activity belongs to a module, the module provider receives the event internally.
3. The provider may create module-specific records.
4. Metrics may be created or updated.
5. Dashboard aggregation reads the updated state.

For V1 this can be synchronous inside the request. No event bus is required.

### Module Config

Each module can store a JSON config in `life_modules.config`.

Examples:

Project config:

```json
{
  "default_view": "roadmap",
  "progress_strategy": "completed_items",
  "show_releases": true
}
```

Habit config:

```json
{
  "weekly_target": 4,
  "frequency_type": "weekly",
  "streak_enabled": true
}
```

Recovery config:

```json
{
  "pain_scale_max": 10,
  "mobility_scale_max": 10,
  "weekly_report_day": 6
}
```

Learning config:

```json
{
  "readiness_score_enabled": true,
  "target_exam_date": null,
  "weekly_study_target_minutes": 420
}
```

Important: JSON config should not replace real tables for records that need querying. Use config for settings, not core history.

## 9. Dashboard Layout

The dashboard is the primary product surface.

### Desktop / Touchscreen Layout

Target viewport:

- 10-13 inch touchscreen.
- Landscape orientation preferred.
- Browser kiosk mode.
- Dark dashboard.

Recommended layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ Header: Date | System status | Quick Log                    │
├───────────────┬───────────────────────────────┬─────────────┤
│ Navigation    │ Today Focus                   │ Calendar    │
│               ├───────────────────────────────┼─────────────┤
│               │ Active Modules                │ Coach       │
│               ├───────────────┬───────────────┼─────────────┤
│               │ Habit Status  │ Recovery      │ Learning    │
│               ├───────────────┴───────────────┼─────────────┤
│               │ Recent Activities             │ Balance     │
└───────────────┴───────────────────────────────┴─────────────┘
```

For RTL Hebrew mode, navigation can move to the right and content ordering should feel natural for RTL reading.

### Dashboard Sections

#### Today's Focus

Purpose:

- Make the day obvious.
- Reduce decision fatigue.

Shows:

- Primary focus module.
- Secondary focus module.
- Suggested next action.
- Available time hint if available manually.

#### Calendar Overview

MVP:

- Manual local calendar entries or simple planned blocks.

Later:

- External calendar sync.

Shows:

- Today's planned blocks.
- Upcoming events.
- Free windows.

#### Active Modules

Shows:

- Active modules grouped by discipline.
- Status.
- Priority.
- Last activity.
- Progress.

#### Recent Activities

Shows:

- Last 10-20 logged activities.
- Time.
- Module.
- Discipline.
- Duration.

#### Habit Status

Shows:

- Weekly target progress.
- Streak.
- Missed habits.
- Quick complete action.

#### Project Progress

Shows:

- Open tasks.
- Open bugs.
- Release progress.
- Recent project activity.

#### Recovery Status

Shows:

- Sessions this week.
- Pain trend.
- Mobility trend.
- Missed physiotherapy alerts.

#### Learning Progress

Shows:

- Study time this week.
- Units completed.
- Labs/machines solved.
- Readiness score.

#### Weekly Balance

Shows:

- Activity time by discipline.
- Activity count by discipline.
- Overload warnings.
- Under-attended areas.

### Dashboard Refresh

MVP:

- Fetch on page load.
- Manual refresh button.
- Optional 60-second polling.

Avoid over-refreshing on Raspberry Pi. Use TanStack Query stale times and a single dashboard aggregate endpoint.

## 10. MVP Milestones

### Milestone 0: Project Foundation

Goal:

- Establish the monorepo, backend, frontend, and deployment skeleton.

Deliverables:

- Backend FastAPI app.
- Frontend Vite app.
- TailwindCSS and shadcn/ui setup.
- SQLite connection.
- Alembic migrations.
- Docker Compose skeleton.
- Health endpoint.

Validation:

- App runs locally.
- Backend health check works.
- Frontend can call backend.
- Docker Compose starts both services.

### Milestone 1: Core Domain

Goal:

- Build disciplines, modules, activities, and metrics.

Deliverables:

- Discipline CRUD.
- Module CRUD.
- Activity Ledger CRUD.
- Metrics create/list.
- Activity templates.
- Seed data for initial disciplines and modules.

Validation:

- User can create disciplines.
- User can create modules under disciplines.
- User can log activity manually.
- User can log from templates.

### Milestone 2: Dashboard MVP

Goal:

- Make the first useful dashboard.

Deliverables:

- Dashboard aggregate endpoint.
- Today Focus.
- Active Modules.
- Recent Activities.
- Habit Status placeholder.
- Project Progress placeholder.
- Weekly Balance.
- Dark responsive layout.
- RTL-capable app shell.

Validation:

- Dashboard loads in browser.
- Dashboard works at Raspberry Pi tablet resolution.
- Quick-log is reachable from dashboard.

### Milestone 3: Habit and Project Modules

Goal:

- Implement first real module-specific behavior.

Deliverables:

- Habit settings.
- Habit completions.
- Weekly target progress.
- Streak calculation.
- Project items.
- Project releases.
- Project progress.

Validation:

- Gym habit can be tracked.
- ParkNet project can show roadmap/tasks/bugs/features.
- Activity logs update relevant module views.

### Milestone 4: Recovery and Learning Modules

Goal:

- Support recovery and OSCP-style learning workflows.

Deliverables:

- Recovery sessions.
- Pain and mobility metrics.
- Recovery weekly report.
- Learning units.
- Learning sessions.
- Learning progress.
- Readiness score placeholder.

Validation:

- Physiotherapy can be logged.
- Pain and mobility trend are visible.
- OSCP study sessions can be logged.
- Labs/machines can be tracked.

### Milestone 5: Rule-Based AI Coach

Goal:

- Add practical recommendations from actual usage.

Deliverables:

- Recommendation rules.
- Recommendations table.
- Generate recommendations endpoint.
- Dashboard recommendation card.
- Dismiss/accept actions.

Initial rules:

- Work dominated the week.
- OSCP has no activity this week.
- Physiotherapy missed target.
- Quality time not logged this week.
- Too many active modules.
- No rest day logged.

Validation:

- Recommendations are generated from ledger data.
- Recommendations are understandable and actionable.
- Dismissing a recommendation hides it.

### Milestone 6: Raspberry Pi Kiosk Deployment

Goal:

- Run Atlas reliably on the target device.

Deliverables:

- Docker Compose production profile.
- Persistent SQLite volume.
- Nginx or frontend static serving.
- Raspberry Pi setup guide.
- Browser kiosk systemd service.
- Backup script.

Validation:

- Raspberry Pi boots into Atlas dashboard.
- Backend restarts automatically.
- Database persists across restarts.
- Basic backup can be created.

## 11. Raspberry Pi Deployment Plan

### Target Runtime

- Raspberry Pi 5.
- Raspberry Pi OS 64-bit.
- Docker Engine.
- Docker Compose plugin.
- Chromium kiosk mode.
- Local network only.

### Compose Services

Recommended services:

```text
atlas-backend
  FastAPI app
  Port: 8000 internal
  Volume: atlas_data:/data

atlas-frontend
  Static frontend served by Nginx
  Port: 80
  Calls backend at /api

atlas-backup
  Optional cron-style backup helper
```

For MVP, use Nginx as the single exposed service:

- `/` serves frontend.
- `/api/` proxies to backend.

### Storage

Persistent paths:

```text
/opt/atlas/data/atlas.sqlite
/opt/atlas/backups/
/opt/atlas/logs/
```

SQLite backup approach:

- Use SQLite online backup command or copy during low activity.
- Keep daily backups for 14 days.
- Keep weekly backups for 8 weeks.
- Store backups locally first.
- Later add sync to external drive or private cloud.

### Environment Variables

Backend:

```text
ATLAS_ENV=production
ATLAS_DATABASE_URL=sqlite:////data/atlas.sqlite
ATLAS_TIMEZONE=Asia/Jerusalem
ATLAS_CORS_ORIGINS=http://localhost,http://atlas.local
```

Frontend:

```text
VITE_API_BASE_URL=/api/v1
VITE_DEFAULT_LOCALE=he
VITE_DEFAULT_DIRECTION=rtl
```

### Kiosk Mode

Use a systemd service to launch Chromium:

```text
chromium-browser \
  --kiosk \
  --disable-infobars \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  http://localhost
```

The setup should:

- Auto-login to desktop.
- Start Docker Compose on boot.
- Wait for frontend health before opening Chromium.
- Restart Chromium if it exits.
- Disable screen sleep if desired.

### Operational Concerns

Raspberry Pi constraints:

- Avoid heavy polling.
- Keep frontend bundle small.
- Avoid unnecessary background workers.
- Avoid large chart libraries unless needed.
- Keep logs rotated.
- Keep database queries indexed.

Monitoring MVP:

- Health endpoint.
- Simple logs.
- Dashboard backend unavailable state.
- Optional uptime indicator in UI.

Security MVP:

- Bind to local network only.
- No public exposure by default.
- Optional local PIN later.
- Keep Docker images updated manually.
- Back up the SQLite database.

## 12. Future Migration Path to Microservices

Atlas V1 should not be built as microservices, but the modular monolith should leave a clean extraction path.

### What Must Stay Modular Now

To make future migration possible:

- Keep module routes separated.
- Keep module services separated.
- Keep module-specific tables separated.
- Avoid cross-module direct repository calls.
- Use internal service interfaces.
- Keep dashboard aggregation explicit.
- Keep recommendation rules isolated.

### Possible Future Service Boundaries

Only split services if there is real pressure, such as multiple users, remote access, heavy automation, or independent scaling needs.

Potential future services:

- Core service: disciplines, modules, activity ledger.
- Analytics service: aggregation, trends, balance.
- AI Coach service: LLM-based planning and recommendations.
- Integration service: calendar, GitHub, fitness APIs, finance imports.
- Notification service: reminders, alerts, summaries.

### Migration Sequence

Recommended sequence if needed:

1. Keep the modular monolith and introduce clear internal interfaces.
2. Add integration tests around module boundaries.
3. Move long-running jobs to a background worker inside the same deployment.
4. Introduce an internal event table or outbox pattern.
5. Extract one low-risk module with clear data ownership.
6. Replace direct function calls with HTTP or message-based contracts only at extraction time.
7. Move from SQLite to PostgreSQL before serious multi-service deployment.

### Database Migration Path

SQLite MVP:

- Best for local-first single-user deployment.
- Easy backup.
- Low operational burden.

PostgreSQL later:

- Use when multi-device, concurrent writes, remote access, or more complex analytics become important.

Preparation now:

- Use SQLAlchemy.
- Use Alembic.
- Use UUID text keys.
- Avoid SQLite-only behavior where practical.
- Keep JSON usage portable.
- Use repository abstractions.

### LLM-Based Chief of Staff Later

The MVP AI Coach is rule-based. Later it can become an LLM-powered Chief of Staff.

Future capabilities:

- Weekly review generation.
- Daily plan creation.
- Natural-language activity logging.
- Project summarization.
- Calendar conflict detection.
- Burnout and overload detection.
- Goal progress coaching.

Required foundation before LLM upgrade:

- Clean activity history.
- Reliable module metadata.
- Strong dashboard summaries.
- Recommendation feedback loop.
- Privacy-aware local data strategy.

## MVP Implementation Order

The practical implementation order should be:

1. Backend and frontend skeleton.
2. Core schema and migrations.
3. Discipline, module, activity, and metric APIs.
4. Quick-log workflow.
5. Dashboard aggregate endpoint.
6. Dashboard UI.
7. Habit and project module behavior.
8. Recovery and learning module behavior.
9. Rule-based AI Coach.
10. Raspberry Pi deployment.

The first usable version should prioritize daily logging and dashboard visibility over advanced analytics. If the user does not log activities consistently, the rest of the system has weak data. Quick-log and the dashboard are therefore the MVP center of gravity.
