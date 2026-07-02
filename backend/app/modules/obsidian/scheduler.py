"""Periodic Obsidian export.

Mirrors the daily-brief scheduler pattern: an asyncio loop started from the app
lifespan. Runs only when a vault is configured; each tick is a full derived
rewrite (idempotent), so a missed or doubled tick is harmless. Failures are
logged and never crash the app.
"""

import asyncio
import logging

from app.core.config import get_settings
from app.modules.obsidian.service import export_to_vault, vault_ready

logger = logging.getLogger("atlas.obsidian")

last_export_at: str | None = None


async def run_obsidian_export_scheduler() -> None:
    settings = get_settings()
    if not settings.obsidian_vault.strip():
        logger.info("Obsidian export disabled (ATLAS_OBSIDIAN_VAULT not set).")
        return
    interval = max(1, settings.obsidian_export_minutes) * 60
    logger.info("Obsidian export active — every %s min into %s.", settings.obsidian_export_minutes, settings.obsidian_vault)
    global last_export_at
    while True:
        try:
            if vault_ready() is not None:
                result = await asyncio.to_thread(export_to_vault)
                from app.core.time import utc_now_iso

                last_export_at = utc_now_iso()
                logger.info("Obsidian export: %s written, %s pruned.", len(result["written"]), len(result["pruned"]))
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - keep the loop alive on any export failure
            logger.exception("Obsidian export failed; retrying next tick.")
        await asyncio.sleep(interval)
