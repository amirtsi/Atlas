from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ATLAS_", env_file=".env", extra="ignore")

    env: str = "development"
    database_path: Path = Field(default=Path("data/atlas.sqlite"))
    timezone: str = "Asia/Jerusalem"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    default_whatsapp_recipient: str = "972546745182"
    # WhatsApp message classification. Empty key => rule-based classifier only
    # (no network, no credentials). Set ATLAS_ANTHROPIC_API_KEY to enable the
    # Claude adapter; the rule classifier stays the fallback.
    anthropic_api_key: str = ""
    classification_model: str = "claude-haiku-4-5"
    log_level: str = "INFO"
    # Automatic daily brief: an in-app scheduler sends each active provider's
    # owner a brief built from real dashboard signals, once per day at this
    # local (timezone) time.
    #
    # IMPORTANT — pick ONE trigger, not both:
    #   * In-app scheduler (this, default) runs while the API server is up.
    #   * The launchd job in deploy/com.atlas.dailybrief.plist runs the standalone
    #     scripts.send_daily_brief independent of the server.
    # Both fire at 08:00 and share the same per-provider/per-day idempotency guard,
    # so they won't double-send, but running both is redundant and racy. If you use
    # the launchd plist, set ATLAS_DAILY_BRIEF_ENABLED=false to turn this one off.
    daily_brief_enabled: bool = True
    daily_brief_hour: int = 8
    daily_brief_minute: int = 0

    @property
    def resolved_database_path(self) -> Path:
        if self.database_path.is_absolute():
            return self.database_path
        return Path.cwd() / self.database_path

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
