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
