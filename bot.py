"""Room/payment Telegram bot using python-telegram-bot."""

import logging
import os
from collections import defaultdict
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

# In-memory storage.
user_wallets: dict[int, str] = {}
user_states: dict[int, str] = {}
pending_room_amounts: dict[int, str] = {}
rooms: dict[int, dict[str, Any]] = {}
user_rooms: dict[int, set[int]] = defaultdict(set)
create_requests: dict[int, dict[str, Any]] = {}
join_requests: dict[int, dict[str, Any]] = {}
room_id_counter = count(1)
create_request_counter = count(1)
join_request_counter = count(1)


def main_menu_markup() -> InlineKeyboardMarkup:
    """Main menu keyboard."""
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("Connect Wallet", callback_data="menu_connect_wallet")],
            [InlineKeyboardButton("Create Room", callback_data="menu_create_room")],
            [InlineKeyboardButton("My Rooms", callback_data="menu_my_rooms")],
            [InlineKeyboardButton("Rules", callback_data="menu_rules")],
        ]
    )


def back_to_menu_markup() -> InlineKeyboardMarkup:
    """Single button keyboard to return to main menu."""
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton("Back to Menu", callback_data="menu_main")]]
    )


def format_user_display(user_id: int, username: str | None) -> str:
    """Return readable user identifier."""
    if username:
        return f"@{username} / {user_id}"
    return str(user_id)


async def send_main_menu(
    context: ContextTypes.DEFAULT_TYPE, chat_id: int, text: str = "Main menu:"
) -> None:
    """Send main menu message."""
    await context.bot.send_message(chat_id=chat_id, text=text, reply_markup=main_menu_markup())


async def get_bot_username(context: ContextTypes.DEFAULT_TYPE) -> str:
    """Fetch bot username for invite links."""
    username = context.bot.username
    if username:
        return username
    me = await context.bot.get_me()
    return me.username or "your_bot"


async def show_join_invite(
    update: Update, context: ContextTypes.DEFAULT_TYPE, room_id: int
) -> None:
    """Show invite information when user opens /start room_<id>."""
    user = update.effective_user
    message = update.effective_message
    if not user or not message:
        return

    room = rooms.get(room_id)
    if not room:
        await message.reply_text("Room not found.", reply_markup=back_to_menu_markup())
        return

    if user.id == room["creator_id"]:
        await message.reply_text(
            "You are the creator of this room.", reply_markup=back_to_menu_markup()
        )
        return

    if user.id in room["members"]:
        await message.reply_text(
            "You are already in this room.", reply_markup=back_to_menu_markup()
        )
        return

    text = (
        f"You joined a room created by {room['creator_name']}\n"
        f"Amount: {room['amount']}\n\n"
        "To join this room, send payment to this wallet:\n"
        f"{room['creator_wallet']}"
    )
    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "Confirm Payment", callback_data=f"join_confirm_payment:{room_id}"
                )
            ],
            [InlineKeyboardButton("Cancel", callback_data="menu_main")],
        ]
    )
    await message.reply_text(text, reply_markup=keyboard)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start and optional invite payload."""
    message = update.effective_message
    user = update.effective_user
    if not message or not user:
        return

    if context.args and context.args[0].startswith("room_"):
        room_token = context.args[0].replace("room_", "", 1)
        if room_token.isdigit():
            await show_join_invite(update, context, int(room_token))
            return

    await message.reply_text("Main menu:", reply_markup=main_menu_markup())


async def handle_text_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle text input for wallet and amount collection."""
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
            f"Wallet connected:\n{text}",
            reply_markup=main_menu_markup(),
        )
        return

    if state == "await_create_amount":
        try:
            amount_value = Decimal(text)
            if amount_value <= 0:
                raise InvalidOperation
        except InvalidOperation:
            await message.reply_text(
                "Please enter a valid positive amount.",
                reply_markup=back_to_menu_markup(),
            )
            return

        amount = format(amount_value, "f").rstrip("0").rstrip(".")
        if not amount:
            amount = "0"
        pending_room_amounts[user.id] = amount
        user_states.pop(user.id, None)
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("Confirm Payment", callback_data="create_confirm_payment")],
                [InlineKeyboardButton("Back to Menu", callback_data="menu_main")],
            ]
        )
        await message.reply_text(
            (
                f"Room will be created for {amount}.\n"
                "To create the room, send payment to:\n"
                f"{MAIN_WALLET}"
            ),
            reply_markup=keyboard,
        )
        return

    await message.reply_text("Use the menu below.", reply_markup=main_menu_markup())


async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle all inline keyboard callbacks."""
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
            text="Send your wallet address.",
            reply_markup=back_to_menu_markup(),
        )
        return

    if data == "menu_create_room":
        if user.id not in user_wallets:
            await context.bot.send_message(
                chat_id=chat_id,
                text="Connect wallet first from the main menu.",
                reply_markup=main_menu_markup(),
            )
            return
        user_states[user.id] = "await_create_amount"
        await context.bot.send_message(
            chat_id=chat_id,
            text="Enter amount for the room.",
            reply_markup=back_to_menu_markup(),
        )
        return

    if data == "menu_my_rooms":
        room_ids = sorted(user_rooms.get(user.id, set()))
        if not room_ids:
            await context.bot.send_message(
                chat_id=chat_id,
                text="You have no rooms yet.",
                reply_markup=back_to_menu_markup(),
            )
            return

        keyboard_rows = [
            [
                InlineKeyboardButton(
                    f"Room #{room_id} | Amount {rooms[room_id]['amount']}",
                    callback_data=f"room_show:{room_id}",
                )
            ]
            for room_id in room_ids
            if room_id in rooms
        ]
        keyboard_rows.append([InlineKeyboardButton("Back to Menu", callback_data="menu_main")])
        await context.bot.send_message(
            chat_id=chat_id,
            text="Your rooms:",
            reply_markup=InlineKeyboardMarkup(keyboard_rows),
        )
        return

    if data == "menu_rules":
        await context.bot.send_message(
            chat_id=chat_id,
            text="Rules are empty.",
            reply_markup=back_to_menu_markup(),
        )
        return

    if data == "create_confirm_payment":
        amount = pending_room_amounts.get(user.id)
        if not amount:
            await context.bot.send_message(
                chat_id=chat_id,
                text="No pending room creation request. Choose Create Room first.",
                reply_markup=main_menu_markup(),
            )
            return

        wallet = user_wallets.get(user.id, "Not set")
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
            f"User [{format_user_display(user.id, user.username)}] wants to create room\n"
            f"Amount: {amount}\n"
            f"User wallet: {wallet}"
        )
        admin_keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "Confirm", callback_data=f"admin_create_confirm:{request_id}"
                    ),
                    InlineKeyboardButton(
                        "Reject", callback_data=f"admin_create_reject:{request_id}"
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
            text="Payment confirmation request sent to admin.",
            reply_markup=back_to_menu_markup(),
        )
        return

    if data.startswith("admin_create_confirm:") or data.startswith("admin_create_reject:"):
        if user.id != ADMIN_ID:
            await query.answer("Only admin can do this.", show_alert=True)
            return

        action, request_id_str = data.split(":", 1)
        if not request_id_str.isdigit():
            return
        request_id = int(request_id_str)
        request_data = create_requests.get(request_id)
        if not request_data or request_data["status"] != "pending":
            await context.bot.send_message(chat_id=chat_id, text="Request already handled.")
            return

        creator_id = request_data["user_id"]
        creator_username = request_data["username"]

        if action == "admin_create_confirm":
            room_id = next(room_id_counter)
            creator_name = (
                f"@{creator_username}" if creator_username else str(request_data["user_id"])
            )
            rooms[room_id] = {
                "id": room_id,
                "amount": request_data["amount"],
                "creator_id": creator_id,
                "creator_name": creator_name,
                "creator_wallet": request_data["wallet"],
                "members": {creator_id},
            }
            user_rooms[creator_id].add(room_id)
            request_data["status"] = "confirmed"

            await context.bot.send_message(
                chat_id=creator_id,
                text="Room created successfully",
                reply_markup=main_menu_markup(),
            )
            await context.bot.send_message(
                chat_id=chat_id,
                text=f"Room #{room_id} created.",
            )
            return

        request_data["status"] = "rejected"
        await context.bot.send_message(
            chat_id=creator_id,
            text="Your room creation request was rejected.",
            reply_markup=main_menu_markup(),
        )
        await context.bot.send_message(chat_id=chat_id, text="Request rejected.")
        return

    if data.startswith("room_show:"):
        room_id_str = data.split(":", 1)[1]
        if not room_id_str.isdigit():
            return
        room_id = int(room_id_str)
        room = rooms.get(room_id)
        if not room or room_id not in user_rooms.get(user.id, set()):
            await context.bot.send_message(
                chat_id=chat_id,
                text="Room not found.",
                reply_markup=back_to_menu_markup(),
            )
            return

        bot_username = await get_bot_username(context)
        invite_link = f"t.me/{bot_username}?start=room_{room_id}"
        text = (
            f"Room #{room_id}\n"
            f"Amount: {room['amount']}\n"
            f"User wallet: {room['creator_wallet']}\n"
            f"Invite link: {invite_link}"
        )
        keyboard = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("Back to My Rooms", callback_data="menu_my_rooms")],
                [InlineKeyboardButton("Back to Menu", callback_data="menu_main")],
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
            await context.bot.send_message(chat_id=chat_id, text="Room not found.")
            return

        if user.id == room["creator_id"]:
            await context.bot.send_message(chat_id=chat_id, text="You cannot join your own room.")
            return

        if user.id in room["members"]:
            await context.bot.send_message(chat_id=chat_id, text="You already joined this room.")
            return

        request_id = next(join_request_counter)
        join_requests[request_id] = {
            "room_id": room_id,
            "joiner_id": user.id,
            "joiner_username": user.username,
            "status": "pending",
        }

        creator_text = (
            f"User [{format_user_display(user.id, user.username)}] wants to join your room\n"
            f"Amount: {room['amount']}"
        )
        creator_keyboard = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        "Confirm", callback_data=f"creator_join_confirm:{request_id}"
                    ),
                    InlineKeyboardButton(
                        "Reject", callback_data=f"creator_join_reject:{request_id}"
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
            text="Join request sent to room creator.",
            reply_markup=back_to_menu_markup(),
        )
        return

    if data.startswith("creator_join_confirm:") or data.startswith("creator_join_reject:"):
        action, request_id_str = data.split(":", 1)
        if not request_id_str.isdigit():
            return
        request_id = int(request_id_str)
        request_data = join_requests.get(request_id)
        if not request_data or request_data["status"] != "pending":
            await context.bot.send_message(chat_id=chat_id, text="Request already handled.")
            return

        room = rooms.get(request_data["room_id"])
        if not room:
            request_data["status"] = "rejected"
            await context.bot.send_message(chat_id=chat_id, text="Room does not exist anymore.")
            return

        if user.id != room["creator_id"]:
            await query.answer("Only room creator can do this.", show_alert=True)
            return

        joiner_id = request_data["joiner_id"]
        if action == "creator_join_confirm":
            request_data["status"] = "confirmed"
            room["members"].add(joiner_id)
            user_rooms[joiner_id].add(room["id"])
            await context.bot.send_message(
                chat_id=joiner_id,
                text="Payment confirmed. You joined the room",
                reply_markup=main_menu_markup(),
            )
            await context.bot.send_message(chat_id=chat_id, text="User added to room.")
            return

        request_data["status"] = "rejected"
        await context.bot.send_message(
            chat_id=joiner_id,
            text="Your join request was rejected.",
            reply_markup=main_menu_markup(),
        )
        await context.bot.send_message(chat_id=chat_id, text="Join request rejected.")
        return


def main() -> None:
    """Load environment variables and run the bot."""
    load_dotenv()
    token = os.getenv("BOT_TOKEN")

    if not token:
        raise ValueError("BOT_TOKEN not found. Add it to your .env file before running the bot.")

    application = Application.builder().token(token).build()
    application.add_handler(CommandHandler("start", start))
    application.add_handler(CallbackQueryHandler(handle_callback))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text_input))

    print("Bot is running. Press Ctrl+C to stop.")
    application.run_polling()


if __name__ == "__main__":
    main()
