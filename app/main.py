from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from aiogram import Bot, Dispatcher
from redis.asyncio import Redis

from app.config import settings
from app.db import SessionLocal, close_db, init_db
from app.handlers import router
from app.handlers import setup_handlers


async def main() -> None:
    logging.basicConfig(
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        level=logging.INFO,
    )

    await init_db()

    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    await redis.ping()

    bot = Bot(token=settings.bot_token)
    dp = Dispatcher()
    setup_handlers(settings=settings, redis=redis, session_factory=SessionLocal)
    dp.include_router(router)

    try:
        await dp.start_polling(bot)
    finally:
        with suppress(Exception):
            await redis.close()
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
