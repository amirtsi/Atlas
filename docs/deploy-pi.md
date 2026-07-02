# Deploying Atlas on a Raspberry Pi (Docker)

Everything runs as two Docker Compose stacks in this folder:

| Stack | File(s) | Containers |
|---|---|---|
| **Atlas app** | `docker-compose.yml` | `atlas-backend` (API, :8000) + `atlas-web` (UI, :8080) |
| **WhatsApp bridge** | `docker-compose.evolution.yml` (+ `docker-compose.evolution.pi.yml` on Linux) | Evolution API (:8083) + its Postgres + Redis |

Both are multi-arch — they build/run on a 64-bit Raspberry Pi (Pi 4/5, arm64) and on
a Mac/PC identically. `restart: unless-stopped` on everything means the whole system
comes back by itself after a power cut or reboot.

## 0. Prerequisites (once)

64-bit Raspberry Pi OS, then:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out & back in
```

## 1. Get the code

```bash
git clone https://github.com/amirtsi/Atlas.git && cd Atlas
```

## 2. (Optional) bring your real data from the Mac

The ledger is one SQLite file. On a fresh start Atlas seeds an empty honest DB;
to keep your history, copy it in **before** first start:

```bash
mkdir -p data
scp <mac-user>@<mac-host>:~/Desktop/Atlas/Atlas/backend/data/atlas.sqlite data/atlas.sqlite
```

## 3. Start the Atlas app

```bash
# optional: export ATLAS_ANTHROPIC_API_KEY=...   (plan decomposition / coach / classifier)
docker compose up -d --build
```

- Web UI → `http://<pi-address>:8080`
- API → `http://<pi-address>:8000` (`/health` for a quick check)
- Data lives in `./data/atlas.sqlite` on the Pi — back it up with a plain `cp`.

Ports/timezone can be changed via env: `ATLAS_WEB_PORT`, `ATLAS_API_PORT`, `ATLAS_TIMEZONE`.

## 4. Start the WhatsApp bridge

```bash
cp .env.evolution.example .env.evolution    # set a strong EVOLUTION_API_KEY
docker compose -f docker-compose.evolution.yml -f docker-compose.evolution.pi.yml \
  --env-file .env.evolution up -d
```

The `.pi.yml` overlay maps `host.docker.internal` → the Pi itself, which Linux
doesn't do automatically (macOS does). Without it the webhook can't reach Atlas.

## 5. Wire Atlas ↔ Evolution (once, after migrating a Mac DB)

The provider config inside the DB still points at the Mac's local bridge. Update it
to go through the host mapping (works from inside the backend container):

```bash
PROVIDER_ID=$(curl -s http://127.0.0.1:8000/api/v1/communication/providers | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
curl -s -X PATCH http://127.0.0.1:8000/api/v1/communication/providers/$PROVIDER_ID \
  -H 'Content-Type: application/json' \
  -d '{"config": {"dry_run": false, "base_url": "http://host.docker.internal:8083",
       "instance": "Atlas", "api_key": "<EVOLUTION_API_KEY>",
       "webhook_secret": "<WEBHOOK_SECRET>", "default_recipient": "9725XXXXXXXX"}}'
```

Then in Evolution (Manager UI at `http://<pi-address>:8083/manager`, or the API) set the
instance webhook (MESSAGES_UPSERT) to:

```
http://host.docker.internal:8000/api/v1/communication/providers/<PROVIDER_ID>/webhooks/evolution?token=<WEBHOOK_SECRET>
```

Finally open **Comms** in the Atlas UI → the WhatsApp hub shows the connection state;
if it says "דורש סריקת QR", scan the QR right there from your phone
(WhatsApp → Settings → Linked Devices). Moving hosts always requires one re-scan.

## 6. Updating

```bash
git pull && docker compose up -d --build
docker compose -f docker-compose.evolution.yml -f docker-compose.evolution.pi.yml \
  --env-file .env.evolution up -d
```

## Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| Comms hub shows 🔴 "הגשר כבוי" | Evolution stack is down | step 4 command |
| Comms hub shows 🟡 "דורש סריקת QR" | Bridge up, phone not paired | scan the QR in the hub |
| Sent messages fail with connection error | provider `base_url` still points at 127.0.0.1 | step 5 PATCH |
| Inbound WhatsApp does nothing | webhook URL/secret wrong, or missing `.pi.yml` overlay | step 4–5 |
| `docker compose up` warns about orphans | you mixed the two stacks in one command | the stacks are separate projects (`atlas-app` vs the Evolution one); run them with their own files |

Notes: the daily brief is sent by the in-app scheduler at 08:00 (container must be
up — it is, thanks to `restart: unless-stopped`). The Atlas MCP server (Hermes seam)
is not part of the containers yet; run it host-side per `docs/atlas-mcp-setup.md`.
