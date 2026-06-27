from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.core.database import db_connection, new_id, row_to_dict, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.communication.evolution import normalize_webhook_payload, normalize_whatsapp_number, send_text_message
from app.shared.audit import record_audit_event
from app.shared.schemas import CommunicationMessageCreate, CommunicationProviderCreate, CommunicationProviderUpdate
from app.shared.sql import apply_update, get_or_404, json_dump

router = APIRouter(prefix="/communication", tags=["communication"])

SUPPORTED_PROVIDERS = {"evolution"}


def _safe_provider(provider: dict) -> dict:
    config = dict(provider.get("config") or {})
    if "api_key" in config:
        config["api_key"] = "***"
    return {**provider, "config": config}


def _provider_config_with_defaults(config: dict) -> dict:
    next_config = dict(config)
    if "default_recipient" not in next_config:
        next_config["default_recipient"] = get_settings().default_whatsapp_recipient
    next_config["default_recipient"] = normalize_whatsapp_number(str(next_config["default_recipient"]))
    return next_config


@router.get("/providers")
def list_providers(include_inactive: bool = False) -> list[dict]:
    sql = "SELECT * FROM communication_providers"
    if not include_inactive:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY created_at DESC"
    with db_connection() as conn:
        return [_safe_provider(provider) for provider in rows_to_dicts(conn.execute(sql).fetchall())]


@router.post("/providers", status_code=201)
def create_provider(payload: CommunicationProviderCreate) -> dict:
    if payload.type not in SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=422, detail="Unsupported communication provider")

    now = utc_now_iso()
    provider_id = new_id()
    config = _provider_config_with_defaults(payload.config) if payload.type == "evolution" else payload.config
    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO communication_providers
              (id, name, type, channel, config, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (provider_id, payload.name, payload.type, payload.channel, json_dump(config), int(payload.is_active), now, now),
        )
        provider = get_or_404(conn, "communication_providers", provider_id)
        record_audit_event(
            conn,
            entity_type="communication_provider",
            entity_id=provider_id,
            action="created",
            summary=f"Created communication provider: {payload.name}",
            changes={"type": payload.type, "channel": payload.channel},
        )
        return _safe_provider(provider)


@router.patch("/providers/{provider_id}")
def update_provider(provider_id: str, payload: CommunicationProviderUpdate) -> dict:
    update_payload = payload.model_dump(exclude_unset=True)
    if isinstance(update_payload.get("config"), dict):
        update_payload["config"] = _provider_config_with_defaults(update_payload["config"])
    with db_connection() as conn:
        provider = apply_update(
            conn,
            "communication_providers",
            provider_id,
            update_payload,
            {"name", "config", "is_active"},
        )
        record_audit_event(
            conn,
            entity_type="communication_provider",
            entity_id=provider_id,
            action="updated",
            summary=f"Updated communication provider: {provider['name']}",
            changes=update_payload,
        )
        return _safe_provider(provider)


@router.get("/messages")
def list_messages(provider_id: str | None = None, limit: int = 100, offset: int = 0) -> list[dict]:
    where: list[str] = []
    params: list[object] = []
    if provider_id:
        where.append("provider_id = ?")
        params.append(provider_id)
    sql = "SELECT * FROM communication_messages"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("/messages", status_code=201)
def send_message(payload: CommunicationMessageCreate) -> dict:
    if payload.direction != "outbound":
        raise HTTPException(status_code=422, detail="Use provider webhooks for inbound messages")
    if not payload.recipient:
        raise HTTPException(status_code=422, detail="recipient is required for outbound messages")

    now = utc_now_iso()
    message_id = new_id()
    with db_connection() as conn:
        provider = get_or_404(conn, "communication_providers", payload.provider_id)
        if provider["type"] != "evolution":
            raise HTTPException(status_code=422, detail="Unsupported provider type")

        recipient = normalize_whatsapp_number(payload.recipient)
        result = send_text_message(provider, recipient=recipient, text=payload.content_text)
        conn.execute(
            """
            INSERT INTO communication_messages
              (id, provider_id, direction, channel, recipient, sender, content_text, status,
               provider_message_id, error, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message_id,
                payload.provider_id,
                payload.direction,
                payload.channel,
                recipient,
                payload.sender,
                payload.content_text,
                result.get("status", "queued"),
                result.get("provider_message_id"),
                result.get("error"),
                json_dump({**payload.metadata, "provider_response": result.get("response")}),
                now,
                now,
            ),
        )
        message = get_or_404(conn, "communication_messages", message_id)
        record_audit_event(
            conn,
            entity_type="communication_message",
            entity_id=message_id,
            action="sent" if message["status"] == "sent" else "failed",
            summary=f"Communication message {message['status']} via {provider['name']}",
            changes={"recipient": recipient, "channel": payload.channel, "status": message["status"]},
        )
        return message


@router.get("/webhook-events")
def list_webhook_events(provider_id: str | None = None, limit: int = 100, offset: int = 0) -> list[dict]:
    where: list[str] = []
    params: list[object] = []
    if provider_id:
        where.append("provider_id = ?")
        params.append(provider_id)
    sql = "SELECT * FROM communication_webhook_events"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("/providers/{provider_id}/webhooks/evolution", status_code=202)
def receive_evolution_webhook(provider_id: str, payload: dict) -> dict:
    now = utc_now_iso()
    webhook_id = new_id()
    with db_connection() as conn:
        provider = get_or_404(conn, "communication_providers", provider_id)
        if provider["type"] != "evolution":
            raise HTTPException(status_code=422, detail="Provider is not an Evolution provider")

        normalized = normalize_webhook_payload(payload)
        message_id = None
        if normalized["content_text"]:
            message_id = new_id()
            conn.execute(
                """
                INSERT INTO communication_messages
                  (id, provider_id, direction, channel, recipient, sender, content_text, status,
                   provider_message_id, metadata, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message_id,
                    provider_id,
                    normalized["direction"],
                    provider["channel"],
                    normalized["recipient"],
                    normalized["sender"],
                    normalized["content_text"],
                    normalized["status"],
                    normalized["provider_message_id"],
                    json_dump({"raw_event_type": normalized["event_type"]}),
                    now,
                    now,
                ),
            )

        conn.execute(
            """
            INSERT INTO communication_webhook_events
              (id, provider_id, event_type, payload, processed_status, message_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (webhook_id, provider_id, normalized["event_type"], json_dump(payload), "processed", message_id, now),
        )
        record_audit_event(
            conn,
            entity_type="communication_webhook",
            entity_id=webhook_id,
            action="received",
            summary=f"Received Evolution webhook: {normalized['event_type']}",
            changes={"message_id": message_id, "provider_id": provider_id},
        )
        return {"status": "accepted", "webhook_event_id": webhook_id, "message_id": message_id}
