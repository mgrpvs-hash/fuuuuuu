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
room_id_counter = count(1)
create_request_counter = count(1)
join_request_counter = count(1)


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
        "is_open": True,
        "joined_count": 0,
        "joined_user_ids": set(),
    }
    created_rooms.setdefault(creator_id, set()).add(room_id)
    return room_id


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
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
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


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработка всех callback-кнопок."""
    query = update.callback_query
    user = update.effective_user
    if not query or not user:
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
            text="Правила пока пустые.",
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
        if room["is_open"]:
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

        if action == "creator_join_confirm":
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


def main() -> None:
    """Загрузка окружения и запуск бота."""
    load_dotenv()
    token = os.getenv("BOT_TOKEN")

    if not token:
        raise ValueError("BOT_TOKEN не найден. Добавьте его в .env файл.")

    application = Application.builder().token(token).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CallbackQueryHandler(handle_callback))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text_input))

    print("Бот запущен. Нажмите Ctrl+C для остановки.")
    application.run_polling()


if __name__ == "__main__":
    main()
