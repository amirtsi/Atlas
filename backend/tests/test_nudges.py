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
