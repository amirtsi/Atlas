"""In-app scheduler for proactive notifications.

The only trigger today is the **daily brief**: once per day, at a configured
local time, each active Evolution provider's owner receives a brief built from
real dashboard signals. It reuses the exact composition + send path as the
manual `POST /communication/providers/{id}/daily-brief` endpoint, so what fires
automatically is identical to what you can fire by hand — no separate code path,
no fabricated content. Idempotent: at most one brief per provider per UTC day.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.config import get_settings
from app.core.database import db_connection, rows_to_dicts
from app.core.time import utc_now_iso
from app.modules.communication.evolution import normalize_whatsapp_number
from app.modules.dashboard.service import get_today_dashboard
from app.shared.audit import record_audit_event

logger = logging.getLogger("atlas.scheduler")

# Brief text begins with this marker (see router._compose_daily_brief); used as
# the idempotency fingerprint so a restart mid-day never double-sends.
_BRIEF_PREFIX = "☀️"


def next_run_at(settings, *, now: datetime | None = None) -> datetime:
    """Next local datetime the brief should fire (today if still ahead, else tomorrow)."""
    tz = ZoneInfo(settings.timezone)
    now = now or datetime.now(tz)
    target = now.replace(
        hour=settings.daily_brief_hour,
        minute=settings.daily_brief_minute,
        second=0,
        microsecond=0,
    )
    if target <= now:
        target += timedelta(days=1)
    return target


def _brief_already_sent_today(conn, provider_id: str) -> bool:
    today = utc_now_iso()[:10]
    row = conn.execute(
        "SELECT 1 FROM communication_messages "
        "WHERE provider_id = ? AND direction = 'outbound' "
        "AND content_text LIKE ? AND substr(created_at, 1, 10) = ? LIMIT 1",
        (provider_id, f"{_BRIEF_PREFIX}%", today),
    ).fetchone()
    return row is not None


def dispatch_due_briefs() -> list[dict]:
    """Send today's brief to every active Evolution provider that hasn't had one yet.

    Returns one result dict per provider acted on (for logging/tests). Imports
    the router helpers lazily to avoid an import cycle at module load."""
    from app.modules.communication.router import _compose_daily_brief, _send_and_store_reply

    results: list[dict] = []
    with db_connection() as conn:
        providers = rows_to_dicts(
            conn.execute(
                "SELECT * FROM communication_providers WHERE type = 'evolution' AND is_active = 1"
            ).fetchall()
        )
        for provider in providers:
            recipient = normalize_whatsapp_number(
                str((provider.get("config") or {}).get("default_recipient") or "")
            )
            if not recipient:
                continue
            if _brief_already_sent_today(conn, provider["id"]):
                results.append({"provider_id": provider["id"], "status": "skipped_already_sent"})
                continue
            text = _compose_daily_brief(get_today_dashboard())
            message_id = _send_and_store_reply(conn, provider, recipient, text)
            record_audit_event(
                conn,
                entity_type="communication_message",
                entity_id=message_id,
                action="daily_brief_scheduled",
                summary=f"Sent scheduled daily brief via {provider['name']}",
                changes={"recipient": recipient, "trigger": "scheduler"},
            )
            results.append({"provider_id": provider["id"], "status": "sent", "message_id": message_id})
    return results


async def run_daily_brief_scheduler() -> None:
    """Long-lived loop: sleep until the next configured local time, then dispatch."""
    settings = get_settings()
    if not settings.daily_brief_enabled:
        logger.info("Daily brief scheduler disabled (ATLAS_DAILY_BRIEF_ENABLED=false).")
        return

    logger.info(
        "Daily brief scheduler active — fires %02d:%02d %s.",
        settings.daily_brief_hour,
        settings.daily_brief_minute,
        settings.timezone,
    )
    while True:
        try:
            target = next_run_at(settings)
            delay = (target - datetime.now(ZoneInfo(settings.timezone))).total_seconds()
            logger.info("Next daily brief at %s (in %d min).", target.isoformat(), int(delay // 60))
            await asyncio.sleep(max(1.0, delay))
            results = await asyncio.to_thread(dispatch_due_briefs)
            logger.info("Daily brief dispatch: %s", results)
        except asyncio.CancelledError:
            logger.info("Daily brief scheduler stopped.")
            break
        except Exception:  # never let a transient error kill the loop
            logger.exception("Daily brief dispatch failed; retrying in 5 min.")
            await asyncio.sleep(300)


async def run_outbox_dispatcher() -> None:
    """Long-lived heartbeat for the coach outbox: drain the queue every 60s and
    run the nudge pass hourly. All send policy lives in outbox.dispatch_pending;
    quiet-hours skipping for nudges lives in nudges.run_nudge_pass. Sleeps
    before the first tick so app startup (and tests) never race a dispatch."""
    from app.modules.communication.nudges import run_nudge_pass
    from app.modules.communication.outbox import run_dispatch_tick

    logger.info("Outbox dispatcher active — 60s tick, hourly nudge pass.")
    last_nudge_pass: datetime | None = None
    while True:
        try:
            await asyncio.sleep(60)
            now = datetime.now(UTC)
            if last_nudge_pass is None or now - last_nudge_pass >= timedelta(hours=1):
                queued = await asyncio.to_thread(run_nudge_pass)
                if queued:
                    logger.info("Nudge pass queued %d nudge(s).", len(queued))
                last_nudge_pass = now
            results = await asyncio.to_thread(run_dispatch_tick)
            if results:
                logger.info("Outbox dispatch: %s", results)
        except asyncio.CancelledError:
            logger.info("Outbox dispatcher stopped.")
            break
        except Exception:  # never let a transient error kill the loop
            logger.exception("Outbox tick failed; retrying next tick.")
