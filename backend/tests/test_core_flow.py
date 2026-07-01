import unittest

from fastapi.testclient import TestClient

# DB isolation is handled centrally in tests/conftest.py (per-test temp DB).
from app.main import app


class CoreFlowTest(unittest.TestCase):
    def test_project_items_drive_progress(self) -> None:
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            project_id = modules["parknet"]["id"]

            overview = client.get(f"/api/v1/project/{project_id}/overview")
            self.assertEqual(overview.status_code, 200)
            body = overview.json()
            # No fabricated seed content — a fresh project module starts empty.
            self.assertEqual(len(body["items"]), 0)
            before = body["summary"]
            self.assertIn("progress_percent", before)

            # A non-project module has no project board.
            self.assertEqual(client.get(f"/api/v1/project/{modules['gym']['id']}/overview").status_code, 422)

            created = client.post(
                f"/api/v1/project/{project_id}/items",
                json={"item_type": "task", "title": "Wire up integration tests"},
            )
            self.assertEqual(created.status_code, 201)
            self.assertEqual(created.json()["status"], "todo")
            item_id = created.json()["id"]

            # Completing work closes the item AND logs a real activity (the honest loop).
            completed = client.post(
                f"/api/v1/project/{project_id}/items/{item_id}/complete",
                json={"duration_minutes": 20},
            )
            self.assertEqual(completed.status_code, 200)
            self.assertEqual(completed.json()["status"], "done")
            activity_id = completed.json()["completed_activity_id"]
            self.assertIsNotNone(activity_id)

            module_activities = client.get(f"/api/v1/activities?module_id={project_id}").json()
            self.assertTrue(any(item["id"] == activity_id for item in module_activities))

            after = client.get(f"/api/v1/project/{project_id}/overview").json()["summary"]
            self.assertEqual(after["tasks_done"], before["tasks_done"] + 1)

            # Re-completing an already-done item is rejected.
            self.assertEqual(
                client.post(f"/api/v1/project/{project_id}/items/{item_id}/complete", json={}).status_code,
                409,
            )

    def test_activity_create_edit_delete(self) -> None:
        # The Journal/Timeline/Calendar CRUD relies on POST/PATCH/DELETE /activities.
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            gym = modules["gym"]

            created = client.post(
                "/api/v1/activities",
                json={
                    "title": "Morning run",
                    "activity_type": gym["type"],
                    "module_id": gym["id"],
                    "duration_minutes": 30,
                    "occurred_at": "2026-06-20T06:30:00+00:00",
                    "source": "manual",
                },
            )
            self.assertEqual(created.status_code, 201)
            activity = created.json()
            self.assertEqual(activity["duration_minutes"], 30)
            # module_id given without discipline_id → discipline inferred from the module.
            self.assertEqual(activity["discipline_id"], gym["discipline_id"])

            edited = client.patch(
                f"/api/v1/activities/{activity['id']}",
                json={"title": "Evening run", "duration_minutes": 45, "notes": "felt strong"},
            )
            self.assertEqual(edited.status_code, 200)
            self.assertEqual(edited.json()["title"], "Evening run")
            self.assertEqual(edited.json()["duration_minutes"], 45)
            self.assertEqual(edited.json()["notes"], "felt strong")

            deleted = client.delete(f"/api/v1/activities/{activity['id']}")
            self.assertEqual(deleted.status_code, 200)
            self.assertEqual(client.get(f"/api/v1/activities/{activity['id']}").status_code, 404)

    def test_naive_occurred_at_is_normalized_to_utc(self) -> None:
        # The write path stores tz-aware UTC; a naive client value is read as the
        # configured local timezone (Asia/Jerusalem, UTC+3) then converted.
        with TestClient(app) as client:
            gym = {item["slug"]: item for item in client.get("/api/v1/modules").json()}["gym"]
            created = client.post(
                "/api/v1/activities",
                json={
                    "title": "Naive timestamp run",
                    "activity_type": gym["type"],
                    "module_id": gym["id"],
                    "occurred_at": "2026-06-20T09:00:00",
                },
            )
            self.assertEqual(created.status_code, 201)
            self.assertEqual(created.json()["occurred_at"], "2026-06-20T06:00:00+00:00")
            client.delete(f"/api/v1/activities/{created.json()['id']}")

    def test_activity_module_reassignment_updates_discipline(self) -> None:
        # Moving an activity to another module must carry its discipline along
        # (Life Pulse / weekly balance group by discipline), and it can be unset.
        with TestClient(app) as client:
            mods = client.get("/api/v1/modules").json()
            first = mods[0]
            other = next(m for m in mods if m["discipline_id"] != first["discipline_id"])

            created = client.post(
                "/api/v1/activities",
                json={"title": "Mislabeled log", "activity_type": first["type"], "module_id": first["id"]},
            ).json()
            self.assertEqual(created["module_id"], first["id"])
            self.assertEqual(created["discipline_id"], first["discipline_id"])

            moved = client.patch(f"/api/v1/activities/{created['id']}", json={"module_id": other["id"]})
            self.assertEqual(moved.status_code, 200)
            self.assertEqual(moved.json()["module_id"], other["id"])
            self.assertEqual(moved.json()["discipline_id"], other["discipline_id"])

            # Reassigning to "general" (null) clears both module and discipline.
            cleared = client.patch(f"/api/v1/activities/{created['id']}", json={"module_id": None})
            self.assertIsNone(cleared.json()["module_id"])
            self.assertIsNone(cleared.json()["discipline_id"])

            client.delete(f"/api/v1/activities/{created['id']}")

    def test_module_create_edit_archive(self) -> None:
        # Mission Center CRUD: create, edit, pause/resume, archive.
        with TestClient(app) as client:
            discipline = client.get("/api/v1/disciplines").json()[0]
            created = client.post(
                "/api/v1/modules",
                json={
                    "name": "Test Mission",
                    "slug": "test-mission-xyz",
                    "type": "project",
                    "discipline_id": discipline["id"],
                    "priority": 2,
                },
            )
            self.assertEqual(created.status_code, 201)
            module_id = created.json()["id"]
            self.assertEqual(created.json()["status"], "active")

            edited = client.patch(f"/api/v1/modules/{module_id}", json={"name": "Renamed Mission", "priority": 1})
            self.assertEqual(edited.json()["name"], "Renamed Mission")
            self.assertEqual(edited.json()["priority"], 1)

            self.assertEqual(client.post(f"/api/v1/modules/{module_id}/pause").json()["status"], "paused")
            self.assertEqual(client.post(f"/api/v1/modules/{module_id}/resume").json()["status"], "active")

            archived = client.post(f"/api/v1/modules/{module_id}/archive")
            self.assertEqual(archived.json()["status"], "archived")
            self.assertIsNotNone(archived.json()["archived_at"])

            active_ids = [m["id"] for m in client.get("/api/v1/modules?status=active").json()]
            self.assertNotIn(module_id, active_ids)

    def test_learning_units_drive_progress(self) -> None:
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            learning_id = modules["oscp"]["id"]

            overview = client.get(f"/api/v1/learning/{learning_id}/overview")
            self.assertEqual(overview.status_code, 200)
            body = overview.json()
            # No fabricated seed content — a fresh learning module starts empty.
            self.assertEqual(len(body["units"]), 0)
            before = body["summary"]
            self.assertIn("learning_units_total", before)
            self.assertIn("study_minutes", before)

            # A non-learning module has no learning board.
            self.assertEqual(client.get(f"/api/v1/learning/{modules['parknet']['id']}/overview").status_code, 422)

            created = client.post(
                f"/api/v1/learning/{learning_id}/units",
                json={"unit_type": "machine", "title": "HTB: Bashed"},
            )
            self.assertEqual(created.status_code, 201)
            self.assertEqual(created.json()["status"], "not_started")
            unit_id = created.json()["id"]

            # Completing a unit logs real study time (the honest loop).
            completed = client.post(
                f"/api/v1/learning/{learning_id}/units/{unit_id}/complete",
                json={"duration_minutes": 45},
            )
            self.assertEqual(completed.status_code, 200)
            self.assertEqual(completed.json()["status"], "completed")
            self.assertIsNotNone(completed.json()["completed_activity_id"])

            after = client.get(f"/api/v1/learning/{learning_id}/overview").json()["summary"]
            self.assertEqual(after["learning_units_done"], before["learning_units_done"] + 1)
            self.assertEqual(after["study_minutes"], before["study_minutes"] + 45)

            self.assertEqual(
                client.post(f"/api/v1/learning/{learning_id}/units/{unit_id}/complete", json={}).status_code,
                409,
            )

    def test_wellbeing_sessions_record_metrics(self) -> None:
        with TestClient(app) as client:
            modules = {item["slug"]: item for item in client.get("/api/v1/modules").json()}
            recovery_id = modules["recovery"]["id"]

            overview = client.get(f"/api/v1/wellbeing/{recovery_id}/overview")
            self.assertEqual(overview.status_code, 200)
            self.assertEqual([definition["key"] for definition in overview.json()["metric_defs"]], ["pain", "mobility"])
            before_sessions = overview.json()["summary"]["sessions_week"]

            # A module that isn't a wellbeing type has no session log.
            self.assertEqual(client.get(f"/api/v1/wellbeing/{modules['parknet']['id']}/overview").status_code, 422)

            logged = client.post(
                f"/api/v1/wellbeing/{recovery_id}/session",
                json={"duration_minutes": 30, "values": {"pain": 4, "mobility": 6}},
            )
            self.assertEqual(logged.status_code, 201)
            self.assertCountEqual(logged.json()["metrics_recorded"], ["pain", "mobility"])

            after = client.get(f"/api/v1/wellbeing/{recovery_id}/overview").json()
            self.assertEqual(after["summary"]["sessions_week"], before_sessions + 1)
            self.assertEqual(after["summary"]["metrics"]["pain"]["latest"], 4)

            # The session created a real activity and real metric rows (not config).
            module_activities = client.get(f"/api/v1/activities?module_id={recovery_id}").json()
            self.assertTrue(any(item["module_id"] == recovery_id for item in module_activities))
            self.assertEqual(len(client.get(f"/api/v1/metrics?module_id={recovery_id}").json()), 2)

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
