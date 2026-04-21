"""Inline keyboards for bot menus."""

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup


def main_menu_markup() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Подключить кошелёк", callback_data="menu_connect_wallet")],
            [InlineKeyboardButton(text="Создать комнату", callback_data="menu_create_room")],
            [InlineKeyboardButton(text="Мои комнаты", callback_data="menu_my_rooms")],
            [InlineKeyboardButton(text="Правила", callback_data="menu_rules")],
        ]
    )


def back_to_menu_markup() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="🔙 Назад", callback_data="menu_main")]]
    )
