from fastapi import APIRouter, HTTPException, Request

from app.core.config import get_settings
from app.core.database import db_connection, new_id, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.activity_ledger.service import insert_activity
from app.modules.communication.classifier import classify_message
from app.modules.communication.evolution import (
    normalize_webhook_payload,
    normalize_whatsapp_number,
    send_text_message,
)
from app.modules.dashboard.service import get_today_dashboard
from app.shared.audit import record_audit_event
from app.shared.schemas import (
    ActivityCreate,
    CommunicationMessageCreate,
    CommunicationProviderCreate,
    CommunicationProviderUpdate,
)
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


def _send_and_store_reply(conn, provider: dict, recipient: str, text: str, *, in_reply_to: str | None = None) -> str:
    """Send an outbound WhatsApp message (dry-run safe) and persist it."""
    now = utc_now_iso()
    reply_id = new_id()
    recipient = normalize_whatsapp_number(recipient)
    result = send_text_message(provider, recipient=recipient, text=text)
    conn.execute(
        """
        INSERT INTO communication_messages
          (id, provider_id, direction, channel, recipient, sender, content_text, status,
           provider_message_id, error, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            reply_id,
            provider["id"],
            "outbound",
            provider["channel"],
            recipient,
            None,
            text,
            result.get("status", "queued"),
            result.get("provider_message_id"),
            result.get("error"),
            json_dump({"auto_reply": True, "in_reply_to": in_reply_to, "provider_response": result.get("response")}),
            now,
            now,
        ),
    )
    return reply_id


def _handle_owner_message(conn, provider: dict, inbound_message_id: str | None, normalized: dict, sender: str, now: str) -> dict:
    """Classify an owner message, log a real activity only when confident, and reply."""
    result = classify_message(conn, provider, normalized["content_text"])

    activity_id = None
    if result["matched"]:
        activity = insert_activity(
            conn,
            ActivityCreate(
                module_id=result["module_id"],
                discipline_id=result["discipline_id"],
                activity_type=result["activity_type"],
                title=result["title"],
                duration_minutes=result["duration_minutes"],
                source="whatsapp",
                metadata={
                    "channel": "whatsapp",
                    "classified_by": result["method"],
                    "confidence": result["confidence"],
                    "inbound_message_id": inbound_message_id,
                },
            ),
        )
        activity_id = activity["id"]

    reply_message_id = _send_and_store_reply(conn, provider, sender, result["reply_text"], in_reply_to=inbound_message_id)

    if inbound_message_id:
        conn.execute(
            "UPDATE communication_messages SET metadata = ?, updated_at = ? WHERE id = ?",
            (
                json_dump(
                    {
                        "raw_event_type": normalized["event_type"],
                        "classification": {
                            "matched": result["matched"],
                            "module_id": result["module_id"],
                            "method": result["method"],
                            "confidence": result["confidence"],
                        },
                        "activity_id": activity_id,
                    }
                ),
                now,
                inbound_message_id,
            ),
        )

    return {**result, "activity_id": activity_id, "reply_message_id": reply_message_id}


def _public_classification(classification: dict | None) -> dict | None:
    if classification is None:
        return None
    return {
        "matched": classification["matched"],
        "module_id": classification["module_id"],
        "module_name": classification.get("module_name"),
        "activity_id": classification.get("activity_id"),
        "method": classification["method"],
        "confidence": classification["confidence"],
        "reply_message_id": classification.get("reply_message_id"),
    }


def _already_recorded(conn, provider_id: str, provider_message_id: str | None) -> bool:
    """Idempotency + loop guard: have we already stored this exact message?

    Catches Evolution re-deliveries and — crucially for "Note to Self" — Atlas's
    own auto-replies bouncing back as fromMe self-messages (we stored each reply
    with its provider_message_id when we sent it)."""
    if not provider_message_id:
        return False
    row = conn.execute(
        "SELECT 1 FROM communication_messages WHERE provider_id = ? AND provider_message_id = ? LIMIT 1",
        (provider_id, provider_message_id),
    ).fetchone()
    return row is not None


def _looks_like_atlas_reply(text: str | None) -> bool:
    """Backup loop guard for when the bounced message carries no provider id."""
    stripped = (text or "").lstrip()
    return stripped.startswith("✅") or stripped.startswith("☀️")


@router.post("/providers/{provider_id}/webhooks/evolution", status_code=202)
def receive_evolution_webhook(provider_id: str, payload: dict, request: Request, token: str | None = None) -> dict:
    now = utc_now_iso()
    webhook_id = new_id()
    with db_connection() as conn:
        provider = get_or_404(conn, "communication_providers", provider_id)
        if provider["type"] != "evolution":
            raise HTTPException(status_code=422, detail="Provider is not an Evolution provider")

        config = provider.get("config") or {}
        # Security: when a webhook secret is configured, reject unauthenticated calls.
        secret = config.get("webhook_secret")
        if secret:
            provided = token or request.headers.get("x-atlas-webhook-token")
            if provided != secret:
                raise HTTPException(status_code=401, detail="Invalid webhook token")

        normalized = normalize_webhook_payload(payload)
        owner = normalize_whatsapp_number(str(config.get("default_recipient") or ""))
        sender = normalize_whatsapp_number(str(normalized["sender"] or ""))
        is_owner = bool(owner) and sender == owner

        # Loop/idempotency guard. With the "Note to Self" setup the owner texts
        # their own number, so every message — including Atlas's own ✅/☀️ replies —
        # comes back as a fromMe self-message. Skip anything we've already stored
        # (Evolution re-deliveries and our own outbound replies bouncing back),
        # with a text-prefix fallback for replies that carry no provider id.
        already_seen = _already_recorded(conn, provider_id, normalized["provider_message_id"])
        is_self_reply = _looks_like_atlas_reply(normalized["content_text"])

        message_id = None
        if normalized["content_text"] and not already_seen:
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

        # Security: only act on the owner's own number. Other senders are stored
        # for audit but never classified, never logged, and never replied to.
        # Direction-agnostic: works for "Note to Self" (fromMe self-message) and a
        # separate sender number alike — the owner allowlist + loop guard are what
        # gate processing, not whether WhatsApp tagged the message inbound/outbound.
        classification = None
        if is_owner and normalized["content_text"] and not already_seen and not is_self_reply:
            classification = _handle_owner_message(conn, provider, message_id, normalized, sender, now)

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
            changes={
                "message_id": message_id,
                "provider_id": provider_id,
                "matched": classification["matched"] if classification else None,
            },
        )
        return {
            "status": "accepted",
            "webhook_event_id": webhook_id,
            "message_id": message_id,
            "classification": _public_classification(classification),
        }


def _compose_daily_brief(dashboard: dict) -> str:
    signals = dashboard.get("real_signals") or {}
    recommendations = dashboard.get("recommendations") or []
    lines = ["☀️ אטלס — סיכום יומי"]
    if recommendations:
        top = recommendations[0]
        lines.append(f"⭐ {top['title']}\n{top['body']}")
    lines.append(
        f"היום: {signals.get('today_activity_count', 0)} פעולות · "
        f"{signals.get('today_duration_minutes', 0)} דק׳"
    )
    lines.append(
        f"השבוע: {signals.get('week_activity_count', 0)} פעולות · "
        f"{signals.get('week_duration_minutes', 0)} דק׳"
    )
    return "\n\n".join(lines)


@router.post("/providers/{provider_id}/daily-brief")
def send_daily_brief(provider_id: str) -> dict:
    """Build the day's brief from real dashboard signals and send it to the owner."""
    dashboard = get_today_dashboard()
    text = _compose_daily_brief(dashboard)
    with db_connection() as conn:
        provider = get_or_404(conn, "communication_providers", provider_id)
        if provider["type"] != "evolution":
            raise HTTPException(status_code=422, detail="Provider is not an Evolution provider")
        recipient = normalize_whatsapp_number(str((provider.get("config") or {}).get("default_recipient") or ""))
        if not recipient:
            raise HTTPException(status_code=422, detail="Provider has no owner recipient configured")
        message_id = _send_and_store_reply(conn, provider, recipient, text)
        record_audit_event(
            conn,
            entity_type="communication_message",
            entity_id=message_id,
            action="daily_brief",
            summary=f"Sent daily brief via {provider['name']}",
            changes={"recipient": recipient},
        )
        return {"status": "sent", "message_id": message_id, "recipient": recipient, "preview": text}


@router.get("/daily-brief/schedule")
def daily_brief_schedule() -> dict:
    """Show whether the automatic daily brief is armed and when it next fires."""
    from app.modules.communication.scheduler import next_run_at

    settings = get_settings()
    enabled = settings.daily_brief_enabled
    return {
        "enabled": enabled,
        "time": f"{settings.daily_brief_hour:02d}:{settings.daily_brief_minute:02d}",
        "timezone": settings.timezone,
        "next_run": next_run_at(settings).isoformat() if enabled else None,
        "preview": _compose_daily_brief(get_today_dashboard()),
    }
