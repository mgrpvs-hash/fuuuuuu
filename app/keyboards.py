from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup


def main_menu_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Подключить кошелёк", callback_data="menu_connect_wallet")],
            [InlineKeyboardButton(text="Создать комнату", callback_data="menu_create_room")],
            [InlineKeyboardButton(text="Мои комнаты", callback_data="menu_my_rooms")],
            [InlineKeyboardButton(text="Правила", callback_data="menu_rules")],
        ]
    )


def back_menu_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="🔙 Назад", callback_data="menu_main")]]
    )


def back_to_menu_keyboard() -> InlineKeyboardMarkup:
    return back_menu_keyboard()


def join_invite_keyboard(room_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Подтвердить оплату",
                    callback_data=f"join_confirm_payment:{room_id}",
                )
            ],
            [InlineKeyboardButton(text="Отмена", callback_data="menu_main")],
        ]
    )


def create_room_payment_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Подтвердить оплату", callback_data="create_confirm_payment")],
            [InlineKeyboardButton(text="Назад в меню", callback_data="menu_main")],
        ]
    )


def admin_create_request_keyboard(request_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Подтвердить",
                    callback_data=f"admin_create_confirm:{request_id}",
                ),
                InlineKeyboardButton(
                    text="Отклонить",
                    callback_data=f"admin_create_reject:{request_id}",
                ),
            ]
        ]
    )


def creator_join_request_keyboard(request_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Подтвердить",
                    callback_data=f"creator_join_confirm:{request_id}",
                ),
                InlineKeyboardButton(
                    text="Отклонить",
                    callback_data=f"creator_join_reject:{request_id}",
                ),
            ]
        ]
    )


def room_list_keyboard(rows: list[tuple[str, int]]) -> InlineKeyboardMarkup:
    keyboard_rows = [
        [InlineKeyboardButton(text=text, callback_data=f"room_show:{room_id}")]
        for text, room_id in rows
    ]
    keyboard_rows.append([InlineKeyboardButton(text="Назад в меню", callback_data="menu_main")])
    return InlineKeyboardMarkup(inline_keyboard=keyboard_rows)


def room_details_keyboard(link: str | None) -> InlineKeyboardMarkup:
    _ = link
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Назад в мои комнаты", callback_data="menu_my_rooms")],
            [InlineKeyboardButton(text="Назад в меню", callback_data="menu_main")],
        ]
    )
