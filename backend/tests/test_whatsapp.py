import unittest

from fastapi.testclient import TestClient

# DB isolation is handled centrally in tests/conftest.py (per-test temp DB).
from app.main import app

OWNER = "972546745182"


def _whatsapp_activity_count(client, module_id: str) -> int:
    activities = client.get(f"/api/v1/activities?module_id={module_id}").json()
    return sum(1 for item in activities if item["source"] == "whatsapp")


def _auto_reply_count(client, provider_id: str) -> int:
    messages = client.get(f"/api/v1/communication/messages?provider_id={provider_id}").json()
    return sum(1 for item in messages if item["direction"] == "outbound" and (item.get("metadata") or {}).get("auto_reply"))


def _make_provider(client, config: dict) -> dict:
    response = client.post(
        "/api/v1/communication/providers",
        json={"name": "Evolution Test", "type": "evolution", "channel": "whatsapp", "config": config},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _webhook_payload(sender: str, text: str, *, from_me: bool = False, key_id: str = "msg-1") -> dict:
    return {
        "event": "messages.upsert",
        "data": {
            "key": {"id": key_id, "remoteJid": f"{sender}@s.whatsapp.net", "fromMe": from_me},
            "message": {"conversation": text},
        },
    }


class WhatsAppTwoWayTest(unittest.TestCase):
    def test_owner_message_logs_activity_and_replies(self) -> None:
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            before_activities = _whatsapp_activity_count(client, recovery_id)
            before_replies = _auto_reply_count(client, provider["id"])

            webhook = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות"),
            )
            self.assertEqual(webhook.status_code, 202)
            classification = webhook.json()["classification"]
            self.assertIsNotNone(classification)
            self.assertTrue(classification["matched"])
            self.assertEqual(classification["module_id"], recovery_id)
            self.assertIsNotNone(classification["activity_id"])

            # A real recovery activity was logged from the message (the honest loop).
            self.assertEqual(_whatsapp_activity_count(client, recovery_id), before_activities + 1)
            logged = next(
                item
                for item in client.get(f"/api/v1/activities?module_id={recovery_id}").json()
                if item["id"] == classification["activity_id"]
            )
            self.assertEqual(logged["source"], "whatsapp")
            self.assertEqual(logged["duration_minutes"], 30)

            # A confirmation reply was sent (dry-run) and stored.
            self.assertEqual(_auto_reply_count(client, provider["id"]), before_replies + 1)

    def test_note_to_self_message_logs_activity(self) -> None:
        # "Note to Self" setup: the owner texts their own number, so the message
        # arrives as a fromMe self-message. It must still be classified and logged.
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            before_activities = _whatsapp_activity_count(client, recovery_id)
            before_replies = _auto_reply_count(client, provider["id"])

            webhook = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות", from_me=True, key_id="n2s-1"),
            )
            self.assertEqual(webhook.status_code, 202)
            classification = webhook.json()["classification"]
            self.assertIsNotNone(classification)
            self.assertTrue(classification["matched"])
            self.assertEqual(classification["module_id"], recovery_id)
            self.assertIsNotNone(classification["activity_id"])

            self.assertEqual(_whatsapp_activity_count(client, recovery_id), before_activities + 1)
            self.assertEqual(_auto_reply_count(client, provider["id"]), before_replies + 1)

    def test_atlas_own_reply_does_not_loop(self) -> None:
        # Atlas's own ✅ reply bounces back as a fromMe self-message in the
        # "Note to Self" setup. The loop guard must skip it: no activity, no reply.
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            before_activities = _whatsapp_activity_count(client, recovery_id)
            before_replies = _auto_reply_count(client, provider["id"])

            echo = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(
                    OWNER, "✅ נרשם בהתאוששות (30 דק׳). אטלס עדכן את היומן.", from_me=True, key_id="echo-1"
                ),
            )
            self.assertEqual(echo.status_code, 202)
            self.assertIsNone(echo.json()["classification"])
            self.assertEqual(_whatsapp_activity_count(client, recovery_id), before_activities)
            self.assertEqual(_auto_reply_count(client, provider["id"]), before_replies)

    def test_redelivered_message_is_processed_once(self) -> None:
        # Evolution can re-deliver the same MESSAGES_UPSERT. The second delivery
        # (same provider message id) must be a no-op — log the activity only once.
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            before_activities = _whatsapp_activity_count(client, recovery_id)
            payload = _webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות", key_id="dup-1")
            url = f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution"

            first = client.post(url, json=payload)
            self.assertTrue(first.json()["classification"]["matched"])

            second = client.post(url, json=payload)
            self.assertEqual(second.status_code, 202)
            self.assertIsNone(second.json()["classification"])

            self.assertEqual(_whatsapp_activity_count(client, recovery_id), before_activities + 1)

    def test_ambiguous_message_creates_nothing_and_asks(self) -> None:
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            before_activities = _whatsapp_activity_count(client, recovery_id)
            before_replies = _auto_reply_count(client, provider["id"])

            webhook = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "סיימתי"),
            )
            self.assertEqual(webhook.status_code, 202)
            classification = webhook.json()["classification"]
            self.assertIsNotNone(classification)
            self.assertFalse(classification["matched"])
            self.assertIsNone(classification["activity_id"])

            # Nothing fabricated: no activity created, but a clarification reply was sent.
            self.assertEqual(_whatsapp_activity_count(client, recovery_id), before_activities)
            self.assertEqual(_auto_reply_count(client, provider["id"]), before_replies + 1)

    def test_webhook_secret_is_enforced(self) -> None:
        with TestClient(app) as client:
            provider = _make_provider(
                client, {"dry_run": True, "instance": "atlas", "webhook_secret": "s3cret"}
            )

            missing = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות"),
            )
            self.assertEqual(missing.status_code, 401)

            wrong = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution?token=nope",
                json=_webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות"),
            )
            self.assertEqual(wrong.status_code, 401)

            ok = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution?token=s3cret",
                json=_webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות"),
            )
            self.assertEqual(ok.status_code, 202)
            self.assertTrue(ok.json()["classification"]["matched"])

            # The header form is accepted too.
            via_header = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות"),
                headers={"x-atlas-webhook-token": "s3cret"},
            )
            self.assertEqual(via_header.status_code, 202)

    def test_non_owner_sender_is_ignored(self) -> None:
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            before_activities = _whatsapp_activity_count(client, recovery_id)
            before_replies = _auto_reply_count(client, provider["id"])

            webhook = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload("972500000000", "עשיתי פיזיותרפיה 30 דקות"),
            )
            self.assertEqual(webhook.status_code, 202)
            # Stored for audit, but never classified, logged, or replied to.
            self.assertIsNotNone(webhook.json()["message_id"])
            self.assertIsNone(webhook.json()["classification"])
            self.assertEqual(_whatsapp_activity_count(client, recovery_id), before_activities)
            self.assertEqual(_auto_reply_count(client, provider["id"]), before_replies)

    def test_scheduled_brief_dispatches_once_per_day(self) -> None:
        # The in-app scheduler reuses the same compose+send path and is idempotent:
        # one brief per provider per day, even if the dispatch runs twice.
        from app.modules.communication.scheduler import dispatch_due_briefs

        with TestClient(app) as client:
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})
            pid = provider["id"]

            def brief_count() -> int:
                msgs = client.get(f"/api/v1/communication/messages?provider_id={pid}").json()
                return sum(1 for m in msgs if (m.get("content_text") or "").startswith("☀️"))

            self.assertEqual(brief_count(), 0)
            first = [r for r in dispatch_due_briefs() if r["provider_id"] == pid]
            self.assertEqual(first[0]["status"], "sent")
            self.assertEqual(brief_count(), 1)

            # Second run on the same day must be a no-op for this provider.
            second = [r for r in dispatch_due_briefs() if r["provider_id"] == pid]
            self.assertEqual(second[0]["status"], "skipped_already_sent")
            self.assertEqual(brief_count(), 1)

    def test_brief_schedule_endpoint_reports_next_run(self) -> None:
        with TestClient(app) as client:
            body = client.get("/api/v1/communication/daily-brief/schedule").json()
            self.assertTrue(body["enabled"])
            self.assertIsNotNone(body["next_run"])
            self.assertIn("אטלס", body["preview"])

    def test_daily_brief_sends_from_real_signals(self) -> None:
        with TestClient(app) as client:
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            response = client.post(f"/api/v1/communication/providers/{provider['id']}/daily-brief")
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["status"], "sent")
            self.assertEqual(body["recipient"], OWNER)
            self.assertIn("אטלס", body["preview"])

            messages = client.get(f"/api/v1/communication/messages?provider_id={provider['id']}").json()
            self.assertTrue(any(item["id"] == body["message_id"] for item in messages))


    def test_owner_question_gets_coach_reply_not_activity(self) -> None:
        # A question must NOT create an activity, but must get a reply (coach path).
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            before_activities = _whatsapp_activity_count(client, recovery_id)
            before_replies = _auto_reply_count(client, provider["id"])

            webhook = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "מה עשיתי השבוע?", key_id="q-1"),
            )
            self.assertEqual(webhook.status_code, 202)
            classification = webhook.json()["classification"]
            self.assertIsNotNone(classification)
            self.assertFalse(classification["matched"])
            self.assertIsNone(classification["activity_id"])
            self.assertTrue(classification["method"].startswith("coach:"))

            self.assertEqual(_whatsapp_activity_count(client, recovery_id), before_activities)
            self.assertEqual(_auto_reply_count(client, provider["id"]), before_replies + 1)

    def test_log_message_still_logs_after_coach_wiring(self) -> None:
        # Regression: a plain log statement still classifies + logs, not answered.
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})

            before_activities = _whatsapp_activity_count(client, recovery_id)

            webhook = client.post(
                f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution",
                json=_webhook_payload(OWNER, "עשיתי פיזיותרפיה 30 דקות", key_id="log-1"),
            )
            self.assertEqual(webhook.status_code, 202)
            classification = webhook.json()["classification"]
            self.assertTrue(classification["matched"])
            self.assertEqual(classification["module_id"], recovery_id)
            self.assertEqual(_whatsapp_activity_count(client, recovery_id), before_activities + 1)

    def test_bounced_coach_reply_does_not_loop(self) -> None:
        # A coach reply is arbitrary text (no ✅/☀️ prefix). In the "Note to Self"
        # setup it bounces back as a fromMe self-message; if the backup loop guard
        # only checks prefixes, the bounce gets re-processed (and can re-trigger an
        # LLM call). The content-match backup must skip it: no processing, no reply.
        with TestClient(app) as client:
            provider = _make_provider(client, {"dry_run": True, "instance": "atlas"})
            url = f"/api/v1/communication/providers/{provider['id']}/webhooks/evolution"

            question = client.post(url, json=_webhook_payload(OWNER, "מה עשיתי השבוע?", key_id="q-1"))
            self.assertTrue(question.json()["classification"]["method"].startswith("coach:"))

            messages = client.get(f"/api/v1/communication/messages?provider_id={provider['id']}").json()
            coach_reply = next(
                m for m in messages if m["direction"] == "outbound" and (m.get("metadata") or {}).get("auto_reply")
            )
            replies_before = _auto_reply_count(client, provider["id"])

            # That exact reply bounces back as a fromMe self-message with a fresh id.
            bounce = client.post(
                url,
                json=_webhook_payload(OWNER, coach_reply["content_text"], from_me=True, key_id="bounce-1"),
            )
            self.assertEqual(bounce.status_code, 202)
            self.assertIsNone(bounce.json()["classification"])  # skipped, never processed
            self.assertEqual(_auto_reply_count(client, provider["id"]), replies_before)  # no new reply


if __name__ == "__main__":
    unittest.main()
