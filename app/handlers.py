from __future__ import annotations

from decimal import Decimal

from aiogram import F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import CallbackQuery, Message
from redis.asyncio import Redis

from app.config import Settings
from app.constants import ROOM_BLOCK_REASON_BY_ADMIN, RULES_TEXT
from app.keyboards import (
    admin_create_request_keyboard,
    back_menu_keyboard,
    create_room_payment_keyboard,
    creator_join_request_keyboard,
    join_invite_keyboard,
    main_menu_keyboard,
    room_details_keyboard,
    room_list_keyboard,
)
from app.models import RequestStatus, Room
from app.repositories import CreateRequestRepo, JoinRequestRepo, RoomRepo, UserRepo
from app.services import (
    blocked_reason,
    build_room_token,
    room_counter,
    room_global_id,
    room_link,
    room_status,
)
from app.utils import (
    format_ton,
    format_user,
    parse_amount,
    parse_room_identifier,
    parse_user_id,
)

router = Router()


def setup_handlers(settings: Settings, redis: Redis, session_factory) -> Router:
    router.data["settings"] = settings
    router.data["redis"] = redis
    router.data["session_factory"] = session_factory
    return router


def _is_admin(settings: Settings, user_id: int) -> bool:
    return user_id in settings.admin_ids


async def _ensure_user_and_not_banned(message: Message, session) -> tuple[UserRepo, object] | tuple[None, None]:
    user_repo = UserRepo(session)
    user = await user_repo.get_or_create(message.from_user.id, message.from_user.username)  # type: ignore[union-attr]
    if user.is_banned:
        await message.answer("Ваш аккаунт заблокирован администратором.")
        return None, None
    return user_repo, user


async def _show_main_menu(message: Message, user_repo: UserRepo, user_id: int) -> None:
    user = await user_repo.get(user_id)
    wallet_text = f"👛 Ваш кошелёк: {user.wallet}" if user and user.wallet else "👛 Кошелёк не подключен"
    await message.answer(f"Главное меню\n\n{wallet_text}", reply_markup=main_menu_keyboard())


def _amount_to_text(value: Decimal) -> str:
    text = format(value.normalize(), "f")
    text = text.rstrip("0").rstrip(".")
    return text if text else "0"


@router.message(Command("start"))
async def cmd_start(message: Message, command: CommandObject) -> None:
    if not message.from_user:
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo, user = await _ensure_user_and_not_banned(message, session)
        if user_repo is None:
            return
        room_repo = RoomRepo(session)
        join_repo = JoinRequestRepo(session)

        payload = command.args
        if payload and payload.startswith("room_"):
            identifier = payload.replace("room_", "", 1)
            room = await room_repo.get_by_token_or_id(identifier)
            if room is None:
                await message.answer("❌ 🏠 Комната не найдена.", reply_markup=back_menu_keyboard())
                return
            if room.is_blocked:
                await message.answer(blocked_reason(room), reply_markup=back_menu_keyboard())
                return
            if not room.is_open or room.joined_count >= 2:
                await message.answer("❌ 🔗 Ссылка неактивна (комната заполнена).", reply_markup=back_menu_keyboard())
                return
            if room.creator_id == user.id:
                await message.answer("Вы создатель этой комнаты.", reply_markup=back_menu_keyboard())
                return
            if await room_repo.has_participant(room.id, user.id):
                await message.answer("✅ Вы уже присоединились к этой комнате.", reply_markup=back_menu_keyboard())
                return
            if await join_repo.has_pending(room.id, user.id):
                await message.answer(
                    "Ваша заявка уже ожидает подтверждения создателя комнаты.",
                    reply_markup=back_menu_keyboard(),
                )
                return
            await message.answer(
                "🏠 Вы присоединяетесь к комнате.\n"
                f"💸 Сумма: {format_ton(_amount_to_text(room.amount))}.\n"
                "👛 Отправьте платеж на кошелёк создателя:\n"
                f"{room.creator_wallet}",
                reply_markup=join_invite_keyboard(room.id),
            )
            return

        await _show_main_menu(message, user_repo, user.id)
        await session.commit()


@router.message(Command("my_id"))
async def cmd_my_id(message: Message) -> None:
    if not message.from_user:
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        await user_repo.get_or_create(message.from_user.id, message.from_user.username)
        await session.commit()
    await message.answer(f"Ваш ID: {message.from_user.id}")


@router.message(Command("stats"))
async def cmd_stats(message: Message) -> None:
    if not message.from_user:
        return
    settings: Settings = router.data["settings"]
    if not _is_admin(settings, message.from_user.id):
        await message.answer("Эта команда доступна только администратору.")
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        room_repo = RoomRepo(session)
        total_users = await user_repo.count()
        total_rooms = await room_repo.count()
        total_amount = await room_repo.sum_amounts()
    total_amount_str = _amount_to_text(total_amount)
    await message.answer(
        "Статистика:\n"
        f"Всего пользователей: {total_users}\n"
        f"Всего комнат: {total_rooms}\n"
        f"Общая сумма всех комнат: {format_ton(total_amount_str)}"
    )


@router.message(Command("rooms"))
async def cmd_rooms(message: Message) -> None:
    if not message.from_user:
        return
    settings: Settings = router.data["settings"]
    if not _is_admin(settings, message.from_user.id):
        await message.answer("Эта команда доступна только администратору.")
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        room_repo = RoomRepo(session)
        rooms = await room_repo.all_rooms()
        if not rooms:
            await message.answer("Комнат пока нет.")
            return
        lines = ["Все комнаты:"]
        for room in rooms:
            block_mark = " [ЗАБЛОКИРОВАНА]" if room.is_blocked else ""
            lines.append(
                f"{room_global_id(room)} | {room_status(room)} | "
                f"{format_ton(_amount_to_text(room.amount))} | "
                f"{format_user(room.creator_id, room.creator_username)}{block_mark}"
            )
        await message.answer("\n".join(lines))


@router.message(Command("ban"))
async def cmd_ban(message: Message, command: CommandObject) -> None:
    if not message.from_user:
        return
    settings: Settings = router.data["settings"]
    if not _is_admin(settings, message.from_user.id):
        await message.answer("Эта команда доступна только администратору.")
        return
    target_id = parse_user_id(command.args)
    if target_id is None:
        await message.answer("Использование: /ban <user_id>")
        return
    if _is_admin(settings, target_id):
        await message.answer("Нельзя забанить администратора.")
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        room_repo = RoomRepo(session)
        target = await user_repo.get_or_create(target_id, None)
        target.is_banned = True
        blocked_count = await room_repo.block_all_by_creator(target_id, ROOM_BLOCK_REASON_BY_ADMIN)
        await session.commit()
    await message.answer(f"Пользователь {target_id} забанен. Заблокировано комнат: {blocked_count}.")


@router.message(Command("unban"))
async def cmd_unban(message: Message, command: CommandObject) -> None:
    if not message.from_user:
        return
    settings: Settings = router.data["settings"]
    if not _is_admin(settings, message.from_user.id):
        await message.answer("Эта команда доступна только администратору.")
        return
    target_id = parse_user_id(command.args)
    if target_id is None:
        await message.answer("Использование: /unban <user_id>")
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        target = await user_repo.get(target_id)
        if target is None or not target.is_banned:
            await message.answer("Пользователь не был в бане.")
            return
        target.is_banned = False
        await session.commit()
    await message.answer(f"Пользователь {target_id} разбанен.")


@router.message(Command("block_room"))
async def cmd_block_room(message: Message, command: CommandObject) -> None:
    if not message.from_user:
        return
    settings: Settings = router.data["settings"]
    if not _is_admin(settings, message.from_user.id):
        await message.answer("Эта команда доступна только администратору.")
        return
    identifier = parse_room_identifier(command.args)
    if not identifier:
        await message.answer("Использование: /block_room <room_id_or_token>")
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        room_repo = RoomRepo(session)
        room = await room_repo.get_by_token_or_id(identifier)
        if room is None:
            await message.answer("Комната не найдена.")
            return
        room.is_blocked = True
        room.is_open = False
        room.block_reason = ROOM_BLOCK_REASON_BY_ADMIN
        await session.commit()
        await message.answer(f"Комната {room_global_id(room)} заблокирована.")


@router.message(Command("unblock_room"))
async def cmd_unblock_room(message: Message, command: CommandObject) -> None:
    if not message.from_user:
        return
    settings: Settings = router.data["settings"]
    if not _is_admin(settings, message.from_user.id):
        await message.answer("Эта команда доступна только администратору.")
        return
    identifier = parse_room_identifier(command.args)
    if not identifier:
        await message.answer("Использование: /unblock_room <room_id_or_token>")
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        room_repo = RoomRepo(session)
        user_repo = UserRepo(session)
        room = await room_repo.get_by_token_or_id(identifier)
        if room is None:
            await message.answer("Комната не найдена.")
            return
        if room.joined_count >= 2:
            await message.answer("Нельзя разблокировать заполненную комнату (2/2).")
            return
        creator = await user_repo.get(room.creator_id)
        if creator and creator.is_banned:
            await message.answer("Нельзя разблокировать комнату забаненного пользователя.")
            return
        room.is_blocked = False
        room.block_reason = None
        room.is_open = room.joined_count < 2
        await session.commit()
        await message.answer(f"Комната {room_global_id(room)} разблокирована.")


@router.message(Command("broadcast"))
async def cmd_broadcast(message: Message, command: CommandObject) -> None:
    if not message.from_user:
        return
    settings: Settings = router.data["settings"]
    if not _is_admin(settings, message.from_user.id):
        await message.answer("Эта команда доступна только администратору.")
        return
    if not command.args:
        await message.answer("Использование: /broadcast <текст>")
        return
    text = command.args.strip()
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        user_ids = await user_repo.all_user_ids()
    sent = 0
    failed = 0
    for uid in user_ids:
        try:
            await message.bot.send_message(chat_id=uid, text=f"[Рассылка]\n{text}")
            sent += 1
        except Exception:
            failed += 1
    await message.answer(f"Рассылка завершена. Отправлено: {sent}, ошибок: {failed}.")


@router.message(Command("debug_room"))
async def cmd_debug_room(message: Message, command: CommandObject) -> None:
    if not message.from_user:
        return
    settings: Settings = router.data["settings"]
    if not _is_admin(settings, message.from_user.id):
        await message.answer("Эта команда доступна только администратору.")
        return
    identifier = parse_room_identifier(command.args)
    if not identifier:
        await message.answer("Использование: /debug_room <room_id_or_token>")
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        room_repo = RoomRepo(session)
        room = await room_repo.get_by_token_or_id(identifier)
        if room is None:
            await message.answer("Комната не найдена.")
            return
        participants = await room_repo.participants(room.id)
        part_text = "нет" if not participants else "; ".join(format_user(uid, uname) for uid, uname in participants)
        link_active = "да" if room.is_open and room.joined_count < 2 and not room.is_blocked else "нет"
        await message.answer(
            f"Debug комнаты {room_global_id(room)}\n"
            f"Создатель: {format_user(room.creator_id, room.creator_username)}\n"
            f"Участники: {part_text}\n"
            f"Сумма: {format_ton(_amount_to_text(room.amount))}\n"
            f"Статус: {room_status(room)}\n"
            f"Ссылка активна: {link_active}\n"
            f"Комната заблокирована: {'да' if room.is_blocked else 'нет'}"
        )


@router.message(Command("chain"))
async def cmd_chain(message: Message, command: CommandObject) -> None:
    if not message.from_user:
        return
    settings: Settings = router.data["settings"]
    if not _is_admin(settings, message.from_user.id):
        await message.answer("Эта команда доступна только администратору.")
        return
    target_id = parse_user_id(command.args)
    if target_id is None:
        await message.answer("Использование: /chain <user_id>")
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        room_repo = RoomRepo(session)
        created = await room_repo.created_by_user(target_id)
        participated = await room_repo.participated_by_user(target_id)
    created_text = ", ".join(room_global_id(room) for room in created) if created else "нет"
    part_text = ", ".join(room_global_id(room) for room in participated) if participated else "нет"
    await message.answer(
        f"Цепочка пользователя {target_id}\n"
        f"Созданные комнаты: {created_text}\n"
        f"Участвовал в комнатах: {part_text}"
    )


@router.callback_query(F.data == "menu_main")
async def cb_menu_main(callback: CallbackQuery) -> None:
    if not callback.from_user or not callback.message:
        return
    await callback.answer()
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        user = await user_repo.get_or_create(callback.from_user.id, callback.from_user.username)
        user.state = None
        await session.commit()
        await _show_main_menu(callback.message, user_repo, user.id)


@router.callback_query(F.data == "menu_connect_wallet")
async def cb_menu_connect_wallet(callback: CallbackQuery) -> None:
    if not callback.from_user or not callback.message:
        return
    await callback.answer()
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        user = await user_repo.get_or_create(callback.from_user.id, callback.from_user.username)
        if user.is_banned:
            await callback.message.answer("Ваш аккаунт заблокирован администратором.")
            return
        user.state = "await_wallet"
        await session.commit()
    await callback.message.answer("Отправьте ваш TON адрес", reply_markup=back_menu_keyboard())


@router.callback_query(F.data == "menu_create_room")
async def cb_menu_create_room(callback: CallbackQuery) -> None:
    if not callback.from_user or not callback.message:
        return
    await callback.answer()
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        user = await user_repo.get_or_create(callback.from_user.id, callback.from_user.username)
        if user.is_banned:
            await callback.message.answer("Ваш аккаунт заблокирован администратором.")
            return
        if not user.wallet:
            await callback.message.answer("Сначала подключите кошелёк в главном меню.", reply_markup=main_menu_keyboard())
            return
        user.state = "await_create_amount"
        await session.commit()
    await callback.message.answer("Введите стоимость в TON (только цифры):", reply_markup=back_menu_keyboard())


@router.callback_query(F.data == "menu_my_rooms")
async def cb_menu_my_rooms(callback: CallbackQuery) -> None:
    if not callback.from_user or not callback.message:
        return
    await callback.answer()
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        room_repo = RoomRepo(session)
        user = await user_repo.get_or_create(callback.from_user.id, callback.from_user.username)
        if user.is_banned:
            await callback.message.answer("Ваш аккаунт заблокирован администратором.")
            return
        rooms = await room_repo.created_by_user(user.id)
        if not rooms:
            await callback.message.answer(
                "🏠 У вас пока нет комнат. Нажмите 'Создать комнату'",
                reply_markup=back_menu_keyboard(),
            )
            return
        items: list[tuple[str, int]] = []
        for room in rooms:
            number = await room_repo.local_room_number(user.id, room.id)
            items.append(
                (
                    f"🏠 Комната #{number} | 👥 {room_counter(room)} | 💸 Сумма: {format_ton(_amount_to_text(room.amount))}",
                    room.id,
                )
            )
        await callback.message.answer("🏠 Ваши комнаты:", reply_markup=room_list_keyboard(items))


@router.callback_query(F.data == "menu_rules")
async def cb_menu_rules(callback: CallbackQuery) -> None:
    if not callback.message:
        return
    await callback.answer()
    await callback.message.answer(RULES_TEXT, parse_mode="HTML", reply_markup=back_menu_keyboard())


@router.callback_query(F.data == "create_confirm_payment")
async def cb_create_confirm_payment(callback: CallbackQuery) -> None:
    if not callback.from_user or not callback.message:
        return
    await callback.answer()
    redis: Redis = router.data["redis"]
    settings: Settings = router.data["settings"]
    amount = await redis.get(f"pending:create_amount:{callback.from_user.id}")
    if not amount:
        await callback.message.answer(
            "Нет заявки на создание комнаты. Сначала нажмите «Создать комнату».",
            reply_markup=main_menu_keyboard(),
        )
        return
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        create_repo = CreateRequestRepo(session)
        user = await user_repo.get_or_create(callback.from_user.id, callback.from_user.username)
        if user.is_banned:
            await callback.message.answer("Ваш аккаунт заблокирован администратором.")
            return
        if not user.wallet:
            await callback.message.answer("Сначала подключите кошелёк.", reply_markup=main_menu_keyboard())
            return
        req = await create_repo.create(user.id, user.username, amount, user.wallet)
        await session.commit()
        wallet_text = user.wallet

    await redis.delete(f"pending:create_amount:{callback.from_user.id}")
    admin_text = (
        f"Пользователь [{format_user(callback.from_user.id, callback.from_user.username)}] хочет создать комнату\n"
        f"Сумма: {format_ton(amount)}\n"
        f"Кошелёк пользователя: {wallet_text}"
    )
    for admin_id in settings.admin_ids:
        await callback.bot.send_message(
            chat_id=admin_id,
            text=admin_text,
            reply_markup=admin_create_request_keyboard(req.id),
        )
    await callback.message.answer(
        "Заявка на подтверждение оплаты отправлена администратору.",
        reply_markup=back_menu_keyboard(),
    )


@router.callback_query(F.data.startswith("admin_create_confirm:") | F.data.startswith("admin_create_reject:"))
async def cb_admin_create_decision(callback: CallbackQuery) -> None:
    if not callback.from_user or not callback.message or not callback.data:
        return
    settings: Settings = router.data["settings"]
    if not _is_admin(settings, callback.from_user.id):
        await callback.answer("Это действие доступно только администратору.", show_alert=True)
        return
    await callback.answer()
    action, req_id_str = callback.data.split(":", 1)
    if not req_id_str.isdigit():
        return
    req_id = int(req_id_str)
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        create_repo = CreateRequestRepo(session)
        room_repo = RoomRepo(session)
        user_repo = UserRepo(session)
        req = await create_repo.get(req_id)
        if req is None or req.status != RequestStatus.PENDING:
            await callback.message.answer("Заявка уже обработана.")
            return
        creator = await user_repo.get(req.user_id)
        if action == "admin_create_confirm":
            if creator and creator.is_banned:
                req.status = RequestStatus.REJECTED
                await session.commit()
                await callback.message.answer("Пользователь в бане. Создание комнаты отклонено.")
                await callback.bot.send_message(
                    chat_id=req.user_id,
                    text="Вы в бане. Создание комнаты отклонено.",
                    reply_markup=main_menu_keyboard(),
                )
                return
            token = await build_room_token(room_repo)
            room = await room_repo.create(
                creator_id=req.user_id,
                creator_username=req.username,
                amount=_amount_to_text(req.amount),
                creator_wallet=req.wallet,
                token=token,
            )
            req.status = RequestStatus.CONFIRMED
            await session.commit()
            await callback.bot.send_message(
                chat_id=req.user_id,
                text="Комната успешно создана.",
                reply_markup=main_menu_keyboard(),
            )
            number = await room_repo.local_room_number(req.user_id, room.id)
            await callback.message.answer(f"Комната #{number} создана ({room_counter(room)}).")
            return
        req.status = RequestStatus.REJECTED
        await session.commit()
        await callback.bot.send_message(
            chat_id=req.user_id,
            text="Ваша заявка на создание комнаты отклонена.",
            reply_markup=main_menu_keyboard(),
        )
        await callback.message.answer("Заявка отклонена.")


@router.callback_query(F.data.startswith("room_show:"))
async def cb_room_show(callback: CallbackQuery) -> None:
    if not callback.from_user or not callback.message or not callback.data:
        return
    await callback.answer()
    room_id_str = callback.data.split(":", 1)[1]
    if not room_id_str.isdigit():
        return
    room_id = int(room_id_str)
    settings: Settings = router.data["settings"]
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        room_repo = RoomRepo(session)
        room = await room_repo.get_by_id(room_id)
        if room is None or room.creator_id != callback.from_user.id:
            await callback.message.answer("Комната не найдена.", reply_markup=back_menu_keyboard())
            return
        number = await room_repo.local_room_number(callback.from_user.id, room.id)
        if room.is_blocked:
            link_state = "Ссылка неактивна (комната заблокирована)"
            link = None
        elif room.is_open:
            link_state = "Ссылка активна"
            link = await room_link(settings.bot_username, room)
        else:
            link_state = "Ссылка неактивна (комната заполнена)"
            link = None
        text = (
            f"🏠 Комната #{number}\n"
            f"👥 Участники: {room_counter(room)}\n"
            f"Сумма: {format_ton(_amount_to_text(room.amount))}\n"
            f"👛 Кошелёк создателя: {room.creator_wallet}\n"
            f"🔗 {link_state}"
        )
        if link:
            text += f"\n{link}"
        await callback.message.answer(text, reply_markup=room_details_keyboard(link))


@router.callback_query(F.data.startswith("join_confirm_payment:"))
async def cb_join_confirm_payment(callback: CallbackQuery) -> None:
    if not callback.from_user or not callback.message or not callback.data:
        return
    await callback.answer()
    room_id_str = callback.data.split(":", 1)[1]
    if not room_id_str.isdigit():
        return
    room_id = int(room_id_str)
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        room_repo = RoomRepo(session)
        join_repo = JoinRequestRepo(session)
        joiner = await user_repo.get_or_create(callback.from_user.id, callback.from_user.username)
        if joiner.is_banned:
            await callback.message.answer("Ваш аккаунт заблокирован администратором.")
            return
        room = await room_repo.get_by_id(room_id)
        if room is None:
            await callback.message.answer("Комната не найдена.")
            return
        if room.is_blocked:
            await callback.message.answer(blocked_reason(room), reply_markup=back_menu_keyboard())
            return
        if not room.is_open or room.joined_count >= 2:
            await callback.message.answer("Ссылка неактивна (комната заполнена).", reply_markup=back_menu_keyboard())
            return
        if room.creator_id == joiner.id:
            await callback.message.answer("Вы не можете присоединиться к своей комнате.")
            return
        if await room_repo.has_participant(room.id, joiner.id):
            await callback.message.answer("Вы уже присоединились к этой комнате.", reply_markup=back_menu_keyboard())
            return
        if not joiner.wallet:
            await callback.message.answer(
                "Сначала подключите кошелёк в главном меню, затем подтвердите оплату снова.",
                reply_markup=main_menu_keyboard(),
            )
            return
        if await join_repo.has_pending(room.id, joiner.id):
            await callback.message.answer(
                "Ваша заявка уже ожидает подтверждения создателя комнаты.",
                reply_markup=back_menu_keyboard(),
            )
            return
        req = await join_repo.create(room.id, joiner.id, joiner.username)
        creator_number = await room_repo.local_room_number(room.creator_id, room.id)
        room_amount = _amount_to_text(room.amount)
        room_creator_id = room.creator_id
        await session.commit()

    await callback.bot.send_message(
        chat_id=room_creator_id,
        text=(
            f"Пользователь [{format_user(callback.from_user.id, callback.from_user.username)}] "
            f"хочет присоединиться к вашей комнате #{creator_number}\n"
            f"Сумма: {format_ton(room_amount)}"
        ),
        reply_markup=creator_join_request_keyboard(req.id),
    )
    await callback.message.answer(
        "Заявка на присоединение отправлена создателю комнаты.",
        reply_markup=back_menu_keyboard(),
    )


@router.callback_query(F.data.startswith("creator_join_confirm:") | F.data.startswith("creator_join_reject:"))
async def cb_creator_join_decision(callback: CallbackQuery) -> None:
    if not callback.from_user or not callback.message or not callback.data:
        return
    await callback.answer()
    action, req_id_str = callback.data.split(":", 1)
    if not req_id_str.isdigit():
        return
    req_id = int(req_id_str)
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        room_repo = RoomRepo(session)
        join_repo = JoinRequestRepo(session)
        req = await join_repo.get(req_id)
        if req is None or req.status != RequestStatus.PENDING:
            await callback.message.answer("Заявка уже обработана.")
            return
        room = await room_repo.get_by_id(req.room_id)
        if room is None:
            req.status = RequestStatus.REJECTED
            await session.commit()
            await callback.message.answer("Комната больше не существует.")
            return
        if callback.from_user.id != room.creator_id:
            await callback.answer("Подтверждать может только создатель комнаты.", show_alert=True)
            return
        joiner = await user_repo.get_or_create(req.joiner_id, req.joiner_username)
        if joiner.is_banned:
            req.status = RequestStatus.REJECTED
            await session.commit()
            await callback.message.answer("Пользователь забанен. Заявка отклонена.")
            return
        if action == "creator_join_confirm":
            if room.is_blocked:
                req.status = RequestStatus.REJECTED
                await session.commit()
                await callback.bot.send_message(
                    chat_id=joiner.id,
                    text="Комната заблокирована администратором. Ваша заявка отклонена.",
                    reply_markup=main_menu_keyboard(),
                )
                await callback.message.answer("Комната заблокирована администратором. Заявка отклонена.")
                return
            if not room.is_open or room.joined_count >= 2:
                req.status = RequestStatus.REJECTED
                await session.commit()
                await callback.bot.send_message(
                    chat_id=joiner.id,
                    text="Комната уже заполнена. Ваша заявка отклонена.",
                    reply_markup=main_menu_keyboard(),
                )
                await callback.message.answer("Комната уже заполнена. Заявка отклонена.")
                return
            req.status = RequestStatus.CONFIRMED
            await room_repo.add_participant(room, joiner.id, joiner.username)
            new_room = None
            if joiner.wallet:
                token = await build_room_token(room_repo)
                new_room = await room_repo.create(
                    creator_id=joiner.id,
                    creator_username=joiner.username,
                    amount=_amount_to_text(room.amount),
                    creator_wallet=joiner.wallet,
                    token=token,
                )
            await session.commit()
            joiner_text = "Оплата подтверждена. Вы присоединились к комнате."
            if new_room:
                joiner_num = await room_repo.local_room_number(joiner.id, new_room.id)
                joiner_text += (
                    "\n\nВам автоматически создана собственная комната:\n"
                    f"Комната #{joiner_num} | {room_counter(new_room)} | "
                    f"Сумма: {format_ton(_amount_to_text(new_room.amount))}\n"
                    f"Кошелёк: {joiner.wallet}\n"
                    "Откройте «Мои комнаты», чтобы увидеть ссылку."
                )
            await callback.bot.send_message(chat_id=joiner.id, text=joiner_text, reply_markup=main_menu_keyboard())
            creator_num = await room_repo.local_room_number(room.creator_id, room.id)
            link_status = "Ссылка неактивна." if not room.is_open else "Ссылка остаётся активной."
            await callback.message.answer(
                f"Пользователь {format_user(joiner.id, joiner.username)} добавлен. "
                f"Комната #{creator_num} теперь {room_counter(room)}. {link_status}"
            )
            return
        req.status = RequestStatus.REJECTED
        await session.commit()
        await callback.bot.send_message(
            chat_id=joiner.id,
            text="Ваша заявка на присоединение отклонена создателем комнаты.",
            reply_markup=main_menu_keyboard(),
        )
        await callback.message.answer("Заявка отклонена.")


@router.message(F.text.regexp(r"^/"))
async def ignore_unknown_commands(_: Message) -> None:
    return


@router.message(F.text)
async def handle_text_input(message: Message) -> None:
    if not message.from_user or not message.text:
        return
    redis: Redis = router.data["redis"]
    settings: Settings = router.data["settings"]
    session_factory = router.data["session_factory"]
    async with session_factory() as session:
        user_repo = UserRepo(session)
        user = await user_repo.get_or_create(message.from_user.id, message.from_user.username)
        if user.is_banned:
            await message.answer("Ваш аккаунт заблокирован администратором.")
            return
        text = message.text.strip()
        if user.state == "await_wallet":
            user.wallet = text
            user.state = None
            await session.commit()
            await message.answer(f"✅ 👛 Кошелёк подключен:\n{text}", reply_markup=main_menu_keyboard())
            return
        if user.state == "await_create_amount":
            amount = parse_amount(text)
            if amount is None:
                await message.answer(
                    "Введите корректную положительную сумму (только цифры).",
                    reply_markup=back_menu_keyboard(),
                )
                return
            user.state = None
            await session.commit()
            await redis.setex(f"pending:create_amount:{user.id}", 3600, amount)
            await message.answer(
                f"🏠 Комната будет создана на сумму {format_ton(amount)}.\n"
                "👛 Оплата на кошелёк:\n"
                f"{settings.main_wallet}",
                reply_markup=create_room_payment_keyboard(),
            )
            return
        await message.answer("Используйте кнопки меню ниже.", reply_markup=main_menu_keyboard())
