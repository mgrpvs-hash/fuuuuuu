"""Admin command handlers."""

from __future__ import annotations

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

from app.services.logic import BotService

router = Router(name="admin")


def _is_admin(message: Message, service: BotService) -> bool:
    return bool(message.from_user and message.from_user.id in service.admin_tg_ids)


@router.message(Command("my_id"))
async def cmd_my_id(message: Message, service: BotService) -> None:
    if not _is_admin(message, service):
        await message.answer("Команда доступна только администраторам.")
        return
    if message.from_user:
        await message.answer(f"Ваш ID: {message.from_user.id}")


@router.message(Command("stats"))
async def cmd_stats(message: Message, service: BotService) -> None:
    if not _is_admin(message, service):
        await message.answer("Команда доступна только администраторам.")
        return
    stats = await service.get_stats()
    text = (
        "📊 Статистика:\n"
        f"👤 Пользователей: {stats['users_count']}\n"
        f"🏠 Комнат: {stats['rooms_count']}\n"
        f"💸 Общая сумма: {service.amount_ton(stats['total_amount'])}"
    )
    await message.answer(text)


@router.message(Command("rooms"))
async def cmd_rooms(message: Message, service: BotService) -> None:
    if not _is_admin(message, service):
        await message.answer("Команда доступна только администраторам.")
        return
    lines = await service.admin_rooms_lines()
    await message.answer("\n".join(lines))


@router.message(Command("ban"))
async def cmd_ban(message: Message, service: BotService) -> None:
    if not _is_admin(message, service):
        await message.answer("Команда доступна только администраторам.")
        return
    parts = (message.text or "").split()
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("Использование: /ban <user_id>")
        return
    result = await service.ban_user_by_tg_id(int(parts[1]))
    await message.answer(result)


@router.message(Command("unban"))
async def cmd_unban(message: Message, service: BotService) -> None:
    if not _is_admin(message, service):
        await message.answer("Команда доступна только администраторам.")
        return
    parts = (message.text or "").split()
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("Использование: /unban <user_id>")
        return
    result = await service.unban_user_by_tg_id(int(parts[1]))
    await message.answer(result)


@router.message(Command("block_room"))
async def cmd_block_room(message: Message, service: BotService) -> None:
    if not _is_admin(message, service):
        await message.answer("Команда доступна только администраторам.")
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) != 2:
        await message.answer("Использование: /block_room <room_id|token>")
        return
    result = await service.block_room_by_identifier(parts[1].strip())
    await message.answer(result)


@router.message(Command("unblock_room"))
async def cmd_unblock_room(message: Message, service: BotService) -> None:
    if not _is_admin(message, service):
        await message.answer("Команда доступна только администраторам.")
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) != 2:
        await message.answer("Использование: /unblock_room <room_id|token>")
        return
    result = await service.unblock_room_by_identifier(parts[1].strip())
    await message.answer(result)


@router.message(Command("broadcast"))
async def cmd_broadcast(message: Message, service: BotService) -> None:
    if not _is_admin(message, service):
        await message.answer("Команда доступна только администраторам.")
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        await message.answer("Использование: /broadcast <текст>")
        return
    sent_count, failed_count = await service.broadcast(message.bot, parts[1].strip())
    await message.answer(
        "📢 Рассылка завершена.\n"
        f"✅ Успешно отправлено: {sent_count}\n"
        f"❌ Ошибок отправки: {failed_count}"
    )


@router.message(Command("debug_room"))
async def cmd_debug_room(message: Message, service: BotService) -> None:
    if not _is_admin(message, service):
        await message.answer("Команда доступна только администраторам.")
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) != 2:
        await message.answer("Использование: /debug_room <room_id|token>")
        return
    result = await service.debug_room(parts[1].strip())
    await message.answer(result)


@router.message(Command("chain"))
async def cmd_chain(message: Message, service: BotService) -> None:
    if not _is_admin(message, service):
        await message.answer("Команда доступна только администраторам.")
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) != 2 or not parts[1].isdigit():
        await message.answer("Использование: /chain <user_id>")
        return
    result = await service.chain_for_user_tg_id(int(parts[1]))
    await message.answer(result)
