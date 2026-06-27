# Atlas MVP Implementation Plan

This document narrows the Atlas product brief into a strict first implementation plan. The goal is to build the smallest useful version of Atlas without losing the modular monolith architecture.

Product and UI decisions should follow the philosophy in `docs/atlas-design-philosophy.md` before adding implementation complexity.

V1 should prove the daily workflow:

- Open dashboard.
- See today, recent activity, active modules, weekly balance, and simple recommendations.
- Log real activity in under 10 seconds.
- Track only three real module behaviors: Project, Habit, and Learning.

Everything else should remain a placeholder module type until the core loop is working.

## 1. MVP Scope Final

### Product Scope

Atlas V1 is a local-first personal life dashboard for one user, running as a modular monolith with one backend, one frontend, and one SQLite database.

The MVP is centered on the Activity Ledger and Quick Log. If activity logging is not fast and reliable, the dashboard and recommendations will not have useful data.

### Core Data Model

Build only these shared entities first:

- `Discipline`
- `LifeModule`
- `Activity`
- `Metric`
- `ActivityTemplate`

These entities are the foundation for every module type.

### Dashboard Scope

The first dashboard must include:

- Today focus
- Recent activities
- Active modules
- Weekly balance
- Simple recommendations

The dashboard should use one aggregate API endpoint for the initial view.

### Quick Log Scope

Quick Log is the most important MVP feature.

Required behavior:

- User can log from a template in 1-2 taps.
- User can repeat a recent activity.
- User can adjust duration quickly.
- User can optionally add notes.
- Common logging flow must take under 10 seconds.
- New activity appears immediately in recent activities and weekly balance.

### Real Module Behaviors in MVP

Only these module types get real behavior in V1:

1. Project
2. Habit
3. Learning

Other module types can exist as selectable types, but they should not have dedicated workflows yet.

### Project Module MVP

Do not build full project management.

Support only:

- Tasks
- Bugs
- Features
- Simple status
- Progress percent

Project item statuses:

- `todo`
- `in_progress`
- `done`

Project item types:

- `task`
- `bug`
- `feature`

Progress percent can be calculated as:

```text
done project items / total project items * 100
```

### Habit Module MVP

Support only:

- Weekly target
- Completions
- Streak

Habit progress can be calculated as:

```text
completions this week / weekly target
```

Streak should be simple:

- Count consecutive days or weeks with at least one completion, depending on the habit frequency.
- For the first MVP, weekly streak is enough.

### Learning Module MVP

Support only:

- Study sessions
- Learning units
- Progress

Learning unit statuses:

- `not_started`
- `in_progress`
- `done`

Learning progress can be calculated as:

```text
done learning units / total learning units * 100
```

Study sessions should be normal activities with learning-specific details attached.

### Placeholder Module Types

These module types should exist only as placeholders in V1:

- Recovery
- Relationship
- Finance
- Calendar
- AI Coach

Placeholder behavior:

- Can create a `LifeModule` with this type.
- Can log generic activities against it.
- Can appear in active modules and weekly balance.
- Has no dedicated detail workflow.
- Shows a simple placeholder detail screen.

### Architecture Scope

Use a modular monolith, but keep it practical.

Do:

- Separate backend folders by module.
- Keep shared core models separate from module-specific models.
- Use service functions for module-specific behavior.
- Keep one database.
- Keep one API process.

Do not:

- Build a plugin engine.
- Build an event bus.
- Build background jobs unless needed.
- Build complex generic metadata systems.
- Build microservice-style network boundaries.
- Build full RBAC or multi-user auth.

## 2. What To Postpone

Postpone these until after the first usable version:

- Recovery-specific physiotherapy workflow.
- Relationship-specific quality time workflow.
- Finance tracking.
- Calendar sync or calendar planning.
- LLM-based AI Coach.
- Real AI agent behavior.
- Microservices.
- Multi-user accounts.
- Mobile app.
- Notifications.
- External integrations.
- WhatsApp activity logging integration.
- Full project roadmap and releases.
- Complex analytics.
- Advanced charting.
- Custom dashboard layout editor.
- Complex recurrence rules.
- Full-text search.
- File uploads.
- Data import/export UI.
- PostgreSQL migration.
- Cloud deployment.
- Public access.
- OAuth.
- Role-based permissions.
- Advanced backup automation.

Simple recommendations are still in scope, but only as deterministic rules based on local data.

Example MVP recommendation rules:

- "No learning activity logged this week."
- "Habit target is behind schedule."
- "Project work dominated this week."
- "No activity logged today."
- "Too many active modules marked high priority."

## 2.1 MVP+ WhatsApp Activity Logging

WhatsApp should be supported after the first usable version as an optional activity logging channel.

This is not a WhatsApp management feature. Atlas should not try to become a messaging client, inbox, CRM, or notification hub.

The goal is simple:

```text
Let the user log completed real-life activity without opening Atlas.
```

### User Experience

The user sends a short WhatsApp message to Atlas.

Examples:

```text
Finished physiotherapy
```

Creates a Recovery activity.

```text
Fixed the Parking Flow bug
```

Creates a ParkNet project activity.

```text
Studied OSCP for 45 minutes
```

Creates a Learning activity with `duration_minutes = 45`.

```text
Went to the gym
```

Creates a Fitness activity.

Atlas should usually respond with only a short confirmation:

```text
Logged: OSCP study · 45 minutes
```

If confidence is low, Atlas should ask one short clarification question:

```text
Log this under Recovery or Fitness?
```

Never send long explanations back to WhatsApp.

### Architecture Position

WhatsApp logging belongs outside core MVP and after these pieces exist:

- Discipline model.
- LifeModule model.
- Activity model.
- ActivityTemplate model.
- Quick Log backend.
- Module lookup.
- Basic activity creation flow.

It should be implemented as an integration adapter around the Activity Ledger, not as a separate domain.

Recommended internal flow:

```text
WhatsApp Provider Webhook
  -> Integration verification
  -> Incoming message normalization
  -> LLM classification
  -> Confidence check
  -> Activity creation
  -> Short confirmation reply
```

### Selected Provider: Evolution API

Use [`evolution-foundation/evolution-api`](https://github.com/evolution-foundation/evolution-api) for the MVP+ WhatsApp integration.

Reason:

- It provides a practical WhatsApp API layer suitable for a self-hosted Atlas setup.
- It fits the Raspberry Pi / local-first direction better than making Atlas depend on a SaaS messaging provider first.
- It lets Atlas treat WhatsApp as an input channel without becoming a WhatsApp client.

Evolution API should run as a separate infrastructure dependency beside Atlas:

```text
Raspberry Pi / local network
  atlas-backend
  atlas-frontend
  atlas-db
  evolution-api
```

Atlas should not import Evolution API internals. Atlas should call Evolution API over HTTP and receive webhooks from it.

### Provider Boundary

Even though Evolution API is the selected MVP+ provider, keep a provider adapter boundary so Atlas does not leak Evolution-specific payloads into the Activity Ledger.

Internal interface:

```text
MessagingProvider
  provider_name = "evolution_api"
  verify_webhook(request)
  parse_incoming_message(request) -> IncomingMessage
  send_message(to, body)
```

Do not let provider-specific payloads leak into the Activity Ledger.

Normalized inbound message shape:

```json
{
  "provider": "evolution_api",
  "provider_message_id": "string",
  "from": "hashed_or_allowed_number",
  "body": "Studied OSCP for 45 minutes",
  "received_at": "2026-06-26T19:30:00Z"
}
```

Evolution-specific concerns should stay in:

```text
backend/app/modules/integrations/whatsapp/evolution_api/
```

Suggested files:

```text
router.py
service.py
provider.py
schemas.py
classifier.py
repository.py
models.py
```

### LLM Classification Contract

The LLM should convert the user's message into a structured logging intent.

Input:

- Raw message text.
- Known disciplines.
- Known modules.
- Recent activity templates.
- User timezone.

Output:

```json
{
  "intent": "log_activity",
  "confidence": 0.91,
  "discipline_slug": "learning",
  "module_slug": "oscp",
  "activity_type": "study",
  "title": "Studied OSCP",
  "duration_minutes": 45,
  "occurred_at": "now",
  "notes": null,
  "needs_confirmation": false,
  "clarification_question": null
}
```

Rules:

- The LLM must return structured JSON only.
- The backend validates the JSON before creating anything.
- The backend maps slugs to real `Discipline` and `LifeModule` records.
- If confidence is below threshold, ask a clarification instead of guessing.
- If the message is not a logging request, ignore or respond minimally.

Suggested thresholds:

- `confidence >= 0.80`: create activity automatically.
- `0.55 <= confidence < 0.80`: ask a clarification question.
- `confidence < 0.55`: do not log.

### Safety And Control

MVP+ should remain single-user.

Requirements:

- Only accept messages from allowlisted phone numbers.
- Verify provider webhook signatures.
- Store raw inbound payloads only if needed for debugging, and prefer short retention.
- Never expose Atlas data over WhatsApp beyond short confirmations.
- Never send dashboard summaries unless explicitly implemented later.
- Avoid long LLM conversations.

### API Shape

Recommended endpoints:

```text
GET  /api/v1/integrations/whatsapp/webhook
POST /api/v1/integrations/whatsapp/webhook
GET  /api/v1/integrations/whatsapp/status
POST /api/v1/integrations/whatsapp/test-classify
```

The webhook endpoint receives Evolution API messages. The test-classify endpoint is for local development only and should not be exposed publicly on the Raspberry Pi.

Recommended config:

```text
ATLAS_WHATSAPP_PROVIDER=evolution_api
ATLAS_WHATSAPP_ALLOWED_NUMBERS=...
ATLAS_EVOLUTION_API_BASE_URL=http://evolution-api:8080
ATLAS_EVOLUTION_API_KEY=...
ATLAS_EVOLUTION_INSTANCE=atlas
ATLAS_EVOLUTION_WEBHOOK_SECRET=...
```

### Data Storage

Add an integration log table only when implementing this feature:

```text
integration_messages
  id
  provider                  -- evolution_api
  provider_message_id
  direction
  from_number_hash
  body
  classification_json
  activity_id
  status
  error
  received_at
  processed_at
```

For MVP+, storing the full phone number is not necessary. A hash is enough for audit and duplicate detection.

### Acceptance Criteria

- User can send "Studied OSCP for 45 minutes" and Atlas creates a Learning activity under OSCP.
- User can send "Fixed the Parking Flow bug" and Atlas creates a ParkNet activity.
- User can send "Went to the gym" and Atlas creates a Fitness activity.
- User can send "Finished physiotherapy" and Atlas creates a Recovery activity, even if Recovery is still a placeholder module.
- Atlas replies with one short confirmation after successful logging.
- Atlas asks at most one clarification question when classification confidence is low.
- Unknown senders are rejected.
- Duplicate provider messages do not create duplicate activities.
- Activity appears in Life Timeline and Activity Ledger.

### MVP+ Tickets

These tickets should come after the first usable local version:

1. Add integration settings and allowlisted phone number config.
2. Add `integration_messages` migration.
3. Add Evolution API service to Docker Compose.
4. Implement `MessagingProvider` interface.
5. Implement Evolution API adapter.
6. Implement webhook verification for Evolution API.
7. Implement incoming message normalization.
8. Implement LLM structured classifier.
9. Implement confidence thresholds and clarification handling.
10. Connect classifier output to Activity Ledger creation.
11. Send short confirmation replies through Evolution API.
12. Add tests for common logging phrases and duplicate message handling.

## 3. First 20 Implementation Tickets

Each ticket should be small enough for a 1-3 hour implementation window.

### Ticket 1: Create Backend Skeleton

Build the FastAPI app structure with `main.py`, config, database session, and health endpoint.

Acceptance:

- `GET /health` returns `ok`.
- App starts locally with Uvicorn.

### Ticket 2: Create Frontend Skeleton

Build the Vite React TypeScript app with TailwindCSS and a basic app shell.

Acceptance:

- Frontend starts locally.
- One page renders a dark app shell.

### Ticket 3: Add Docker Compose Skeleton

Add backend and frontend services for local development.

Acceptance:

- `docker compose up` starts both services.
- Frontend can reach backend health endpoint.

### Ticket 4: Add Database and Migration Tooling

Configure SQLite, SQLAlchemy, and Alembic.

Acceptance:

- Backend can open SQLite database.
- Alembic can run an initial migration.

### Ticket 5: Implement First Core Migration

Create tables for disciplines, life modules, activities, metrics, and activity templates.

Acceptance:

- Migration applies cleanly.
- Tables and indexes exist.

### Ticket 6: Discipline API

Implement basic discipline CRUD.

Acceptance:

- Can create, list, read, update, and deactivate a discipline.
- Validation prevents duplicate slugs.

### Ticket 7: Life Module API

Implement basic module CRUD.

Acceptance:

- Can create, list, read, update, pause, resume, and archive modules.
- Module type validation allows both real and placeholder types.

### Ticket 8: Activity API

Implement basic activity create/list/read/update/delete.

Acceptance:

- Can log activity against a discipline and optional module.
- Activities list newest first.
- Filters work for module, discipline, and date range.

### Ticket 9: Activity Template API

Implement activity templates for quick logging.

Acceptance:

- Can create/list/update/delete templates.
- Templates can be tied to a module or discipline.

### Ticket 10: Quick Log Backend Endpoint

Implement `POST /api/v1/activities/quick-log`.

Acceptance:

- Can create an activity from a template.
- Can create an activity from minimal fields.
- Response returns the created activity.

### Ticket 11: Seed Initial Disciplines and Modules

Add a simple seed command or startup-safe seed script.

Acceptance:

- Initial disciplines include Work, Fitness, Learning, Recovery, Relationship, Finance.
- Initial modules can include ParkNet, Gym, and OSCP.
- Seeding is idempotent.

### Ticket 12: Dashboard Aggregate Endpoint

Implement `GET /api/v1/dashboard/today`.

Acceptance:

- Returns today focus placeholder.
- Returns recent activities.
- Returns active modules.
- Returns weekly balance.
- Returns simple recommendations.

### Ticket 13: Weekly Balance Calculation

Calculate activity totals by discipline for the current week.

Acceptance:

- Returns count and duration by discipline.
- Uses current timezone configuration.

### Ticket 14: Simple Recommendation Rules

Add deterministic recommendation generation inside dashboard service.

Acceptance:

- Returns 3-5 recommendation objects.
- Rules are based on activity/module data.
- No LLM integration exists.

### Ticket 15: Quick Log UI

Build the main quick-log dialog or screen.

Acceptance:

- Shows activity templates.
- Allows one-tap template logging.
- Allows duration adjustment.
- Allows optional notes.
- Updates dashboard data after logging.

### Ticket 16: Dashboard UI First Pass

Build the first dashboard screen.

Acceptance:

- Shows Today Focus, Recent Activities, Active Modules, Weekly Balance, and Recommendations.
- Uses one dashboard API call.
- Dark UI works at tablet size.

### Ticket 17: Project Module Backend MVP

Add project items with type, status, and progress calculation.

Acceptance:

- Can create/list/update project tasks, bugs, and features.
- Project overview returns progress percent.

### Ticket 18: Habit Module Backend MVP

Add habit settings and completions.

Acceptance:

- Can set weekly target.
- Can complete a habit.
- Habit overview returns weekly progress and streak.

### Ticket 19: Learning Module Backend MVP

Add learning units and study sessions.

Acceptance:

- Can create/list/update learning units.
- Can log study sessions.
- Learning overview returns progress percent and weekly study minutes.

### Ticket 20: Module Detail Screens MVP

Build simple detail screens for Project, Habit, Learning, and placeholders.

Acceptance:

- Project screen shows items and progress.
- Habit screen shows weekly target, completions, and streak.
- Learning screen shows units, sessions, and progress.
- Placeholder module types show generic module info and activity feed.

## 4. Recommended First Database Migration

The first migration should create only the shared core schema. Module-specific tables should come after the core dashboard and quick-log flow are working.

### Migration 001: Core Atlas Tables

Create:

- `disciplines`
- `life_modules`
- `activities`
- `metrics`
- `activity_templates`

Recommended SQL shape:

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

Recommended indexes:

```sql
CREATE INDEX idx_life_modules_discipline_id ON life_modules(discipline_id);
CREATE INDEX idx_life_modules_type ON life_modules(type);
CREATE INDEX idx_life_modules_status ON life_modules(status);

CREATE INDEX idx_activities_occurred_at ON activities(occurred_at);
CREATE INDEX idx_activities_module_id ON activities(module_id);
CREATE INDEX idx_activities_discipline_id ON activities(discipline_id);
CREATE INDEX idx_activities_activity_type ON activities(activity_type);

CREATE INDEX idx_metrics_key_recorded_at ON metrics(metric_key, recorded_at);
CREATE INDEX idx_metrics_module_id ON metrics(module_id);
CREATE INDEX idx_metrics_activity_id ON metrics(activity_id);

CREATE INDEX idx_activity_templates_module_id ON activity_templates(module_id);
CREATE INDEX idx_activity_templates_discipline_id ON activity_templates(discipline_id);
```

### Migration 002: Project MVP Tables

Create after core flow:

- `project_items`

Fields:

- `id`
- `module_id`
- `item_type`
- `title`
- `description`
- `status`
- `priority`
- `created_at`
- `updated_at`
- `completed_at`

### Migration 003: Habit MVP Tables

Create:

- `habit_settings`
- `habit_completions`

### Migration 004: Learning MVP Tables

Create:

- `learning_units`
- `learning_sessions`

## 5. Recommended First Frontend Screen

The first frontend screen should be the Dashboard with Quick Log always visible.

Do not start with settings, module admin, or a full module detail page. The first screen must prove the daily loop.

### First Screen Layout

Route:

```text
/
```

Primary sections:

- Header with date and Quick Log button.
- Today Focus.
- Recent Activities.
- Active Modules.
- Weekly Balance.
- Simple Recommendations.

### First Screen Behavior

On load:

- Fetch `GET /api/v1/dashboard/today`.
- Show skeleton states while loading.
- Show useful empty states if no data exists.
- Show backend unavailable state if request fails.

Quick Log:

- Button is always visible.
- Opens dialog or full-screen sheet.
- Shows top activity templates.
- Allows one-tap logging.
- Refetches dashboard on success.

### First Screen Design Constraints

- Dark UI.
- Touch-friendly.
- Works on 10-13 inch tablet.
- RTL-ready from first implementation.
- No marketing hero.
- No decorative landing page.
- No complex charts in first pass.

## 6. Design System

Atlas should feel like a personal Mission Control / Life OS dashboard. It should feel closer to a spaceship cockpit, Tesla control screen, Jarvis-style intelligence, Apple-level calm, Home Assistant clarity, and Linear-level cleanliness than to Jira, Notion, Monday, a todo app, a calendar, or a habit tracker.

The first visual milestone should be a static dashboard UI mock using static data. It should feel visually correct before the backend is complete.

### Design Principles

- Dark mode first.
- Dashboard first, forms second.
- Touchscreen friendly from the start.
- Hebrew RTL from day one.
- Quick Log must be reachable in one tap.
- Common activity logging must take under 10 seconds.
- The dashboard must be readable from 1-2 meters away.
- The dashboard should answer only one question: "What is the best thing I should do right now?"
- Every visible element should reduce cognitive load.
- Use large cards, progress rings, chips, timelines, and clear status indicators.
- Avoid dense admin tables on the dashboard.
- Use glassmorphism carefully: translucent cards, subtle borders, soft shadows, and restrained blur.
- Neon accents should feel premium and focused, not childish.
- Important information should be visible without scrolling on a 10-13 inch landscape Raspberry Pi touchscreen.
- Never use a human avatar for the AI. Use an abstract glowing AI core or holographic energy visual.

### Color Tokens

Use semantic tokens instead of hardcoded colors in components.

```text
--color-bg-app: #06080d;
--color-bg-surface: rgba(20, 25, 34, 0.72);
--color-bg-surface-strong: rgba(29, 35, 47, 0.86);
--color-bg-elevated: rgba(39, 48, 64, 0.78);

--color-border-subtle: rgba(255, 255, 255, 0.08);
--color-border-strong: rgba(122, 214, 255, 0.24);

--color-text-primary: #f4f7fb;
--color-text-secondary: #a8b3c7;
--color-text-muted: #6f7c91;

--color-accent-primary: #25d7ff;
--color-accent-primary-soft: rgba(37, 215, 255, 0.16);
--color-accent-secondary: #9b5cff;
--color-accent-secondary-soft: rgba(155, 92, 255, 0.16);

--color-health: #38e07b;
--color-health-soft: rgba(56, 224, 123, 0.16);
--color-warning: #ff9f2e;
--color-warning-soft: rgba(255, 159, 46, 0.16);
--color-critical: #ff4f63;
--color-critical-soft: rgba(255, 79, 99, 0.16);

--shadow-card: 0 18px 48px rgba(0, 0, 0, 0.34);
--shadow-glow-primary: 0 0 32px rgba(37, 215, 255, 0.14);
```

Color usage:

- Background: deep dark / near black.
- Cards: dark gray with translucent effect.
- Primary accent: electric blue or cyan.
- Secondary accent: purple.
- Health and recovery: green.
- Warnings and overload: orange.
- Critical state: red.

### Typography Scale

Typography should be large enough for a dashboard viewed from 1-2 meters.

```text
display-xl: 56px / 1.0 / 700
display-lg: 42px / 1.05 / 700
heading-lg: 28px / 1.15 / 700
heading-md: 22px / 1.2 / 650
body-lg: 18px / 1.45 / 500
body-md: 16px / 1.45 / 500
body-sm: 14px / 1.4 / 500
label: 12px / 1.2 / 700 / uppercase in English only
```

Rules:

- Today Focus may use display typography.
- Widget headings should stay compact.
- Buttons must use at least `body-md`.
- Secondary metadata should not drop below `body-sm`.
- Do not scale font size directly with viewport width.
- Letter spacing should be `0` for normal text.

### Card System

Cards are the main dashboard surface.

Panel types:

- `welcome-panel`: greeting, energy, today's identity, next event, and current best action.
- `life-pulse-panel`: centerpiece circular visualization of discipline balance.
- `mission-panel`: only the 3-5 most important modules right now.
- `timeline-panel`: chronological journal of completed real-life activities.
- `chief-panel`: one Chief of Staff recommendation with an abstract AI core.

Default card style:

```text
background: var(--color-bg-surface);
border: 1px solid var(--color-border-subtle);
border-radius: 22px;
box-shadow: var(--shadow-card);
backdrop-filter: blur(18px);
```

Interaction rules:

- Touch targets should be at least 48px high.
- Primary action buttons should be at least 56px high.
- Quick Log button should be visually dominant and always visible.
- Hover states are useful on desktop, but touch states matter more.
- Cards should not contain dense tables.
- Prefer status chips, progress rings, progress bars, and short timelines.

### Component List

Core layout:

- `AppShell`
- `DashboardGrid`
- `DashboardHeader`
- `DirectionProvider`
- `KioskStatusBar`

Dashboard widgets:

- `WelcomePanel`
- `LifePulse`
- `MissionCenter`
- `LifeTimeline`
- `ChiefOfStaff`
- `QuickLogButton`

Shared UI:

- `Panel`
- `StatusChip`
- `ProgressBar`
- `Timeline`
- `AICore`
- `DisciplineNode`
- `MissionCard`
- `LargeTouchButton`
- `EmptyState`
- `ErrorState`
- `SkeletonBlock`

Quick Log components:

- `ActivityTemplateGrid`
- `ActivityTemplateButton`
- `DurationStepper`
- `RecentActivityRepeat`
- `QuickNoteField`
- `QuickLogSuccessState`

### Dashboard Wireframe

Landscape-first layout for a 10-13 inch touchscreen:

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Header: Atlas | Core question                         Quick Log Button   │
├───────────────────────┬───────────────────────────────┬──────────────────┤
│ Chief of Staff        │ Life Pulse                    │ Welcome          │
│ One recommendation    │ Discipline balance            │ Energy / identity│
│ Abstract AI core      │ Centerpiece circular visual    │ Next event       │
├───────────────────────┼───────────────────────────────┼──────────────────┤
│ Life Timeline         │ Life Pulse continues           │ Mission Center   │
│ Real activities       │                               │ 3-5 modules only │
└───────────────────────┴───────────────────────────────┴──────────────────┘
```

RTL behavior:

- Navigation and primary scan direction should support RTL.
- Hebrew labels should align naturally to the right.
- Numeric metrics can remain LTR where clearer.
- Progress indicators should not become confusing when mirrored.

### First Screen Implementation Plan

Before implementing backend-driven features, create the first dashboard UI mock in React.

React mock requirements:

- Use static data only.
- No backend dependency.
- Use React + TypeScript + Vite.
- Keep static mock data in a separate file so it can later be replaced by API data.
- Dark glassmorphism dashboard.
- Landscape-first 10-13 inch layout.
- Hebrew RTL capable.
- Always-visible Quick Log button.
- Cockpit panels:
  - Welcome section.
  - Life Pulse centerpiece.
  - Mission Center.
  - Life Timeline.
  - Chief of Staff.
- Only one Chief of Staff recommendation at a time.
- No human avatar.

Acceptance for the static mock:

- The screen feels like Atlas Mission Control.
- The screen feels like a calm cockpit, not an admin dashboard.
- Main content is readable from 1-2 meters.
- Quick Log is visually dominant.
- Dashboard is not an admin table.
- The dashboard does not overload the user with competing recommendations or widgets.
- The UI is already the starting point for the first React implementation.

## 7. Acceptance Criteria For The First Usable Version

The first usable version is complete when the user can run Atlas locally and use it for a real day.

### Core Data

- User can create and view disciplines.
- User can create and view life modules.
- User can create project, habit, learning, and placeholder modules.
- User can log activities against modules.
- User can create and use activity templates.
- User can record simple metrics through activity metadata or metric entries.

### Quick Log

- User can log a common activity in under 10 seconds.
- User can log from a template in 1-2 taps.
- User can repeat or quickly recreate common actions.
- User can adjust duration.
- User can add optional notes.
- Logged activity appears immediately in recent activities.

### Dashboard

- Dashboard loads from one aggregate endpoint.
- Dashboard shows today's focus placeholder or selected focus.
- Dashboard shows recent activities.
- Dashboard shows active modules.
- Dashboard shows weekly balance by discipline.
- Dashboard shows simple recommendations.
- Empty states are understandable.
- Backend error state is visible.

### Project Module

- User can create project tasks, bugs, and features.
- User can move project items through `todo`, `in_progress`, and `done`.
- Project overview shows progress percent.
- Project activity contributes to weekly balance.

### Habit Module

- User can configure weekly target.
- User can mark completions.
- Habit overview shows completions this week.
- Habit overview shows streak.
- Habit activity contributes to weekly balance.

### Learning Module

- User can create learning units.
- User can mark units as not started, in progress, or done.
- User can log study sessions.
- Learning overview shows progress percent.
- Learning activity contributes to weekly balance.

### Placeholder Modules

- Recovery, Relationship, Finance, Calendar, and AI Coach can be created as modules.
- User can log generic activity against placeholder modules.
- Placeholder modules appear in dashboard active modules.
- Placeholder modules do not expose unfinished complex workflows.

### Deployment

- App runs locally with backend and frontend.
- App can run through Docker Compose.
- SQLite data persists across restarts.
- Health endpoint works.
- Frontend can recover from backend restart.

### Quality Bar

- No known broken primary flows.
- No implementation of postponed scope.
- Basic backend tests cover core create/list flows.
- Basic frontend smoke test or manual checklist covers dashboard and quick log.
- The implementation remains understandable and modular without a plugin system or microservice abstractions.

## Build Priority

Build order:

1. Core schema.
2. Core APIs.
3. Quick Log backend.
4. Dashboard aggregate endpoint.
5. Dashboard with Quick Log UI.
6. Seed data.
7. Project MVP.
8. Habit MVP.
9. Learning MVP.
10. Docker Compose and Raspberry Pi readiness.

The first milestone should not be considered successful until Quick Log feels fast. Atlas lives or dies by whether the user actually logs what happened.
