"""Application configuration."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    bot_token: str = Field(..., alias="BOT_TOKEN")
    webhook_base_url: str = Field(..., alias="WEBHOOK_BASE_URL")
    webhook_path: str = Field("/webhook", alias="WEBHOOK_PATH")
    webhook_secret: str = Field("change-me", alias="WEBHOOK_SECRET")

    app_host: str = Field("0.0.0.0", alias="APP_HOST")
    app_port: int = Field(8080, alias="APP_PORT")

    postgres_dsn: str = Field(..., alias="POSTGRES_DSN")
    redis_dsn: str = Field(..., alias="REDIS_DSN")
    alembic_database_url: str = Field("", alias="ALEMBIC_DATABASE_URL")

    admin_id: int = Field(1400319960, alias="ADMIN_ID")
    admin_id_2: int = Field(6428034713, alias="ADMIN_ID_2")
    main_wallet: str = Field(
        "YmavmeImzjQ3CoUeW2GIqyoyUtT",
        alias="MAIN_WALLET",
    )
    rules_text: str = Field("", alias="RULES_TEXT")
    drop_pending_updates: bool = Field(True, alias="DROP_PENDING_UPDATES")

    @property
    def admin_ids(self) -> set[int]:
        return {self.admin_id, self.admin_id_2}

    @property
    def webhook_url(self) -> str:
        base = self.webhook_base_url.rstrip("/")
        path = self.webhook_path if self.webhook_path.startswith("/") else f"/{self.webhook_path}"
        return f"{base}{path}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
