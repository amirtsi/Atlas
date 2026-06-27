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
