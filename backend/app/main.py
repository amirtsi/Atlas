from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.database import db_connection, initialize_database
from app.modules.activity_ledger.router import router as activity_router
from app.modules.audit.router import router as audit_router
from app.modules.communication.router import router as communication_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.disciplines.router import router as disciplines_router
from app.modules.learning.router import router as learning_router
from app.modules.life_modules.router import router as modules_router
from app.modules.metrics.router import router as metrics_router
from app.modules.project.router import router as project_router
from app.modules.wellbeing.router import router as wellbeing_router


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Atlas API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def startup() -> None:
        initialize_database()

    @app.get("/health", tags=["health"])
    def health() -> dict:
        with db_connection() as conn:
            conn.execute("SELECT 1").fetchone()
        return {"status": "ok", "service": "atlas-api", "database": "ok"}

    app.include_router(disciplines_router, prefix="/api/v1")
    app.include_router(modules_router, prefix="/api/v1")
    app.include_router(project_router, prefix="/api/v1")
    app.include_router(learning_router, prefix="/api/v1")
    app.include_router(wellbeing_router, prefix="/api/v1")
    app.include_router(activity_router, prefix="/api/v1")
    app.include_router(audit_router, prefix="/api/v1")
    app.include_router(communication_router, prefix="/api/v1")
    app.include_router(metrics_router, prefix="/api/v1")
    app.include_router(dashboard_router, prefix="/api/v1")
    return app


app = create_app()
