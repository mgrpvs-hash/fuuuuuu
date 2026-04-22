from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(slots=True)
class Settings:
    bot_token: str
    bot_username: str
    admin_ids: set[int]
    main_wallet: str
    db_host: str
    db_port: int
    db_name: str
    db_user: str
    db_password: str
    redis_host: str
    redis_port: int

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def redis_url(self) -> str:
        return f"redis://{self.redis_host}:{self.redis_port}/0"


def _parse_admin_ids(raw: str) -> set[int]:
    admin_ids: set[int] = set()
    for part in raw.split(","):
        value = part.strip()
        if value.isdigit():
            admin_ids.add(int(value))
    return admin_ids


def get_settings() -> Settings:
    load_dotenv()

    bot_token = os.getenv("BOT_TOKEN", "").strip()
    if not bot_token:
        raise ValueError("BOT_TOKEN не найден в переменных окружения.")

    return Settings(
        bot_token=bot_token,
        bot_username=os.getenv("BOT_USERNAME", "PyraLink_bot").strip(),
        admin_ids=_parse_admin_ids(os.getenv("ADMIN_IDS", "7110517621,8647337535")),
        main_wallet=os.getenv(
            "MAIN_WALLET",
            "UQAdlx8wKf2Zar2VW1BEgJcWuGdJAKcnUSDbTgN-JJ7k2ZPb",
        ).strip(),
        db_host=os.getenv("POSTGRES_HOST", "postgres").strip(),
        db_port=int(os.getenv("POSTGRES_PORT", "5432")),
        db_name=os.getenv("POSTGRES_DB", "pyralink").strip(),
        db_user=os.getenv("POSTGRES_USER", "pyralink").strip(),
        db_password=os.getenv("POSTGRES_PASSWORD", "pyralink").strip(),
        redis_host=os.getenv("REDIS_HOST", "redis").strip(),
        redis_port=int(os.getenv("REDIS_PORT", "6379")),
    )


settings = get_settings()
