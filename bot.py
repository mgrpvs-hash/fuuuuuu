"""Телеграм-бот комнат с оплатой на python-telegram-bot."""

import logging
import os
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


def main_menu_markup() -> InlineKeyboardMarkup:
    """Клавиатура главного меню."""
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("Подключить кошелёк", callback_data="menu_connect_wallet")],
            [InlineKeyboardButton("Создать комнату", callback_data="menu_create_room")],
            [InlineKeyboardButton("Мои комнаты", callback_data="menu_my_rooms")],
            [InlineKeyboardButton("Правила", callback_data="menu_rules")],
        ]
    )


def back_to_menu_markup() -> InlineKeyboardMarkup:
    """Кнопка возврата в меню."""
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("Назад в меню", callback_data="menu_main")]]
    )


def user_display_name(user_id: int, username: str | None) -> str:
    """Отображаемое имя пользователя."""
    if username:
        return f"@{username}"
    return str(user_id)


def amount_ton(amount: str) -> str:
    """Сумма в формате TON."""
    return f"{amount} TON"


def participant_counter(room: dict[str, Any]) -> str:
    """Счётчик присоединившихся участников (создатель не считается)."""
    return f"{room['joined_count']} из 2"


def parse_amount_digits(text: str) -> str | None:
    """Парсинг суммы: только положительные целые цифры."""
    raw = text.strip()
    if not raw.isdigit():
        return None
    value = int(raw)
    if value <= 0:
        return None
    return str(value)


def create_room_record(
    creator_id: int, creator_username: str | None, amount: str, creator_wallet: str
) -> int:
    """Создать комнату и привязать к создателю."""
    room_id = next(room_id_counter)
    rooms[room_id] = {
        "id": room_id,
        "amount": amount,
        "creator_id": creator_id,
        "creator_name": user_display_name(creator_id, creator_username),
        "creator_wallet": creator_wallet,
        "joined_count": 0,  # создатель не входит в счётчик
        "joined_user_id": None,
        "is_open": True,
    }
    created_rooms.setdefault(creator_id, set()).add(room_id)
    return room_id


async def send_main_menu(
    context: ContextTypes.DEFAULT_TYPE, chat_id: int, text: str = "Главное меню:"
) -> None:
    """Отправить главное меню."""
    await context.bot.send_message(chat_id=chat_id, text=text, reply_markup=main_menu_markup())


async def get_bot_username(context: ContextTypes.DEFAULT_TYPE) -> str:
    """Получить username бота для ссылок."""
    if context.bot.username:
        return context.bot.username
    me = await context.bot.get_me()
    return me.username or "your_bot"


async def build_invite_link(context: ContextTypes.DEFAULT_TYPE, room_id: int) -> str:
    """Собрать ссылку приглашения."""
    bot_username = await get_bot_username(context)
    return f"t.me/{bot_username}?start=room_{room_id}"


async def show_join_invite(
    update: Update, context: ContextTypes.DEFAULT_TYPE, room_id: int
) -> None:
    """Показать экран присоединения по ссылке."""
    user = update.effective_user
    message = update.effective_message
    if not user or not message:
        return

    room = rooms.get(room_id)
    if not room:
        await message.reply_text("Комната не найдена.", reply_markup=back_to_menu_markup())
        return

    if not room["is_open"]:
        await message.reply_text(
            "Ссылка неактивна (комната заполнена)",
            reply_markup=back_to_menu_markup(),
        )
        return

    if user.id == room["creator_id"]:
        await message.reply_text(
            "Вы создатель этой комнаты.",
            reply_markup=back_to_menu_markup(),
        )
        return

    if user.id == room["joined_user_id"]:
        await message.reply_text(
            "Вы уже присоединились к этой комнате.",
            reply_markup=back_to_menu_markup(),
        )
        return

    text = (
        f"Вы присоединяетесь к комнате #{room_id}.\n"
        f"Сумма: {amount_ton(room['amount'])}.\n"
        "Отправьте платеж на кошелёк создателя:\n"
        f"{room['creator_wallet']}"
    )
    keyboard = InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("Подтвердить оплату", callback_data=f"join_confirm:{room_id}")],
            [InlineKeyboardButton("Отмена", callback_data="menu_main")],
        ]
    )
    await message.reply_text(text, reply_markup=keyboard)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик /start и room-параметров."""
    message = update.effective_message
    if not message:
        return

    if context.args and context.args[0].startswith("room_"):
        room_token = context.args[0].replace("room_", "", 1)
        if room_token.isdigit():
            await show_join_invite(update, context, int(room_token))
            return

    await message.reply_text("Главное меню:", reply_markup=main_menu_markup())


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработка текстовых шагов (кошелёк/сумма)."""
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
            f"Кошелёк сохранён:\n{text}",
            reply_markup=main_menu_markup(),
        )
        return

    if state == "await_amount":
        amount = parse_amount_digits(text)
        if not amount:
            await message.reply_text(
                "Введите стоимость комнаты в TON (только цифры):",
                reply_markup=back_to_menu_markup(),
            )
            return

        pending_room_amounts[user.id] = amount
        user_states.pop(user.id, None)
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("Подтвердить оплату", callback_data="create_confirm")],
                [InlineKeyboardButton("Назад в меню", callback_data="menu_main")],
            ]
        )
        await message.reply_text(
            (
                f"Комната будет создана на сумму {amount_ton(amount)}.\n"
                "Оплата на кошелёк:\n"
                f"{MAIN_WALLET}"
            ),
            reply_markup=keyboard,
        )
        return

    await message.reply_text("Выберите действие в меню ниже.", reply_markup=main_menu_markup())


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
        await send_main_menu(context, chat_id)
        return

    if data == "menu_connect_wallet":
        user_states[user.id] = "await_wallet"
        await context.bot.send_message(
            chat_id=chat_id,
            text="Отправьте адрес вашего кошелька:",
            reply_markup=back_to_menu_markup(),
        )
        return

    if data == "menu_create_room":
        if user.id not in user_wallets:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Сначала подключите кошелёк в главном меню.",
                reply_markup=main_menu_markup(),
            )
            return
        user_states[user.id] = "await_amount"
        await context.bot.send_message(
            chat_id=chat_id,
            text="Введите стоимость комнаты в TON (только цифры):",
            reply_markup=back_to_menu_markup(),
        )
        return

    if data == "menu_my_rooms":
        room_ids = sorted(created_rooms.get(user.id, set()))
        if not room_ids:
            await context.bot.send_message(
                chat_id=chat_id,
                text="У вас пока нет созданных комнат.",
                reply_markup=back_to_menu_markup(),
            )
            return

        keyboard_rows = []
        for room_id in room_ids:
            room = rooms.get(room_id)
            if not room:
                continue
            keyboard_rows.append(
                [
                    InlineKeyboardButton(
                        (
                            f"Комната #{room_id} | {participant_counter(room)} | "
                            f"Сумма: {amount_ton(room['amount'])}"
                        ),
                        callback_data=f"room_show:{room_id}",
                    )
                ]
            )

        if not keyboard_rows:
            await context.bot.send_message(
                chat_id=chat_id,
                text="У вас пока нет созданных комнат.",
                reply_markup=back_to_menu_markup(),
            )
            return

        keyboard_rows.append([InlineKeyboardButton("Назад в меню", callback_data="menu_main")])
        await context.bot.send_message(
            chat_id=chat_id,
            text="Мои комнаты:",
            reply_markup=InlineKeyboardMarkup(keyboard_rows),
        )
        return

    if data == "menu_rules":
        await context.bot.send_message(
            chat_id=chat_id,
            text="Правила пока пустые.",
            reply_markup=back_to_menu_markup(),
        )
        return

    if data == "create_confirm":
        amount = pending_room_amounts.get(user.id)
        if not amount:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Нет ожидающего запроса. Сначала создайте комнату.",
                reply_markup=main_menu_markup(),
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
            f"Пользователь {user_display_name(user.id, user.username)} хочет создать комнату\n"
            f"Сумма: {amount_ton(amount)}\n"
            f"Кошелёк пользователя: {wallet}"
        )
        admin_keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "Подтвердить", callback_data=f"admin_create_confirm:{request_id}"
                    ),
                    InlineKeyboardButton(
                        "Отклонить", callback_data=f"admin_create_reject:{request_id}"
                    ),
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
            text="Запрос отправлен администратору.",
            reply_markup=back_to_menu_markup(),
        )
        return

    if data.startswith("admin_create_confirm:") or data.startswith("admin_create_reject:"):
        if user.id != ADMIN_ID:
            await query.answer("Только админ может это сделать.", show_alert=True)
            return

        action, request_id_str = data.split(":", 1)
        if not request_id_str.isdigit():
            return
        request_id = int(request_id_str)
        request_data = create_requests.get(request_id)
        if not request_data or request_data["status"] != "pending":
            await context.bot.send_message(chat_id=chat_id, text="Запрос уже обработан.")
            return

        creator_id = request_data["user_id"]
        creator_username = request_data["username"]

        if action == "admin_create_confirm":
            room_id = create_room_record(
                creator_id=creator_id,
                creator_username=creator_username,
                amount=request_data["amount"],
                creator_wallet=request_data["wallet"],
            )
            request_data["status"] = "confirmed"
            link = await build_invite_link(context, room_id)

            await context.bot.send_message(
                chat_id=creator_id,
                text=(
                    f"Комната создана успешно.\n"
                    f"Комната #{room_id} | {participant_counter(rooms[room_id])} | "
                    f"Сумма: {amount_ton(rooms[room_id]['amount'])}\n"
                    f"Ссылка: {link}"
                ),
                reply_markup=main_menu_markup(),
            )
            await context.bot.send_message(chat_id=chat_id, text=f"Комната #{room_id} создана.")
            return

        request_data["status"] = "rejected"
        await context.bot.send_message(
            chat_id=creator_id,
            text="Запрос на создание комнаты отклонён.",
            reply_markup=main_menu_markup(),
        )
        await context.bot.send_message(chat_id=chat_id, text="Запрос отклонён.")
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
                reply_markup=back_to_menu_markup(),
            )
            return

        if room["is_open"]:
            link_text = await build_invite_link(context, room_id)
        else:
            link_text = "Ссылка неактивна (комната заполнена)"

        text = (
            f"Комната #{room_id}\n"
            f"Участники: {participant_counter(room)}\n"
            f"Сумма: {amount_ton(room['amount'])}\n"
            f"Кошелёк создателя: {room['creator_wallet']}\n"
            f"Ссылка: {link_text}"
        )
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("Назад к комнатам", callback_data="menu_my_rooms")],
                [InlineKeyboardButton("Назад в меню", callback_data="menu_main")],
            ]
        )
        await context.bot.send_message(chat_id=chat_id, text=text, reply_markup=keyboard)
        return

    if data.startswith("join_confirm:"):
        room_id_str = data.split(":", 1)[1]
        if not room_id_str.isdigit():
            return
        room_id = int(room_id_str)
        room = rooms.get(room_id)
        if not room:
            await context.bot.send_message(chat_id=chat_id, text="Комната не найдена.")
            return

        if not room["is_open"] or room["joined_count"] >= 1:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Ссылка неактивна (комната заполнена)",
                reply_markup=back_to_menu_markup(),
            )
            return

        if user.id == room["creator_id"]:
            await context.bot.send_message(chat_id=chat_id, text="Вы создатель этой комнаты.")
            return

        if user.id == room["joined_user_id"]:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Вы уже присоединились к этой комнате.",
            )
            return

        if user.id not in user_wallets:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Сначала подключите кошелёк в главном меню, затем повторите подтверждение.",
                reply_markup=main_menu_markup(),
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
                text="Ваш запрос уже отправлен администратору.",
                reply_markup=back_to_menu_markup(),
            )
            return

        request_id = next(join_request_counter)
        join_requests[request_id] = {
            "room_id": room_id,
            "joiner_id": user.id,
            "joiner_username": user.username,
            "status": "pending",
        }

        admin_text = (
            f"Пользователь {user_display_name(user.id, user.username)} хочет присоединиться\n"
            f"Комната #{room_id}\n"
            f"Сумма: {amount_ton(room['amount'])}\n"
            f"Кошелёк создателя: {room['creator_wallet']}\n"
            f"Кошелёк присоединяющегося: {user_wallets.get(user.id)}"
        )
        admin_keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "Подтвердить", callback_data=f"admin_join_confirm:{request_id}"
                    ),
                    InlineKeyboardButton(
                        "Отклонить", callback_data=f"admin_join_reject:{request_id}"
                    ),
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
            text="Запрос на присоединение отправлен администратору.",
            reply_markup=back_to_menu_markup(),
        )
        return

    if data.startswith("admin_join_confirm:") or data.startswith("admin_join_reject:"):
        if user.id != ADMIN_ID:
            await query.answer("Только админ может это сделать.", show_alert=True)
            return

        action, request_id_str = data.split(":", 1)
        if not request_id_str.isdigit():
            return
        request_id = int(request_id_str)
        request_data = join_requests.get(request_id)
        if not request_data or request_data["status"] != "pending":
            await context.bot.send_message(chat_id=chat_id, text="Запрос уже обработан.")
            return

        room = rooms.get(request_data["room_id"])
        if not room:
            request_data["status"] = "rejected"
            await context.bot.send_message(chat_id=chat_id, text="Комната больше не существует.")
            return

        joiner_id = request_data["joiner_id"]
        joiner_username = request_data["joiner_username"]
        joiner_name = user_display_name(joiner_id, joiner_username)

        if action == "admin_join_confirm":
            if not room["is_open"] or room["joined_count"] >= 1:
                request_data["status"] = "rejected"
                await context.bot.send_message(
                    chat_id=joiner_id,
                    text="Ссылка неактивна (комната заполнена)",
                    reply_markup=main_menu_markup(),
                )
                await context.bot.send_message(chat_id=chat_id, text="Комната уже заполнена.")
                return

            request_data["status"] = "confirmed"
            room["joined_count"] = 1
            room["joined_user_id"] = joiner_id
            room["is_open"] = False

            # Сообщение создателю исходной комнаты.
            await context.bot.send_message(
                chat_id=room["creator_id"],
                text=(
                    f"Пользователь {joiner_name} добавлен. "
                    f"Комната #{room['id']} теперь {participant_counter(room)}. "
                    "Ссылка неактивна."
                ),
            )

            # Автосоздание комнаты для присоединившегося пользователя (цепочка).
            joiner_wallet = user_wallets.get(joiner_id)
            new_room_id = None
            new_room_link = None
            if joiner_wallet:
                new_room_id = create_room_record(
                    creator_id=joiner_id,
                    creator_username=joiner_username,
                    amount=room["amount"],
                    creator_wallet=joiner_wallet,
                )
                new_room_link = await build_invite_link(context, new_room_id)

            joiner_text = "Оплата подтверждена. Вы присоединились к комнате."
            if new_room_id and new_room_link:
                joiner_text += (
                    f"\n\nДля вас автоматически создана собственная комната:\n"
                    f"Комната #{new_room_id} | {participant_counter(rooms[new_room_id])} | "
                    f"Сумма: {amount_ton(rooms[new_room_id]['amount'])}\n"
                    f"Кошелёк: {rooms[new_room_id]['creator_wallet']}\n"
                    f"Ссылка: {new_room_link}"
                )
            else:
                joiner_text += (
                    "\n\nНе удалось создать вашу комнату автоматически: кошелёк не найден."
                )

            await context.bot.send_message(
                chat_id=joiner_id,
                text=joiner_text,
                reply_markup=main_menu_markup(),
            )
            await context.bot.send_message(
                chat_id=chat_id,
                text=(
                    f"Пользователь {joiner_name} добавлен. "
                    f"Комната #{room['id']} теперь {participant_counter(room)}. "
                    "Ссылка неактивна."
                ),
            )
            return

        request_data["status"] = "rejected"
        await context.bot.send_message(
            chat_id=joiner_id,
            text="Запрос на присоединение отклонён администратором.",
            reply_markup=main_menu_markup(),
        )
        await context.bot.send_message(chat_id=chat_id, text="Запрос отклонён.")
        return


def main() -> None:
    """Запуск бота."""
    load_dotenv()
    token = os.getenv("BOT_TOKEN")

    if not token:
        raise ValueError("BOT_TOKEN не найден. Добавьте его в .env.")

    application = Application.builder().token(token).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CallbackQueryHandler(handle_callback))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

    print("Бот запущен. Для остановки нажмите Ctrl+C.")
    application.run_polling()


if __name__ == "__main__":
    main()
