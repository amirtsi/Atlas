import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from app.core.config import get_settings
from app.core.time import utc_now_iso

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS disciplines (
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

CREATE TABLE IF NOT EXISTS life_modules (
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

CREATE TABLE IF NOT EXISTS activities (
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

CREATE TABLE IF NOT EXISTS metrics (
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

CREATE TABLE IF NOT EXISTS activity_templates (
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

CREATE TABLE IF NOT EXISTS project_items (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 3,
  due_date TEXT,
  completed_at TEXT,
  completed_activity_id TEXT REFERENCES activities(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_units (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES life_modules(id),
  unit_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  completed_activity_id TEXT REFERENCES activities(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  changes TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL DEFAULT 'local_user',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS communication_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  channel TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS communication_messages (
  id TEXT PRIMARY KEY,
  provider_id TEXT REFERENCES communication_providers(id),
  direction TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT,
  sender TEXT,
  content_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider_message_id TEXT,
  error TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS communication_webhook_events (
  id TEXT PRIMARY KEY,
  provider_id TEXT REFERENCES communication_providers(id),
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  processed_status TEXT NOT NULL DEFAULT 'received',
  message_id TEXT REFERENCES communication_messages(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id TEXT PRIMARY KEY,
  rec_key TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rec_feedback_key ON recommendation_feedback(rec_key);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  module_id TEXT REFERENCES life_modules(id),
  discipline_id TEXT REFERENCES disciplines(id),
  title TEXT NOT NULL,
  definition_of_done TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  target_date TEXT,
  capacity_minutes_per_week INTEGER,
  active_plan_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  achieved_at TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'proposed',
  rationale TEXT,
  based_on_plan_id TEXT,
  source_proposal_id TEXT,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  superseded_at TEXT
);

CREATE TABLE IF NOT EXISTS plan_steps (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  goal_id TEXT NOT NULL REFERENCES goals(id),
  parent_id TEXT REFERENCES plan_steps(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  sequence INTEGER NOT NULL DEFAULT 0,
  depends_on TEXT NOT NULL DEFAULT '[]',
  completion_rule TEXT NOT NULL DEFAULT '{}',
  scheduled_for TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_step_links (
  step_id TEXT NOT NULL REFERENCES plan_steps(id),
  activity_id TEXT NOT NULL REFERENCES activities(id),
  PRIMARY KEY (step_id, activity_id)
);

CREATE INDEX IF NOT EXISTS idx_plans_goal_id ON plans(goal_id);
CREATE INDEX IF NOT EXISTS idx_plan_steps_plan_id ON plan_steps(plan_id);

CREATE INDEX IF NOT EXISTS idx_life_modules_discipline_id ON life_modules(discipline_id);
CREATE INDEX IF NOT EXISTS idx_life_modules_type ON life_modules(type);
CREATE INDEX IF NOT EXISTS idx_life_modules_status ON life_modules(status);

CREATE INDEX IF NOT EXISTS idx_activities_occurred_at ON activities(occurred_at);
CREATE INDEX IF NOT EXISTS idx_activities_module_id ON activities(module_id);
CREATE INDEX IF NOT EXISTS idx_activities_discipline_id ON activities(discipline_id);
CREATE INDEX IF NOT EXISTS idx_activities_activity_type ON activities(activity_type);

CREATE INDEX IF NOT EXISTS idx_metrics_key_recorded_at ON metrics(metric_key, recorded_at);
CREATE INDEX IF NOT EXISTS idx_metrics_module_id ON metrics(module_id);
CREATE INDEX IF NOT EXISTS idx_metrics_activity_id ON metrics(activity_id);

CREATE INDEX IF NOT EXISTS idx_activity_templates_module_id ON activity_templates(module_id);
CREATE INDEX IF NOT EXISTS idx_activity_templates_discipline_id ON activity_templates(discipline_id);

CREATE INDEX IF NOT EXISTS idx_project_items_module_id ON project_items(module_id);
CREATE INDEX IF NOT EXISTS idx_project_items_status ON project_items(status);

CREATE INDEX IF NOT EXISTS idx_learning_units_module_id ON learning_units(module_id);
CREATE INDEX IF NOT EXISTS idx_learning_units_status ON learning_units(status);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_communication_providers_type ON communication_providers(type);
CREATE INDEX IF NOT EXISTS idx_communication_messages_created_at ON communication_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_communication_messages_provider_id ON communication_messages(provider_id);
CREATE INDEX IF NOT EXISTS idx_communication_webhook_events_created_at ON communication_webhook_events(created_at);
"""


def _connect(path: Path | None = None) -> sqlite3.Connection:
    db_path = path or get_settings().resolved_database_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    # WAL lets readers and a writer coexist; busy_timeout makes a briefly-locked
    # DB wait-and-retry instead of raising "database is locked". Both matter as the
    # webhook, the scheduler, the UI (and soon the MCP/Hermes layer) write concurrently.
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


@contextmanager
def db_connection() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# --------------------------------------------------------------------------- #
# Schema versioning / migrations
#
# SCHEMA_SQL above is the idempotent baseline (all CREATE TABLE IF NOT EXISTS) and
# is safe to run on every startup. That covers NEW tables for free. But adding a
# column to (or otherwise ALTERing) an EXISTING table is NOT covered by IF NOT
# EXISTS — it would silently never apply to an already-created DB, which is
# dangerous for the honest-core data. So we track a schema version in the SQLite
# `PRAGMA user_version` and run ordered, one-time migrations for such changes.
#
# To evolve the schema:
#   * New table  -> add it to SCHEMA_SQL (IF NOT EXISTS). No migration needed.
#   * Alter/backfill an existing table -> bump SCHEMA_VERSION and add the SQL to
#     MIGRATIONS under the new version number (also reflect it in SCHEMA_SQL so
#     fresh DBs are born current).
# --------------------------------------------------------------------------- #
SCHEMA_VERSION = 1

# version -> SQL script applied exactly once when upgrading TO that version.
MIGRATIONS: dict[int, str] = {
    # 2: "ALTER TABLE activities ADD COLUMN plan_step_id TEXT;",
}


def _apply_migrations(conn: sqlite3.Connection) -> None:
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for version in range(current + 1, SCHEMA_VERSION + 1):
        script = MIGRATIONS.get(version)
        if script:
            conn.executescript(script)
    if current != SCHEMA_VERSION:
        # PRAGMA can't be parameterized; SCHEMA_VERSION is an int constant.
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def initialize_database() -> None:
    with db_connection() as conn:
        conn.executescript(SCHEMA_SQL)
        _apply_migrations(conn)
        seed_initial_data(conn)
        ensure_default_communication_provider(conn)
        backfill_audit_events(conn)


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    data = dict(row)
    for key in ("config", "metadata", "default_metadata", "classification_json", "changes", "payload", "depends_on", "completion_rule"):
        if key in data and isinstance(data[key], str):
            try:
                data[key] = json.loads(data[key])
            except json.JSONDecodeError:
                pass
    return data


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [row_to_dict(row) for row in rows if row is not None]


def new_id() -> str:
    return str(uuid4())


def seed_initial_data(conn: sqlite3.Connection) -> None:
    now = utc_now_iso()
    disciplines = [
        ("work", "Work", "#27d8ff", "briefcase", 1),
        ("fitness", "Fitness", "#3ee68a", "dumbbell", 2),
        ("learning", "Learning", "#9f67ff", "graduation-cap", 3),
        ("recovery", "Recovery", "#ffad3d", "activity", 4),
        ("relationship", "Relationship", "#ff5a73", "heart", 5),
        ("finance", "Finance", "#aeb8cc", "wallet", 6),
        ("personal-growth", "Personal Growth", "#27d8ff", "sparkles", 7),
    ]
    discipline_ids: dict[str, str] = {}
    for slug, name, color, icon, sort_order in disciplines:
        existing = conn.execute("SELECT id FROM disciplines WHERE slug = ?", (slug,)).fetchone()
        if existing:
            discipline_ids[slug] = existing["id"]
            continue
        discipline_id = new_id()
        discipline_ids[slug] = discipline_id
        conn.execute(
            """
            INSERT INTO disciplines (id, name, slug, color, icon, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (discipline_id, name, slug, color, icon, sort_order, now, now),
        )

    # Modules are the user's real life areas (scaffolding). They start empty —
    # progress comes from real records/activities the user logs, never from seeded numbers.
    modules = [
        ("parknet", "ParkNet", "project", "work", 1, {}),
        ("gym", "Gym", "habit", "fitness", 2, {"weekly_target": 3}),
        ("oscp", "OSCP", "learning", "learning", 1, {}),
        ("recovery", "Recovery", "recovery", "recovery", 2, {}),
        ("relationship", "Relationship", "relationship", "relationship", 3, {}),
    ]
    module_ids: dict[str, str] = {}
    for slug, name, module_type, discipline_slug, priority, config in modules:
        existing = conn.execute("SELECT id, config FROM life_modules WHERE slug = ?", (slug,)).fetchone()
        if existing:
            module_ids[slug] = existing["id"]
            try:
                existing_config = json.loads(existing["config"] or "{}")
            except json.JSONDecodeError:
                existing_config = {}
            if not existing_config and config:
                conn.execute(
                    "UPDATE life_modules SET config = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(config), now, existing["id"]),
                )
            continue
        module_id = new_id()
        module_ids[slug] = module_id
        conn.execute(
            """
            INSERT INTO life_modules
              (id, discipline_id, type, name, slug, status, priority, config, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
            """,
            (module_id, discipline_ids[discipline_slug], module_type, name, slug, priority, json.dumps(config), now, now),
        )

    templates = [
        ("fixed-parknet-bug", "Fixed ParkNet bug", "development", "work", "parknet", 30, 1),
        ("oscp-study", "OSCP study", "study", "learning", "oscp", 45, 2),
        ("gym-workout", "Gym workout", "workout", "fitness", "gym", 60, 3),
        ("physiotherapy", "Physiotherapy", "recovery", "recovery", "recovery", 30, 4),
    ]
    for slug, title, activity_type, discipline_slug, module_slug, duration, sort_order in templates:
        existing = conn.execute(
            "SELECT id FROM activity_templates WHERE json_extract(default_metadata, '$.slug') = ?",
            (slug,),
        ).fetchone()
        if existing:
            continue
        conn.execute(
            """
            INSERT INTO activity_templates
              (id, discipline_id, module_id, title, activity_type, default_duration_minutes,
               default_metadata, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id(),
                discipline_ids[discipline_slug],
                module_ids[module_slug],
                title,
                activity_type,
                duration,
                json.dumps({"slug": slug}),
                sort_order,
                now,
                now,
            ),
        )


def ensure_default_communication_provider(conn: sqlite3.Connection) -> None:
    settings = get_settings()
    now = utc_now_iso()
    default_recipient = settings.default_whatsapp_recipient
    existing_providers = conn.execute(
        "SELECT id, config FROM communication_providers WHERE type = 'evolution' AND channel = 'whatsapp'"
    ).fetchall()

    if not existing_providers:
        conn.execute(
            """
            INSERT INTO communication_providers
              (id, name, type, channel, config, is_active, created_at, updated_at)
            VALUES (?, 'Evolution Provider', 'evolution', 'whatsapp', ?, 1, ?, ?)
            """,
            (
                new_id(),
                json.dumps({"dry_run": True, "instance": "atlas", "default_recipient": default_recipient}),
                now,
                now,
            ),
        )
        return

    for provider in existing_providers:
        try:
            config = json.loads(provider["config"] or "{}")
        except json.JSONDecodeError:
            config = {}
        if config.get("default_recipient") == default_recipient:
            continue
        config["default_recipient"] = default_recipient
        conn.execute(
            "UPDATE communication_providers SET config = ?, updated_at = ? WHERE id = ?",
            (json.dumps(config), now, provider["id"]),
        )


def backfill_audit_events(conn: sqlite3.Connection) -> None:
    existing = conn.execute("SELECT COUNT(id) AS count FROM audit_events").fetchone()
    if existing["count"] > 0:
        return

    for module in conn.execute("SELECT id, name, type, created_at FROM life_modules ORDER BY created_at ASC").fetchall():
        conn.execute(
            """
            INSERT INTO audit_events
              (id, entity_type, entity_id, action, summary, changes, actor, created_at)
            VALUES (?, 'life_module', ?, 'imported', ?, ?, 'system', ?)
            """,
            (
                new_id(),
                module["id"],
                f"Imported existing module: {module['name']}",
                json.dumps({"name": module["name"], "type": module["type"]}),
                module["created_at"],
            ),
        )

    for activity in conn.execute("SELECT id, title, source, created_at FROM activities ORDER BY created_at ASC").fetchall():
        conn.execute(
            """
            INSERT INTO audit_events
              (id, entity_type, entity_id, action, summary, changes, actor, created_at)
            VALUES (?, 'activity', ?, 'imported', ?, ?, 'system', ?)
            """,
            (
                new_id(),
                activity["id"],
                f"Imported existing activity: {activity['title']}",
                json.dumps({"title": activity["title"], "source": activity["source"]}),
                activity["created_at"],
            ),
        )
