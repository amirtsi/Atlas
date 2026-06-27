import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def normalize_whatsapp_number(value: str) -> str:
    digits = "".join(character for character in value if character.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0"):
        return f"972{digits[1:]}"
    return digits


def send_text_message(provider: dict, *, recipient: str, text: str) -> dict[str, Any]:
    config = provider.get("config") or {}
    normalized_recipient = normalize_whatsapp_number(recipient)
    if config.get("dry_run", True):
        return {
            "status": "sent",
            "provider_message_id": None,
            "response": {"dry_run": True, "provider": "evolution", "recipient": normalized_recipient},
        }

    base_url = str(config.get("base_url") or "").rstrip("/")
    instance = config.get("instance")
    api_key = config.get("api_key")
    if not base_url or not instance or not api_key:
        return {
            "status": "failed",
            "provider_message_id": None,
            "error": "Evolution provider requires base_url, instance and api_key when dry_run is false.",
        }

    payload = json.dumps({"number": normalized_recipient, "text": text}).encode("utf-8")
    request = Request(
        f"{base_url}/message/sendText/{instance}",
        data=payload,
        headers={"Content-Type": "application/json", "apikey": str(api_key)},
        method="POST",
    )

    try:
        with urlopen(request, timeout=12) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
    except HTTPError as error:
        return {"status": "failed", "provider_message_id": None, "error": error.read().decode("utf-8")}
    except (URLError, TimeoutError) as error:
        return {"status": "failed", "provider_message_id": None, "error": str(error)}

    provider_message_id = body.get("key", {}).get("id") if isinstance(body.get("key"), dict) else body.get("id")
    return {"status": "sent", "provider_message_id": provider_message_id, "response": body}


def normalize_webhook_payload(payload: dict[str, Any]) -> dict[str, Any]:
    event_type = str(payload.get("event") or payload.get("type") or "unknown")
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    key = data.get("key") if isinstance(data.get("key"), dict) else {}
    message = data.get("message") if isinstance(data.get("message"), dict) else {}
    conversation = message.get("conversation") or message.get("extendedTextMessage", {}).get("text")

    return {
        "event_type": event_type,
        "provider_message_id": key.get("id") or data.get("id"),
        "direction": "inbound" if not key.get("fromMe") else "outbound",
        "sender": key.get("remoteJid") or data.get("sender"),
        "recipient": data.get("recipient"),
        "content_text": conversation or data.get("text") or "",
        "status": data.get("status") or event_type,
    }
