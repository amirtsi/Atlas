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
