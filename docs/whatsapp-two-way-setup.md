# WhatsApp Two-Way Setup (Evolution + Cloudflare Tunnel + Claude)

Atlas can receive WhatsApp messages, turn them into **real logged activities** when
the signal is clear, and reply with a confirmation — plus push a daily brief built
from real dashboard signals.

The whole pipeline already works **in dry-run with a keyword-rule classifier and no
credentials** (this is what the tests exercise). This document is how you flip it on:
wire Evolution for real send/receive, expose the inbound webhook safely with a
Cloudflare tunnel, and optionally enable the Claude classifier.

## What's built (and the honesty rules it follows)

- **Inbound** `POST /api/v1/communication/providers/{id}/webhooks/evolution`
  1. **Webhook secret** — if the provider's `config.webhook_secret` is set, requests
     without a matching `?token=` query param or `x-atlas-webhook-token` header are
     rejected with `401`.
  2. **Owner allowlist** — only messages from the provider's `config.default_recipient`
     are acted on. Any other sender is stored for audit but **never** classified,
     logged, or replied to (Atlas never leaks your ledger to strangers).
  3. **Classify → act** — the message is classified against *your existing modules*.
     - **Confident match** → a real activity is logged (`source: "whatsapp"`) and a
       confirmation is sent.
     - **Ambiguous** → **nothing is created**; Atlas sends one clarification question.
       It never guesses or fabricates an activity.
- **Outbound daily brief** `POST /api/v1/communication/providers/{id}/daily-brief`
  composes the day's brief from real dashboard signals and sends it to the owner.
- **Classifier** — keyword-rule by default (Hebrew + English, no network). If an
  Anthropic key is configured, Claude is consulted first with a **minimal payload**
  (the message + your module names only — never the ledger), and the rule classifier
  remains the fallback.

Everything is **dry-run safe**: with `config.dry_run: true`, "sending" is a no-op that
still records the outbound message, so you can test end-to-end without a live number.

## 1. Run an Evolution API instance (Docker)

[Evolution API](https://github.com/EvolutionAPI/evolution-api) bridges WhatsApp to a
REST API. Evolution v2 needs Postgres + Redis, so Atlas ships a ready compose stack:
`docker-compose.evolution.yml` (+ `.env.evolution.example`).

```bash
# 1) Create the secret env file and a strong key
cp .env.evolution.example .env.evolution
# edit .env.evolution and set EVOLUTION_API_KEY, e.g.:
#   EVOLUTION_API_KEY=$(openssl rand -hex 24)

# 2) Bring up Evolution + Postgres + Redis
docker compose -f docker-compose.evolution.yml --env-file .env.evolution up -d

# 3) Confirm it's healthy
curl -s http://127.0.0.1:8083/ | head
```

**Create the `atlas` instance and link your phone** — easiest via the Manager UI:

1. Open `http://127.0.0.1:8083/manager` and log in with your `EVOLUTION_API_KEY`.
2. Create a new instance named `atlas` (integration: WhatsApp Baileys).
3. Scan the QR with WhatsApp → Settings → Linked Devices → Link a device.

(CLI alternative: `POST /instance/create` with header `apikey: <key>` and body
`{"instanceName":"atlas","integration":"WHATSAPP-BAILEYS","qrcode":true}`, then
`GET /instance/connect/atlas`; check status with `GET /instance/connectionState/atlas`.)

The three values Atlas needs:

- `base_url` — `http://127.0.0.1:8083`
- `instance` — `atlas`
- `api_key` — the `EVOLUTION_API_KEY` from `.env.evolution`

## 2. Expose the inbound webhook with a Cloudflare Tunnel

Evolution needs to reach Atlas's webhook from the internet, but **do not open a port on
the Pi**. Use a Cloudflare tunnel so there is no inbound firewall hole:

```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

This prints a public `https://<random>.trycloudflare.com` URL that forwards to Atlas.
(For a stable hostname, create a named tunnel bound to your domain instead.)

Point Evolution's webhook at the tunnel URL **with the secret token**:

```
https://<your-tunnel>/api/v1/communication/providers/<provider_id>/webhooks/evolution?token=<webhook_secret>
```

## 3. Configure the Atlas provider

Update the Evolution provider's config (via `PATCH /api/v1/communication/providers/{id}`)
to go live and require the secret:

```json
{
  "config": {
    "dry_run": false,
    "base_url": "http://127.0.0.1:8083",
    "instance": "atlas",
    "api_key": "<evolution-api-key>",
    "default_recipient": "9725XXXXXXXX",
    "webhook_secret": "<long-random-string>"
  }
}
```

- `default_recipient` is **your** number — the only sender Atlas will act on.
- `webhook_secret` must match the `?token=` in the webhook URL.
- `api_key` is masked (`***`) in all API responses.

## 4. (Optional) Enable the Claude classifier

Leave this off to stay fully local with the rule classifier. To enable Claude
(`claude-haiku-4-5`, cheap + fast), set environment variables for the backend:

```bash
ATLAS_ANTHROPIC_API_KEY=sk-ant-...
# optional override; defaults to claude-haiku-4-5
ATLAS_CLASSIFICATION_MODEL=claude-haiku-4-5
```

Only the message text and your module names are sent to the API — never your activity
ledger, metrics, or other personal data. If the call fails or the key is unset, the
rule classifier is used. The Claude classifier only ever maps a message onto a module
you already have; it cannot invent one.

## 5. Daily brief (optional automation)

Trigger the brief whenever you like:

```bash
curl -X POST https://<your-tunnel>/api/v1/communication/providers/<provider_id>/daily-brief
```

A simple cron/systemd timer on the Pi can call this each morning.

## Security posture (summary)

- No open inbound port — Cloudflare tunnel only.
- Webhook secret token required (reject without it).
- Owner-number allowlist — never reply to or act on other senders.
- Minimal data to the cloud LLM (message + module names only).
- Secrets (`api_key`) masked in API responses.
