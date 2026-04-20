"""Телеграм-бот комнат с оплатой на python-telegram-bot."""

import logging
import os
from decimal import Decimal, InvalidOperation
from itertools import count
from typing import Any

from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

ADMIN_ID = 1400319960
MAIN_WALLET = "YmavmeImzjQ3CoUeW2GIqyoyUtT"
RULES_TEXT = (
    "<b>ПРАВИЛА ИГРЫ:</b>\n\n"
    "<b>Создание комнаты</b>\n"
    "Нажми «Создать комнату», введи сумму в TON\n"
    "Оплати создание комнаты.\n"
    "После оплаты ты получишь ссылку-приглашение.\n\n"
    "<b>Как работают ссылки</b>\n"
    "Твоя ссылка рассчитана на двух человек.\n"
    "Отправь ссылку ДВУМ разным людям.\n"
    "Каждый, кто перейдёт по ссылке, должен оплатить твоему кошельку указанную сумму.\n"
    "После оплаты ты получаешь уведомление и подтверждаешь добавление человека в комнату.\n\n"
    "<b>После двух участников</b>\n"
    "Когда оба человека оплатили и ты их подтвердил — комната заполнена.\n"
    "Ссылка становится неактивной.\n"
    "У каждого из присоединившихся автоматически создаётся их собственная комната с их ссылкой.\n\n"
    "<b>Твоя выгода</b>\n"
    "Деньги от двух присоединившихся идут на твой кошелёк.\n\n"
    "<b>ЗА ОБМАН — БЛОКИРОВКА</b>\n"
    "Если ты создал комнату, отправил ссылку, человек перевёл деньги, а ты отменил подтверждение "
    "или сказал, что деньги не пришли — все твои комнаты будут заблокированы.\n"
    "Человек, которого ты попытался обмануть, получит новую ссылку бесплатно.\n"
    "Если игрок попытается обмануть во второй раз — его аккаунт будет полностью заблокирован вместе "
    "со всеми комнатами.\n\n"
    "<b>Предупреждение о скамерах</b>\n"
    "⚠️ Проверяйте кошелёк в сообщении от бота.\n"
    "⚠️ Если вас обманули — сразу пишите администратору.\n\n"
    "<b>Администратор</b>\n"
    "Администратор имеет право заблокировать любую ссылку или пользователя без объяснения причин "
    "при явном нарушении."
)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)

# Хранилище в памяти.
user_wallets: dict[int, str] = {}
user_states: dict[int, str] = {}
pending_room_amounts: dict[int, str] = {}
rooms: dict[int, dict[str, Any]] = {}
created_rooms: dict[int, set[int]] = {}
create_requests: dict[int, dict[str, Any]] = {}
join_requests: dict[int, dict[str, Any]] = {}

# Новые структуры для админ-функций.
known_users: set[int] = set()
banned_users: set[int] = set()
blocked_rooms: set[int] = set()
room_block_reasons: dict[int, str] = {}

room_id_counter = count(1)
create_request_counter = count(1)
join_request_counter = count(1)


def это_админ(user_id: int) -> bool:
    """Проверка прав администратора."""
    return user_id == ADMIN_ID


def главное_меню() -> InlineKeyboardMarkup:
    """Клавиатура главного меню."""
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("Подключить кошелёк", callback_data="menu_connect_wallet")],
            [InlineKeyboardButton("Создать комнату", callback_data="menu_create_room")],
            [InlineKeyboardButton("Мои комнаты", callback_data="menu_my_rooms")],
            [InlineKeyboardButton("Правила", callback_data="menu_rules")],
        ]
    )


def кнопка_назад_в_меню() -> InlineKeyboardMarkup:
    """Клавиатура с кнопкой возврата в меню."""
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("Назад в меню", callback_data="menu_main")]]
    )


def показать_пользователя(user_id: int, username: str | None) -> str:
    """Строка идентификации пользователя."""
    if username:
        return f"@{username} / {user_id}"
    return str(user_id)


def сумма_ton(amount: str) -> str:
    """Отображение суммы с TON."""
    return f"{amount} TON"


def счетчик_комнаты(room: dict[str, Any]) -> str:
    """Счётчик участников без создателя: 0 из 2, 1 из 2, 2 из 2."""
    return f"{room['joined_count']} из 2"


def статус_комнаты(room: dict[str, Any]) -> str:
    """Краткий статус комнаты для админ-вывода."""
    return f"{room['joined_count']}/2"


def распарсить_сумму(raw_text: str) -> str | None:
    """Парсинг суммы, пользователь вводит только число."""
    try:
        amount_value = Decimal(raw_text.strip())
        if amount_value <= 0:
            return None
    except InvalidOperation:
        return None

    normalized = amount_value.normalize()
    if normalized == normalized.to_integral():
        return str(normalized.quantize(Decimal("1")))
    return format(normalized, "f")


def создать_комнату(
    creator_id: int, creator_username: str | None, amount: str, creator_wallet: str
) -> int:
    """Создание комнаты и регистрация в 'Мои комнаты' создателя."""
    room_id = next(room_id_counter)
    creator_name = f"@{creator_username}" if creator_username else str(creator_id)
    rooms[room_id] = {
        "id": room_id,
        "amount": amount,
        "creator_id": creator_id,
        "creator_name": creator_name,
        "creator_wallet": creator_wallet,
        "creator_username": creator_username,
        "is_open": True,
        "joined_count": 0,
        "joined_user_ids": set(),
        "joined_usernames": {},
    }
    created_rooms.setdefault(creator_id, set()).add(room_id)
    return room_id


def заблокировать_комнаты_пользователя(user_id: int) -> int:
    """Блокирует все комнаты пользователя. Возвращает количество."""
    count_blocked = 0
    for room_id in created_rooms.get(user_id, set()):
        room = rooms.get(room_id)
        if not room:
            continue
        if room_id not in blocked_rooms:
            count_blocked += 1
        blocked_rooms.add(room_id)
        room["is_open"] = False
        room_block_reasons[room_id] = "Комната заблокирована администратором."
    return count_blocked


async def отправить_главное_меню(
    context: ContextTypes.DEFAULT_TYPE, chat_id: int, text: str = "Главное меню:"
) -> None:
    """Отправка главного меню."""
    await context.bot.send_message(chat_id=chat_id, text=text, reply_markup=главное_меню())


async def имя_бота(context: ContextTypes.DEFAULT_TYPE) -> str:
    """Получить username бота для invite-ссылок."""
    username = context.bot.username
    if username:
        return username
    me = await context.bot.get_me()
    return me.username or "your_bot"


async def ссылка_комнаты(context: ContextTypes.DEFAULT_TYPE, room_id: int) -> str:
    """Сформировать ссылку комнаты."""
    bot_username = await имя_бота(context)
    return f"t.me/{bot_username}?start=room_{room_id}"


def пользователь_забанен(user_id: int) -> bool:
    """Проверка, забанен ли пользователь."""
    return user_id in banned_users


def комната_заблокирована(room_id: int) -> bool:
    """Проверка, заблокирована ли комната."""
    return room_id in blocked_rooms


def текст_причины_блокировки(room_id: int) -> str:
    """Текст причины блокировки комнаты."""
    return room_block_reasons.get(room_id, "Ссылка неактивна (комната заполнена).")


async def проверить_доступ_пользователя(update: Update) -> bool:
    """Общая проверка бана пользователя."""
    user = update.effective_user
    message = update.effective_message
    if not user:
        return False
    if пользователь_забанен(user.id):
        if message:
            await message.reply_text("Ваш аккаунт заблокирован администратором.")
        return False
    return True


async def показать_приглашение(
    update: Update, context: ContextTypes.DEFAULT_TYPE, room_id: int
) -> None:
    """Показ экрана присоединения по /start room_<id>."""
    user = update.effective_user
    message = update.effective_message
    if not user or not message:
        return

    room = rooms.get(room_id)
    if not room:
        await message.reply_text("Комната не найдена.", reply_markup=кнопка_назад_в_меню())
        return

    if комната_заблокирована(room_id):
        await message.reply_text(
            текст_причины_блокировки(room_id),
            reply_markup=кнопка_назад_в_меню(),
        )
        return

    if not room["is_open"] or room["joined_count"] >= 2:
        await message.reply_text(
            "Ссылка неактивна (комната заполнена).",
            reply_markup=кнопка_назад_в_меню(),
        )
        return

    if user.id == room["creator_id"]:
        await message.reply_text(
            "Вы создатель этой комнаты.", reply_markup=кнопка_назад_в_меню()
        )
        return

    if user.id in room["joined_user_ids"]:
        await message.reply_text(
            "Вы уже присоединились к этой комнате.", reply_markup=кнопка_назад_в_меню()
        )
        return

    text = (
        f"Вы присоединяетесь к комнате #{room_id}.\n"
        f"Сумма: {сумма_ton(room['amount'])}.\n"
        "Отправьте платеж на кошелёк создателя:\n"
        f"{room['creator_wallet']}"
    )
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("Подтвердить оплату", callback_data=f"join_confirm_payment:{room_id}")],
            [InlineKeyboardButton("Отмена", callback_data="menu_main")],
        ]
    )
    await message.reply_text(text, reply_markup=keyboard)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработка /start и payload ссылки комнаты."""
    user = update.effective_user
    message = update.effective_message
    if not user or not message:
        return

    known_users.add(user.id)
    if not await проверить_доступ_пользователя(update):
        return

    if context.args and context.args[0].startswith("room_"):
        room_token = context.args[0].replace("room_", "", 1)
        if room_token.isdigit():
            await показать_приглашение(update, context, int(room_token))
            return

    await message.reply_text("Главное меню:", reply_markup=главное_меню())


async def handle_text_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработка текстового ввода кошелька и суммы."""
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    known_users.add(user.id)
    if not await проверить_доступ_пользователя(update):
        return

    state = user_states.get(user.id)
    text = message.text.strip()

    if state == "await_wallet":
        user_wallets[user.id] = text
        user_states.pop(user.id, None)
        await message.reply_text(
            f"Кошелёк подключен:\n{text}",
            reply_markup=главное_меню(),
        )
        return

    if state == "await_create_amount":
        amount = распарсить_сумму(text)
        if not amount:
            await message.reply_text(
                "Введите корректную положительную сумму (только цифры).",
                reply_markup=кнопка_назад_в_меню(),
            )
            return

        pending_room_amounts[user.id] = amount
        user_states.pop(user.id, None)
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("Подтвердить оплату", callback_data="create_confirm_payment")],
                [InlineKeyboardButton("Назад в меню", callback_data="menu_main")],
            ]
        )
        await message.reply_text(
            (
                f"Комната будет создана на сумму {сумма_ton(amount)}.\n"
                "Оплата на кошелёк:\n"
                f"{MAIN_WALLET}"
            ),
            reply_markup=keyboard,
        )
        return

    await message.reply_text("Используйте кнопки меню ниже.", reply_markup=главное_меню())


def прочитать_id_из_аргумента(args: list[str]) -> int | None:
    """Парсинг целого ID из первого аргумента команды."""
    if not args:
        return None
    if not args[0].isdigit():
        return None
    return int(args[0])


async def только_админ(update: Update) -> bool:
    """Проверка, что команду вызывает администратор."""
    user = update.effective_user
    message = update.effective_message
    if not user:
        return False
    if not это_админ(user.id):
        if message:
            await message.reply_text("Эта команда доступна только администратору.")
        return False
    return True


async def cmd_my_id(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Показать ID текущего пользователя."""
    user = update.effective_user
    message = update.effective_message
    if not user or not message:
        return
    known_users.add(user.id)
    await message.reply_text(f"Ваш ID: {user.id}")


async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/stats — общая статистика."""
    if not await только_админ(update):
        return
    message = update.effective_message
    if not message:
        return

    total_users = len(known_users)
    total_rooms = len(rooms)
    total_amount = sum(Decimal(room["amount"]) for room in rooms.values()) if rooms else Decimal("0")
    total_amount_str = format(total_amount.normalize(), "f").rstrip("0").rstrip(".")
    if not total_amount_str:
        total_amount_str = "0"

    text = (
        "Статистика:\n"
        f"Всего пользователей: {total_users}\n"
        f"Всего комнат: {total_rooms}\n"
        f"Общая сумма всех комнат: {сумма_ton(total_amount_str)}"
    )
    await message.reply_text(text)


async def cmd_rooms(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/rooms — список всех комнат."""
    if not await только_админ(update):
        return
    message = update.effective_message
    if not message:
        return

    if not rooms:
        await message.reply_text("Комнат пока нет.")
        return

    lines = ["Все комнаты:"]
    for room_id in sorted(rooms):
        room = rooms[room_id]
        creator = показать_пользователя(room["creator_id"], room.get("creator_username"))
        status = статус_комнаты(room)
        block_mark = " [ЗАБЛОКИРОВАНА]" if комната_заблокирована(room_id) else ""
        lines.append(
            f"#{room_id} | {status} | {сумма_ton(room['amount'])} | {creator}{block_mark}"
        )
    await message.reply_text("\n".join(lines))


async def cmd_ban(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/ban <user_id> — бан пользователя + блок его комнат."""
    if not await только_админ(update):
        return
    message = update.effective_message
    if not message:
        return

    target_id = прочитать_id_из_аргумента(context.args)
    if target_id is None:
        await message.reply_text("Использование: /ban <user_id>")
        return
    if target_id == ADMIN_ID:
        await message.reply_text("Нельзя забанить самого администратора.")
        return

    banned_users.add(target_id)
    blocked_count = заблокировать_комнаты_пользователя(target_id)
    await message.reply_text(
        f"Пользователь {target_id} забанен. Заблокировано комнат: {blocked_count}."
    )


async def cmd_unban(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/unban <user_id> — разбан пользователя."""
    if not await только_админ(update):
        return
    message = update.effective_message
    if not message:
        return

    target_id = прочитать_id_из_аргумента(context.args)
    if target_id is None:
        await message.reply_text("Использование: /unban <user_id>")
        return

    if target_id in banned_users:
        banned_users.remove(target_id)
        await message.reply_text(f"Пользователь {target_id} разбанен.")
    else:
        await message.reply_text("Пользователь не был в бане.")


async def cmd_block_room(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/block_room <room_id> — блокировка комнаты."""
    if not await только_админ(update):
        return
    message = update.effective_message
    if not message:
        return

    room_id = прочитать_id_из_аргумента(context.args)
    if room_id is None:
        await message.reply_text("Использование: /block_room <room_id>")
        return
    room = rooms.get(room_id)
    if not room:
        await message.reply_text("Комната не найдена.")
        return

    blocked_rooms.add(room_id)
    room["is_open"] = False
    room_block_reasons[room_id] = "Комната заблокирована администратором."
    await message.reply_text(f"Комната #{room_id} заблокирована.")


async def cmd_unblock_room(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/unblock_room <room_id> — разблокировка комнаты."""
    if not await только_админ(update):
        return
    message = update.effective_message
    if not message:
        return

    room_id = прочитать_id_из_аргумента(context.args)
    if room_id is None:
        await message.reply_text("Использование: /unblock_room <room_id>")
        return
    room = rooms.get(room_id)
    if not room:
        await message.reply_text("Комната не найдена.")
        return

    if room["joined_count"] >= 2:
        await message.reply_text("Нельзя разблокировать заполненную комнату (2/2).")
        return
    if room["creator_id"] in banned_users:
        await message.reply_text("Нельзя разблокировать комнату забаненного пользователя.")
        return

    blocked_rooms.discard(room_id)
    room_block_reasons.pop(room_id, None)
    room["is_open"] = True
    await message.reply_text(f"Комната #{room_id} разблокирована.")


async def cmd_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/broadcast <текст> — рассылка всем пользователям."""
    if not await только_админ(update):
        return
    message = update.effective_message
    if not message:
        return
    if not context.args:
        await message.reply_text("Использование: /broadcast <текст>")
        return

    text = " ".join(context.args).strip()
    sent = 0
    failed = 0
    for user_id in sorted(known_users):
        try:
            await context.bot.send_message(chat_id=user_id, text=f"[Рассылка]\n{text}")
            sent += 1
        except Exception:
            failed += 1
    await message.reply_text(f"Рассылка завершена. Отправлено: {sent}, ошибок: {failed}.")


def формат_участников_комнаты(room: dict[str, Any]) -> str:
    """Сформировать список участников комнаты для debug."""
    if not room["joined_user_ids"]:
        return "нет"
    lines: list[str] = []
    for uid in sorted(room["joined_user_ids"]):
        uname = room["joined_usernames"].get(uid)
        lines.append(показать_пользователя(uid, uname))
    return "; ".join(lines)


async def cmd_debug_room(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/debug_room <room_id> — детальные данные по комнате."""
    if not await только_админ(update):
        return
    message = update.effective_message
    if not message:
        return

    room_id = прочитать_id_из_аргумента(context.args)
    if room_id is None:
        await message.reply_text("Использование: /debug_room <room_id>")
        return
    room = rooms.get(room_id)
    if not room:
        await message.reply_text("Комната не найдена.")
        return

    creator = показать_пользователя(room["creator_id"], room.get("creator_username"))
    participants = формат_участников_комнаты(room)
    link_active = "да" if (room["is_open"] and room["joined_count"] < 2 and room_id not in blocked_rooms) else "нет"
    is_blocked = "да" if room_id in blocked_rooms else "нет"

    text = (
        f"Debug комнаты #{room_id}\n"
        f"Создатель: {creator}\n"
        f"Участники: {participants}\n"
        f"Сумма: {сумма_ton(room['amount'])}\n"
        f"Статус: {статус_комнаты(room)}\n"
        f"Ссылка активна: {link_active}\n"
        f"Комната заблокирована: {is_blocked}"
    )
    await message.reply_text(text)


async def cmd_chain(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/chain <user_id> — комнаты пользователя и где он участвовал."""
    if not await только_админ(update):
        return
    message = update.effective_message
    if not message:
        return

    target_id = прочитать_id_из_аргумента(context.args)
    if target_id is None:
        await message.reply_text("Использование: /chain <user_id>")
        return

    created = sorted(created_rooms.get(target_id, set()))
    participated: list[int] = []
    for room_id, room in rooms.items():
        if target_id in room["joined_user_ids"]:
            participated.append(room_id)
    participated.sort()

    created_text = ", ".join(f"#{rid}" for rid in created) if created else "нет"
    part_text = ", ".join(f"#{rid}" for rid in participated) if participated else "нет"
    await message.reply_text(
        f"Цепочка пользователя {target_id}\n"
        f"Созданные комнаты: {created_text}\n"
        f"Участвовал в комнатах: {part_text}"
    )


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработка всех callback-кнопок."""
    query = update.callback_query
    user = update.effective_user
    if not query or not user:
        return

    known_users.add(user.id)
    if not await проверить_доступ_пользователя(update):
        return

    await query.answer()
    data = query.data or ""
    chat_id = query.message.chat_id if query.message else user.id

    if data == "menu_main":
        user_states.pop(user.id, None)
        await отправить_главное_меню(context, chat_id)
        return

    if data == "menu_connect_wallet":
        user_states[user.id] = "await_wallet"
        await context.bot.send_message(
            chat_id=chat_id,
            text="Отправьте адрес вашего кошелька.",
            reply_markup=кнопка_назад_в_меню(),
        )
        return

    if data == "menu_create_room":
        if user.id not in user_wallets:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Сначала подключите кошелёк в главном меню.",
                reply_markup=главное_меню(),
            )
            return
        user_states[user.id] = "await_create_amount"
        await context.bot.send_message(
            chat_id=chat_id,
            text="Введите стоимость в TON (только цифры):",
            reply_markup=кнопка_назад_в_меню(),
        )
        return

    if data == "menu_my_rooms":
        room_ids = sorted(created_rooms.get(user.id, set()))
        if not room_ids:
            await context.bot.send_message(
                chat_id=chat_id,
                text="У вас пока нет комнат.",
                reply_markup=кнопка_назад_в_меню(),
            )
            return

        keyboard_rows = []
        for room_id in room_ids:
            room = rooms.get(room_id)
            if not room:
                continue
            state = счетчик_комнаты(room)
            keyboard_rows.append(
                [
                    InlineKeyboardButton(
                        f"Комната #{room_id} | {state} | Сумма: {сумма_ton(room['amount'])}",
                        callback_data=f"room_show:{room_id}",
                    )
                ]
            )

        if not keyboard_rows:
            await context.bot.send_message(
                chat_id=chat_id,
                text="У вас пока нет комнат.",
                reply_markup=кнопка_назад_в_меню(),
            )
            return

        keyboard_rows.append([InlineKeyboardButton("Назад в меню", callback_data="menu_main")])
        await context.bot.send_message(
            chat_id=chat_id,
            text="Ваши комнаты:",
            reply_markup=InlineKeyboardMarkup(keyboard_rows),
        )
        return

    if data == "menu_rules":
        await context.bot.send_message(
            chat_id=chat_id,
            text=RULES_TEXT,
            parse_mode="HTML",
            reply_markup=кнопка_назад_в_меню(),
        )
        return

    if data == "create_confirm_payment":
        amount = pending_room_amounts.get(user.id)
        if not amount:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Нет заявки на создание комнаты. Сначала нажмите «Создать комнату».",
                reply_markup=главное_меню(),
            )
            return

        wallet = user_wallets.get(user.id, "Не указан")
        request_id = next(create_request_counter)
        create_requests[request_id] = {
            "user_id": user.id,
            "username": user.username,
            "amount": amount,
            "wallet": wallet,
            "status": "pending",
        }
        pending_room_amounts.pop(user.id, None)

        admin_text = (
            f"Пользователь [{показать_пользователя(user.id, user.username)}] хочет создать комнату\n"
            f"Сумма: {сумма_ton(amount)}\n"
            f"Кошелёк пользователя: {wallet}"
        )
        admin_keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton("Подтвердить", callback_data=f"admin_create_confirm:{request_id}"),
                    InlineKeyboardButton("Отклонить", callback_data=f"admin_create_reject:{request_id}"),
                ]
            ]
        )
        await context.bot.send_message(
            chat_id=ADMIN_ID,
            text=admin_text,
            reply_markup=admin_keyboard,
        )
        await context.bot.send_message(
            chat_id=chat_id,
            text="Заявка на подтверждение оплаты отправлена администратору.",
            reply_markup=кнопка_назад_в_меню(),
        )
        return

    if data.startswith("admin_create_confirm:") or data.startswith("admin_create_reject:"):
        if user.id != ADMIN_ID:
            await query.answer("Это действие доступно только администратору.", show_alert=True)
            return

        action, request_id_str = data.split(":", 1)
        if not request_id_str.isdigit():
            return
        request_id = int(request_id_str)
        request_data = create_requests.get(request_id)
        if not request_data or request_data["status"] != "pending":
            await context.bot.send_message(chat_id=chat_id, text="Заявка уже обработана.")
            return

        creator_id = request_data["user_id"]
        creator_username = request_data["username"]

        if action == "admin_create_confirm":
            if пользователь_забанен(creator_id):
                request_data["status"] = "rejected"
                await context.bot.send_message(
                    chat_id=chat_id,
                    text="Пользователь в бане. Создание комнаты отклонено.",
                )
                await context.bot.send_message(
                    chat_id=creator_id,
                    text="Вы в бане. Создание комнаты отклонено.",
                    reply_markup=главное_меню(),
                )
                return

            room_id = создать_комнату(
                creator_id=creator_id,
                creator_username=creator_username,
                amount=request_data["amount"],
                creator_wallet=request_data["wallet"],
            )
            request_data["status"] = "confirmed"

            await context.bot.send_message(
                chat_id=creator_id,
                text="Комната успешно создана.",
                reply_markup=главное_меню(),
            )
            await context.bot.send_message(
                chat_id=chat_id,
                text=f"Комната #{room_id} создана ({счетчик_комнаты(rooms[room_id])}).",
            )
            return

        request_data["status"] = "rejected"
        await context.bot.send_message(
            chat_id=creator_id,
            text="Ваша заявка на создание комнаты отклонена.",
            reply_markup=главное_меню(),
        )
        await context.bot.send_message(chat_id=chat_id, text="Заявка отклонена.")
        return

    if data.startswith("room_show:"):
        room_id_str = data.split(":", 1)[1]
        if not room_id_str.isdigit():
            return
        room_id = int(room_id_str)
        room = rooms.get(room_id)
        if not room or room_id not in created_rooms.get(user.id, set()):
            await context.bot.send_message(
                chat_id=chat_id,
                text="Комната не найдена.",
                reply_markup=кнопка_назад_в_меню(),
            )
            return

        counter = счетчик_комнаты(room)
        if комната_заблокирована(room_id):
            current_invite_link = "Ссылка неактивна (комната заблокирована)"
        elif room["is_open"]:
            current_invite_link = await ссылка_комнаты(context, room_id)
        else:
            current_invite_link = "Ссылка неактивна (комната заполнена)"

        text = (
            f"Комната #{room_id}\n"
            f"Участники: {counter}\n"
            f"Сумма: {сумма_ton(room['amount'])}\n"
            f"Кошелёк создателя: {room['creator_wallet']}\n"
            f"Ссылка: {current_invite_link}"
        )
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("Назад в мои комнаты", callback_data="menu_my_rooms")],
                [InlineKeyboardButton("Назад в меню", callback_data="menu_main")],
            ]
        )
        await context.bot.send_message(chat_id=chat_id, text=text, reply_markup=keyboard)
        return

    if data.startswith("join_confirm_payment:"):
        room_id_str = data.split(":", 1)[1]
        if not room_id_str.isdigit():
            return
        room_id = int(room_id_str)
        room = rooms.get(room_id)
        if not room:
            await context.bot.send_message(chat_id=chat_id, text="Комната не найдена.")
            return

        if комната_заблокирована(room_id):
            await context.bot.send_message(
                chat_id=chat_id,
                text=текст_причины_блокировки(room_id),
                reply_markup=кнопка_назад_в_меню(),
            )
            return

        if not room["is_open"] or room["joined_count"] >= 2:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Ссылка неактивна (комната заполнена).",
                reply_markup=кнопка_назад_в_меню(),
            )
            return

        if user.id == room["creator_id"]:
            await context.bot.send_message(chat_id=chat_id, text="Вы не можете присоединиться к своей комнате.")
            return

        if user.id in room["joined_user_ids"]:
            await context.bot.send_message(chat_id=chat_id, text="Вы уже присоединились к этой комнате.")
            return

        if user.id not in user_wallets:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Сначала подключите кошелёк в главном меню, затем подтвердите оплату снова.",
                reply_markup=главное_меню(),
            )
            return

        already_pending = any(
            req["status"] == "pending"
            and req["room_id"] == room_id
            and req["joiner_id"] == user.id
            for req in join_requests.values()
        )
        if already_pending:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Ваша заявка уже ожидает подтверждения создателя комнаты.",
                reply_markup=кнопка_назад_в_меню(),
            )
            return

        request_id = next(join_request_counter)
        join_requests[request_id] = {
            "room_id": room_id,
            "joiner_id": user.id,
            "joiner_username": user.username,
            "status": "pending",
        }

        creator_text = (
            f"Пользователь [{показать_пользователя(user.id, user.username)}] хочет присоединиться к вашей комнате #{room_id}\n"
            f"Сумма: {сумма_ton(room['amount'])}"
        )
        creator_keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "Подтвердить", callback_data=f"creator_join_confirm:{request_id}"
                    ),
                    InlineKeyboardButton(
                        "Отклонить", callback_data=f"creator_join_reject:{request_id}"
                    ),
                ]
            ]
        )
        await context.bot.send_message(
            chat_id=room["creator_id"],
            text=creator_text,
            reply_markup=creator_keyboard,
        )
        await context.bot.send_message(
            chat_id=chat_id,
            text="Заявка на присоединение отправлена создателю комнаты.",
            reply_markup=кнопка_назад_в_меню(),
        )
        return

    if data.startswith("creator_join_confirm:") or data.startswith("creator_join_reject:"):
        action, request_id_str = data.split(":", 1)
        if not request_id_str.isdigit():
            return
        request_id = int(request_id_str)
        request_data = join_requests.get(request_id)
        if not request_data or request_data["status"] != "pending":
            await context.bot.send_message(chat_id=chat_id, text="Заявка уже обработана.")
            return

        room = rooms.get(request_data["room_id"])
        if not room:
            request_data["status"] = "rejected"
            await context.bot.send_message(chat_id=chat_id, text="Комната больше не существует.")
            return

        if user.id != room["creator_id"]:
            await query.answer("Подтверждать может только создатель комнаты.", show_alert=True)
            return

        joiner_id = request_data["joiner_id"]
        joiner_username = request_data["joiner_username"]

        if пользователь_забанен(joiner_id):
            request_data["status"] = "rejected"
            await context.bot.send_message(chat_id=chat_id, text="Пользователь забанен. Заявка отклонена.")
            return

        if action == "creator_join_confirm":
            if комната_заблокирована(room["id"]):
                request_data["status"] = "rejected"
                await context.bot.send_message(
                    chat_id=chat_id,
                    text="Комната заблокирована администратором. Заявка отклонена.",
                )
                await context.bot.send_message(
                    chat_id=joiner_id,
                    text="Комната заблокирована администратором. Ваша заявка отклонена.",
                    reply_markup=главное_меню(),
                )
                return

            if not room["is_open"] or room["joined_count"] >= 2:
                request_data["status"] = "rejected"
                await context.bot.send_message(
                    chat_id=chat_id,
                    text="Комната уже заполнена. Заявка отклонена.",
                )
                await context.bot.send_message(
                    chat_id=joiner_id,
                    text="Комната уже заполнена. Ваша заявка отклонена.",
                    reply_markup=главное_меню(),
                )
                return

            request_data["status"] = "confirmed"
            room["joined_user_ids"].add(joiner_id)
            room["joined_usernames"][joiner_id] = joiner_username
            room["joined_count"] = len(room["joined_user_ids"])
            room["is_open"] = room["joined_count"] < 2

            joiner_wallet = user_wallets.get(joiner_id)
            new_room_id = None
            new_room_link = None
            if joiner_wallet:
                new_room_id = создать_комнату(
                    creator_id=joiner_id,
                    creator_username=joiner_username,
                    amount=room["amount"],
                    creator_wallet=joiner_wallet,
                )
                new_room_link = await ссылка_комнаты(context, new_room_id)

            joiner_text = f"Оплата подтверждена. Вы присоединились к комнате #{room['id']}."
            if new_room_id and new_room_link:
                joiner_text += (
                    "\n\nВам автоматически создана собственная комната:\n"
                    f"Комната #{new_room_id} | {счетчик_комнаты(rooms[new_room_id])} | "
                    f"Сумма: {сумма_ton(rooms[new_room_id]['amount'])}\n"
                    f"Кошелёк: {joiner_wallet}\n"
                    f"Ссылка: {new_room_link}"
                )
            await context.bot.send_message(
                chat_id=joiner_id,
                text=joiner_text,
                reply_markup=главное_меню(),
            )

            статус_ссылки = (
                "Ссылка неактивна."
                if not room["is_open"]
                else "Ссылка остаётся активной."
            )
            creator_text = (
                f"Пользователь {показать_пользователя(joiner_id, joiner_username)} добавлен. "
                f"Комната #{room['id']} теперь {счетчик_комнаты(room)}. {статус_ссылки}"
            )
            await context.bot.send_message(chat_id=chat_id, text=creator_text)
            return

        request_data["status"] = "rejected"
        await context.bot.send_message(
            chat_id=joiner_id,
            text="Ваша заявка на присоединение отклонена создателем комнаты.",
            reply_markup=главное_меню(),
        )
        await context.bot.send_message(chat_id=chat_id, text="Заявка отклонена.")
        return


def зарегистрировать_обработчики_команд(application: Application) -> None:
    """Регистрация command handlers."""
    application.add_handler(CommandHandler("start", start))

    # Админ-команды.
    application.add_handler(CommandHandler("my_id", cmd_my_id))
    application.add_handler(CommandHandler("stats", cmd_stats))
    application.add_handler(CommandHandler("rooms", cmd_rooms))
    application.add_handler(CommandHandler("ban", cmd_ban))
    application.add_handler(CommandHandler("unban", cmd_unban))
    application.add_handler(CommandHandler("block_room", cmd_block_room))
    application.add_handler(CommandHandler("unblock_room", cmd_unblock_room))
    application.add_handler(CommandHandler("broadcast", cmd_broadcast))
    application.add_handler(CommandHandler("debug_room", cmd_debug_room))
    application.add_handler(CommandHandler("chain", cmd_chain))

    # Callback и текст.
    application.add_handler(CallbackQueryHandler(handle_callback))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text_input))


def main() -> None:
    """Загрузка окружения и запуск бота."""
    load_dotenv()
    token = os.getenv("BOT_TOKEN")

    if not token:
        raise ValueError("BOT_TOKEN не найден. Добавьте его в .env файл.")

    application = Application.builder().token(token).build()
    зарегистрировать_обработчики_команд(application)

    print("Бот запущен. Нажмите Ctrl+C для остановки.")
    application.run_polling()


if __name__ == "__main__":
    main()
