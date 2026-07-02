"""WhatsApp hub: status endpoint, QR endpoint, and the dialogue message scope."""

from fastapi.testclient import TestClient

from app.main import app

OWNER = "972546745182"  # settings.default_whatsapp_recipient


def _provider_id(client: TestClient) -> str:
    return client.get("/api/v1/communication/providers").json()[0]["id"]


def test_status_unconfigured_on_fresh_db():
    with TestClient(app) as client:
        status = client.get("/api/v1/communication/whatsapp/status").json()
    assert status["configured"] is True  # default dry-run provider is seeded
    assert status["bridge"] == "unconfigured"  # no base_url/api_key
    assert status["session"] is None
    assert "config" not in status  # provider config (with credentials) is never echoed


def test_status_bridge_down_when_evolution_unreachable():
    with TestClient(app) as client:
        pid = _provider_id(client)
        client.patch(
            f"/api/v1/communication/providers/{pid}",
            json={"config": {"dry_run": False, "base_url": "http://127.0.0.1:59999", "instance": "atlas", "api_key": "secret-key-xyz"}},
        )
        status = client.get("/api/v1/communication/whatsapp/status").json()
    assert status["bridge"] == "down"
    assert status["session"] is None
    assert "secret-key-xyz" not in str(status)  # credential value never leaks


def test_qr_reports_error_when_unconfigured():
    with TestClient(app) as client:
        result = client.post("/api/v1/communication/whatsapp/qr").json()
    assert result["qr_base64"] is None
    assert result["error"]


def test_messages_dialogue_scope_hides_unrelated_traffic():
    from app.core.database import db_connection, new_id
    from app.core.time import utc_now_iso

    with TestClient(app) as client:
        pid = _provider_id(client)
        now = utc_now_iso()
        with db_connection() as conn:
            for sender, recipient, text in [
                (OWNER, None, "ran 30 minutes"),          # owner -> Atlas (dialogue)
                (None, OWNER, "daily brief"),             # Atlas -> owner (dialogue)
                ("972501112223", None, "hey, dinner?"),   # stranger (private traffic)
            ]:
                conn.execute(
                    "INSERT INTO communication_messages (id, provider_id, direction, channel, recipient, sender,"
                    " content_text, status, metadata, created_at, updated_at)"
                    " VALUES (?, ?, ?, 'whatsapp', ?, ?, ?, 'received', '{}', ?, ?)",
                    (new_id(), pid, "inbound" if sender else "outbound", recipient, sender, text, now, now),
                )

        dialogue = client.get("/api/v1/communication/messages?scope=dialogue").json()
        everything = client.get("/api/v1/communication/messages").json()

    dialogue_texts = {m["content_text"] for m in dialogue}
    assert "ran 30 minutes" in dialogue_texts
    assert "daily brief" in dialogue_texts
    assert "hey, dinner?" not in dialogue_texts
    assert any(m["content_text"] == "hey, dinner?" for m in everything)
