from fastapi import APIRouter

from app.core.config import get_settings
from app.modules.obsidian import scheduler
from app.modules.obsidian.service import export_to_vault

router = APIRouter(prefix="/obsidian", tags=["obsidian"])


@router.get("/status")
def obsidian_status() -> dict:
    vault = get_settings().obsidian_vault.strip()
    return {"configured": bool(vault), "vault": vault or None, "last_export_at": scheduler.last_export_at}


@router.post("/export")
def obsidian_export() -> dict:
    return export_to_vault()
