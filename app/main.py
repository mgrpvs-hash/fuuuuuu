"""Application entrypoint with webhook setup."""

from __future__ import annotations

import logging

from aiohttp import web
from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.redis import RedisStorage
from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
from redis.asyncio import Redis

from app.config import get_settings
from app.handlers import admin as admin_handlers
from app.handlers import user as user_handlers
from app.middlewares.db import DbSessionMiddleware
from app.db.session import build_engine, build_session_factory


def build_dispatcher(storage: RedisStorage) -> Dispatcher:
    settings = get_settings()
    dispatcher = Dispatcher(storage=storage)
    dispatcher.update.middleware(DbSessionMiddleware(build_session_factory(build_engine(settings)), settings))
    dispatcher.include_router(admin_handlers.router)
    dispatcher.include_router(user_handlers.router)
    return dispatcher


async def on_startup(bot: Bot) -> None:
    settings = get_settings()
    # In local/test environments WEBHOOK_BASE_URL can be placeholder text.
    # Skip webhook registration until a real public HTTPS URL is provided.
    if not settings.webhook_base_url.startswith(("http://", "https://")):
        logging.warning("Skipping webhook setup: WEBHOOK_BASE_URL is not configured.")
        return
    await bot.set_webhook(
        url=settings.webhook_url,
        secret_token=settings.webhook_secret,
        drop_pending_updates=settings.drop_pending_updates,
    )


async def on_shutdown(bot: Bot) -> None:
    await bot.delete_webhook(drop_pending_updates=False)


def create_app() -> web.Application:
    settings = get_settings()
    redis = Redis.from_url(settings.redis_dsn, decode_responses=True)
    storage = RedisStorage(redis=redis)
    bot = Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = build_dispatcher(storage)
    dispatcher.startup.register(on_startup)
    dispatcher.shutdown.register(on_shutdown)

    app = web.Application()
    SimpleRequestHandler(
        dispatcher=dispatcher,
        bot=bot,
        secret_token=settings.webhook_secret,
    ).register(app, path=settings.webhook_path)
    setup_application(app, dispatcher, bot=bot)
    return app


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    settings = get_settings()
    app = create_app()
    web.run_app(app, host=settings.app_host, port=settings.app_port)


if __name__ == "__main__":
    main()
