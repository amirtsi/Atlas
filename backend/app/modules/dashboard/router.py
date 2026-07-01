from fastapi import APIRouter

from app.modules.dashboard.service import get_today_dashboard

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/today")
def today() -> dict:
    """Thin transport shell — the dashboard is built in the service layer."""
    return get_today_dashboard()
