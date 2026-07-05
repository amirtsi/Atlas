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
