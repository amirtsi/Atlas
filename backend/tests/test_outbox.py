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


def _make_provider(client, config: dict) -> dict:
    response = client.post(
        "/api/v1/communication/providers",
        json={"name": "Evolution Test", "type": "evolution", "channel": "whatsapp", "config": config},
    )
    assert response.status_code == 201, response.text
    return response.json()


NOON = datetime(2026, 7, 5, 12, 0, tzinfo=TZ)
NIGHT = datetime(2026, 7, 5, 23, 0, tzinfo=TZ)


class DispatchPendingTest(unittest.TestCase):
    def test_sends_queued_rows_and_stores_messages(self) -> None:
        with TestClient(app) as client:
            # Deactivate seeded provider first: seeded + test provider share the same
            # created_at second, so ORDER BY created_at DESC would be a tie-break that
            # non-deterministically returns the seeded provider instead of the test one.
            with db_connection() as conn:
                conn.execute("UPDATE communication_providers SET is_active = 0")
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})
            with db_connection() as conn:
                row = outbox.enqueue(conn, kind="coach_message", body="שלום מהמאמן", created_by="hermes")
                results = outbox.dispatch_pending(conn, now_local=NOON)
                sent = conn.execute("SELECT * FROM outbox WHERE id = ?", (row["id"],)).fetchone()
            self.assertEqual(results, [{"outbox_id": row["id"], "status": "sent", "message_id": results[0]["message_id"]}])
            self.assertEqual(sent["status"], "sent")
            self.assertIsNotNone(sent["sent_at"])
            messages = client.get(f"/api/v1/communication/messages?provider_id={provider['id']}").json()
            self.assertTrue(any(m["content_text"] == "שלום מהמאמן" and m["direction"] == "outbound" for m in messages))

    def test_quiet_hours_hold_everything(self) -> None:
        with TestClient(app) as client:
            _make_provider(client, {"dry_run": True, "instance": "atlas"})
            with db_connection() as conn:
                outbox.enqueue(conn, kind="coach_message", body="late night", created_by="hermes")
                self.assertEqual(outbox.dispatch_pending(conn, now_local=NIGHT), [])
                held = conn.execute("SELECT status FROM outbox").fetchone()
            self.assertEqual(held["status"], "queued")

    def test_daily_cap_holds_excess_nudges_but_not_proposals(self) -> None:
        with TestClient(app) as client:
            _make_provider(client, {"dry_run": True, "instance": "atlas"})
            with db_connection() as conn:
                for i in range(4):  # nudge cap is 3
                    outbox.enqueue(conn, kind="nudge", body=f"nudge {i}")
                for i in range(4):  # proposals are uncapped
                    outbox.enqueue_proposal_ping(conn, {"id": f"{i}{i}{i}{i}{i}{i}-fake", "title": f"p{i}", "rationale": "", "created_by": "system"})
                results = outbox.dispatch_pending(conn, now_local=NOON)
            statuses = [r["status"] for r in results]
            self.assertEqual(statuses.count("held_daily_cap"), 1)
            self.assertEqual(statuses.count("sent"), 7)  # 3 nudges + 4 proposal pings

    def test_failed_send_schedules_retry_then_fails_after_max_attempts(self) -> None:
        with TestClient(app) as client:
            # Deactivate seeded provider (dry_run=True) first so the dry_run=False
            # test provider wins the _active_evolution_provider selection.
            with db_connection() as conn:
                conn.execute("UPDATE communication_providers SET is_active = 0")
            # dry_run=False with no base_url/instance/api_key -> deterministic failure, no network
            _make_provider(client, {"dry_run": False})
            with db_connection() as conn:
                row = outbox.enqueue(conn, kind="coach_message", body="will fail", created_by="hermes")
                first = outbox.dispatch_pending(conn, now_local=NOON)
                after_first = dict(conn.execute("SELECT * FROM outbox WHERE id = ?", (row["id"],)).fetchone())
                # not eligible again until next_attempt_at
                second = outbox.dispatch_pending(conn, now_local=NOON)
                # force eligibility at max attempts
                conn.execute(
                    "UPDATE outbox SET attempts = 4, next_attempt_at = '2020-01-01T00:00:00+00:00' WHERE id = ?",
                    (row["id"],),
                )
                third = outbox.dispatch_pending(conn, now_local=NOON)
                final = dict(conn.execute("SELECT * FROM outbox WHERE id = ?", (row["id"],)).fetchone())
            self.assertEqual(first[0]["status"], "retry_scheduled")
            self.assertEqual(after_first["status"], "queued")
            self.assertEqual(after_first["attempts"], 1)
            self.assertIsNotNone(after_first["next_attempt_at"])
            self.assertIsNotNone(after_first["last_error"])
            self.assertEqual(second, [])
            self.assertEqual(third[0]["status"], "failed")
            self.assertEqual(final["status"], "failed")
            self.assertEqual(final["attempts"], 5)

    def test_no_active_provider_leaves_rows_queued(self) -> None:
        with TestClient(app):
            with db_connection() as conn:
                conn.execute("UPDATE communication_providers SET is_active = 0")
                outbox.enqueue(conn, kind="coach_message", body="orphan", created_by="hermes")
                self.assertEqual(outbox.dispatch_pending(conn, now_local=NOON), [])
                row = conn.execute("SELECT status FROM outbox").fetchone()
            self.assertEqual(row["status"], "queued")
