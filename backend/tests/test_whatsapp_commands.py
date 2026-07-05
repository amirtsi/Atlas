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

    def test_bare_accept_verbs_return_none(self) -> None:
        # Bare accept is NOT a command — falls through to the classifier flow.
        for text in ("accept", "כן", "ok", "yes"):
            self.assertIsNone(parse_proposal_command(text), repr(text))

    def test_bare_dismiss_verbs_have_no_ref(self) -> None:
        # Bare dismiss is a command and acts on single pending / lists when multiple.
        for text in ("no", "לא", "dismiss"):
            self.assertEqual(parse_proposal_command(text), {"action": "dismiss", "ref": None}, text)

    def test_anchoring_rejects_ordinary_messages(self) -> None:
        for text in (
            "accept the offer from Dana",       # trailing words
            "I accept a1b2c3",                  # leading words
            "עשיתי פיזיותרפיה 30 דקות",          # normal activity log
            "accept 12",                        # ref too short (uuids, not ints)
            "nodead",                           # verb directly glued to hex — not a command
            "accepta1b2c3",                     # no separator between verb and ref
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
                reply = execute_proposal_command(conn, {"action": "dismiss", "ref": None})
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


OWNER = "972546745182"


def _webhook_payload(sender: str, text: str, *, key_id: str) -> dict:
    return {
        "event": "messages.upsert",
        "data": {
            "key": {"id": key_id, "remoteJid": f"{sender}@s.whatsapp.net", "fromMe": False},
            "message": {"conversation": text},
        },
    }


class WebhookCommandFlowTest(unittest.TestCase):
    def test_owner_accepts_proposal_via_whatsapp_reply(self) -> None:
        from app.modules.proposals.service import create_proposal

        with TestClient(app) as client:
            provider = client.post(
                "/api/v1/communication/providers",
                json={"name": "Evolution Test", "type": "evolution", "channel": "whatsapp",
                      "config": {"dry_run": True, "instance": "atlas"}},
            ).json()
            module = client.get("/api/v1/modules").json()[0]
            with db_connection() as conn:
                proposal = create_proposal(
                    conn, "set_module_status", f"Archive {module['name']}?", "stale",
                    {"module_id": module["id"], "status": "archived"},
                )
            response = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, f"accept {proposal['id'][:6]}", key_id="cmd-1"),
            )
            self.assertEqual(response.status_code, 202)
            classification = response.json()["classification"]
            self.assertEqual(classification["method"], "proposal_command")
            self.assertIsNone(classification["activity_id"])  # a command never logs an activity
            # the accept actually applied through the validated service
            self.assertEqual(client.get(f"/api/v1/modules/{module['id']}").json()["status"], "archived")
            with db_connection() as conn:
                status = conn.execute("SELECT status FROM proposals WHERE id = ?", (proposal["id"],)).fetchone()[0]
            self.assertEqual(status, "accepted")

    def test_non_command_message_still_reaches_classifier(self) -> None:
        with TestClient(app) as client:
            provider = client.post(
                "/api/v1/communication/providers",
                json={"name": "Evolution Test", "type": "evolution", "channel": "whatsapp",
                      "config": {"dry_run": True, "instance": "atlas"}},
            ).json()
            response = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות", key_id="cmd-2"),
            )
            classification = response.json()["classification"]
            self.assertNotEqual(classification["method"], "proposal_command")
            self.assertTrue(classification["matched"])  # the activity loop is untouched
