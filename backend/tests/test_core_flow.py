import os
import tempfile
import unittest
from pathlib import Path

os.environ["ATLAS_DATABASE_PATH"] = str(Path(tempfile.mkdtemp()) / "atlas-test.sqlite")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


class CoreFlowTest(unittest.TestCase):
    def test_seeded_quick_log_and_dashboard(self) -> None:
        with TestClient(app) as client:
            health = client.get("/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json()["status"], "ok")

            disciplines = client.get("/api/v1/disciplines")
            self.assertEqual(disciplines.status_code, 200)
            self.assertGreaterEqual(len(disciplines.json()), 7)

            modules = client.get("/api/v1/modules")
            self.assertEqual(modules.status_code, 200)
            self.assertGreaterEqual(len(modules.json()), 5)
            work_discipline = next(item for item in disciplines.json() if item["slug"] == "work")

            new_module = client.post(
                "/api/v1/modules",
                json={
                    "discipline_id": work_discipline["id"],
                    "type": "project",
                    "name": "Atlas Test Module",
                    "slug": "atlas-test-module",
                    "priority": 2,
                },
            )
            self.assertEqual(new_module.status_code, 201)
            self.assertEqual(new_module.json()["status"], "active")

            updated_module = client.patch(
                f"/api/v1/modules/{new_module.json()['id']}",
                json={"status": "paused", "priority": 4},
            )
            self.assertEqual(updated_module.status_code, 200)
            self.assertEqual(updated_module.json()["status"], "paused")
            self.assertEqual(updated_module.json()["priority"], 4)

            seeded_modules = {item["slug"]: item for item in modules.json()}
            project_behavior = client.get(f"/api/v1/modules/{seeded_modules['parknet']['id']}/behavior")
            self.assertEqual(project_behavior.status_code, 200)
            self.assertEqual(project_behavior.json()["type"], "project")
            self.assertIn("tasks_open", project_behavior.json()["summary"])

            habit_behavior = client.patch(
                f"/api/v1/modules/{seeded_modules['gym']['id']}/behavior",
                json={"config": {"weekly_target": 4}},
            )
            self.assertEqual(habit_behavior.status_code, 200)
            self.assertEqual(habit_behavior.json()["summary"]["weekly_target"], 4)

            learning_behavior = client.get(f"/api/v1/modules/{seeded_modules['oscp']['id']}/behavior")
            self.assertEqual(learning_behavior.status_code, 200)
            self.assertIn("study_minutes", learning_behavior.json()["summary"])

            templates = client.get("/api/v1/activity-templates")
            self.assertEqual(templates.status_code, 200)
            self.assertGreaterEqual(len(templates.json()), 4)

            quick_log = client.post(
                "/api/v1/activities/quick-log",
                json={"template_id": templates.json()[0]["id"]},
            )
            self.assertEqual(quick_log.status_code, 201)
            self.assertEqual(quick_log.json()["source"], "quick_log")

            journal = client.get("/api/v1/activities")
            self.assertEqual(journal.status_code, 200)
            self.assertGreaterEqual(len(journal.json()), 1)
            self.assertIn("module_name", journal.json()[0])
            self.assertIn("discipline_slug", journal.json()[0])

            first_module = modules.json()[0]
            custom_log = client.post(
                "/api/v1/activities/quick-log",
                json={
                    "module_id": first_module["id"],
                    "title": "Manual activity",
                    "activity_type": first_module["type"],
                    "duration_minutes": 25,
                },
            )
            self.assertEqual(custom_log.status_code, 201)
            self.assertEqual(custom_log.json()["source"], "quick_log")
            self.assertEqual(custom_log.json()["discipline_id"], first_module["discipline_id"])

            new_template = client.post(
                "/api/v1/activity-templates",
                json={
                    "module_id": first_module["id"],
                    "discipline_id": first_module["discipline_id"],
                    "title": "Code review",
                    "activity_type": "project",
                    "default_duration_minutes": 20,
                },
            )
            self.assertEqual(new_template.status_code, 201)
            self.assertEqual(new_template.json()["title"], "Code review")

            dashboard = client.get("/api/v1/dashboard/today")
            self.assertEqual(dashboard.status_code, 200)
            body = dashboard.json()
            self.assertIn("real_signals", body)
            self.assertGreaterEqual(body["real_signals"]["today_activity_count"], 1)
            self.assertEqual(len(body["recommendations"]), 1)
            self.assertEqual(body["recommendations"][0]["title"], "Complete Gym once today")
            self.assertGreaterEqual(len(body["active_modules"]), 1)
            self.assertIn("behavior", body["active_modules"][0])
            self.assertIn("summary", body["active_modules"][0]["behavior"])
            self.assertGreaterEqual(len(body["recent_activities"]), 1)

            audit = client.get("/api/v1/audit-events")
            self.assertEqual(audit.status_code, 200)
            self.assertGreaterEqual(len(audit.json()), 1)
            self.assertIn("summary", audit.json()[0])

            seeded_providers = client.get("/api/v1/communication/providers")
            self.assertEqual(seeded_providers.status_code, 200)
            self.assertGreaterEqual(len(seeded_providers.json()), 1)
            self.assertEqual(seeded_providers.json()[0]["config"]["default_recipient"], "972546745182")

            provider = client.post(
                "/api/v1/communication/providers",
                json={
                    "name": "Evolution Local",
                    "type": "evolution",
                    "channel": "whatsapp",
                    "config": {"dry_run": True, "instance": "atlas"},
                },
            )
            self.assertEqual(provider.status_code, 201)
            self.assertEqual(provider.json()["type"], "evolution")
            self.assertEqual(provider.json()["config"]["default_recipient"], "972546745182")

            message = client.post(
                "/api/v1/communication/messages",
                json={
                    "provider_id": provider.json()["id"],
                    "recipient": "0546745182",
                    "content_text": "Atlas test message",
                },
            )
            self.assertEqual(message.status_code, 201)
            self.assertEqual(message.json()["status"], "sent")
            self.assertEqual(message.json()["recipient"], "972546745182")

            webhook = client.post(
                f"/api/v1/communication/providers/{provider.json()['id']}/webhooks/evolution",
                json={
                    "event": "messages.upsert",
                    "data": {
                        "key": {"id": "remote-message-1", "remoteJid": "972500000000@s.whatsapp.net", "fromMe": False},
                        "message": {"conversation": "Finished physiotherapy"},
                    },
                },
            )
            self.assertEqual(webhook.status_code, 202)
            self.assertIsNotNone(webhook.json()["message_id"])


if __name__ == "__main__":
    unittest.main()
