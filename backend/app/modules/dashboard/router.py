from fastapi import APIRouter

from app.core.database import db_connection
from app.modules.dashboard.service import get_today_dashboard, record_recommendation_feedback
from app.shared.schemas import RecommendationFeedback

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/today")
def today() -> dict:
    """Thin transport shell — the dashboard is built in the service layer."""
    return get_today_dashboard()


recommendations_router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@recommendations_router.post("/{rec_key}/feedback")
def recommendation_feedback(rec_key: str, payload: RecommendationFeedback) -> dict:
    with db_connection() as conn:
        return record_recommendation_feedback(conn, rec_key, payload.action)
