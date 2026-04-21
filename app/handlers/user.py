"""User and callback handlers."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import (
    CallbackQuery,
    CopyTextButton,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from app.keyboards import back_to_menu_markup, main_menu_markup
from app.services.logic import BotService
from app.services.state import CreateAmountState, WalletState

router = Router(name="user")


@router.message(F.text.startswith("/start"))
async def cmd_start(message: Message, state: FSMContext, service: BotService) -> None:
    if not message.from_user or not message.text:
        return
    await state.clear()

    user = await service.get_or_create_user(message.from_user.id, message.from_user.username)
    if user.is_banned:
        await message.answer("❌ Ваш аккаунт заблокирован администратором.")
        return

    parts = message.text.split(maxsplit=1)
    if len(parts) > 1 and parts[1].startswith("room_"):
        identifier = parts[1].replace("room_", "", 1)
        room = await service.get_room_by_identifier(identifier)
        if not room:
            await message.answer("❌ 🏠 Комната не найдена.", reply_markup=back_to_menu_markup())
            return
        if room.is_blocked:
            await message.answer(
                "❌ Комната заблокирована администратором.",
                reply_markup=back_to_menu_markup(),
            )
            return
        if not room.is_open or room.joined_count >= 2:
            await message.answer(
                "❌ 🔗 Ссылка неактивна (комната заполнена).",
                reply_markup=back_to_menu_markup(),
            )
            return
        if room.creator.tg_id == user.tg_id:
            await message.answer(
                "❌ Вы не можете присоединиться к своей комнате.",
                reply_markup=back_to_menu_markup(),
            )
            return
        if await service.has_participant(room.id, user.id):
            await message.answer(
                "✅ Вы уже участвуете в этой комнате.",
                reply_markup=back_to_menu_markup(),
            )
            return

        local_name = await service.local_room_name(room.creator_id, room.id)
        join_markup = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="✅ Подтвердить оплату",
                        callback_data=f"join_confirm_payment:{room.id}",
                    )
                ],
                [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_main")],
            ]
        )
        await message.answer(
            "\n".join(
                [
                    f"🏠 Вы присоединяетесь к {local_name.lower()}.",
                    f"💸 Сумма: {service.amount_ton(room.amount)}",
                    "👛 Отправьте платеж на кошелёк создателя:",
                    room.creator_wallet,
                ]
            ),
            reply_markup=join_markup,
        )
        return

    wallet_text = (
        f"👛 Ваш кошелёк: {user.wallet_address}"
        if user.wallet_address
        else "👛 Кошелёк не подключен"
    )
    await message.answer(f"Главное меню\n\n{wallet_text}", reply_markup=main_menu_markup())


@router.callback_query(F.data == "menu_main")
async def cb_menu_main(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.clear()
    if callback.message:
        await callback.message.answer("🏠 Главное меню", reply_markup=main_menu_markup())


@router.callback_query(F.data == "menu_connect_wallet")
async def cb_connect_wallet(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.answer()
    await state.set_state(WalletState.waiting_wallet)
    if callback.message:
        await callback.message.answer("Отправьте ваш TON адрес", reply_markup=back_to_menu_markup())


@router.message(WalletState.waiting_wallet)
async def wallet_input(message: Message, state: FSMContext, service: BotService) -> None:
    if not message.from_user or not message.text:
        return
    user = await service.get_or_create_user(message.from_user.id, message.from_user.username)
    if user.is_banned:
        await state.clear()
        await message.answer("❌ Ваш аккаунт заблокирован администратором.")
        return
    await service.set_wallet(user.id, message.text.strip())
    await state.clear()
    await message.answer(
        f"✅ 👛 Кошелёк подключен:\n{message.text.strip()}",
        reply_markup=main_menu_markup(),
    )


@router.callback_query(F.data == "menu_create_room")
async def cb_create_room(callback: CallbackQuery, state: FSMContext, service: BotService) -> None:
    await callback.answer()
    if not callback.from_user:
        return
    user = await service.get_or_create_user(callback.from_user.id, callback.from_user.username)
    if user.is_banned:
        if callback.message:
            await callback.message.answer("❌ Ваш аккаунт заблокирован администратором.")
        return
    if not user.wallet_address:
        if callback.message:
            await callback.message.answer(
                "❌ Сначала подключите кошелёк в главном меню.",
                reply_markup=main_menu_markup(),
            )
        return
    await state.set_state(CreateAmountState.waiting_amount)
    if callback.message:
        await callback.message.answer(
            "Введите стоимость комнаты в TON (только цифры):",
            reply_markup=back_to_menu_markup(),
        )


@router.message(CreateAmountState.waiting_amount)
async def amount_input(message: Message, state: FSMContext, service: BotService) -> None:
    if not message.text:
        return
    amount = service.parse_amount(message.text)
    if amount is None:
        await message.answer(
            "❌ Введите корректную положительную сумму (например, 100).",
            reply_markup=back_to_menu_markup(),
        )
        return
    await state.update_data(room_amount=str(amount))

    confirm_markup = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✅ Подтвердить оплату", callback_data="create_confirm_payment")],
            [InlineKeyboardButton(text="🔙 Назад", callback_data="menu_main")],
        ]
    )
    await message.answer(
        "\n".join(
            [
                f"🏠 Комната будет создана на сумму {service.amount_ton(amount)}.",
                "👛 Оплата на кошелёк:",
                service.main_wallet,
            ]
        ),
        reply_markup=confirm_markup,
    )


@router.callback_query(F.data == "create_confirm_payment")
async def create_confirm(callback: CallbackQuery, state: FSMContext, service: BotService) -> None:
    await callback.answer()
    if not callback.from_user:
        return

    state_data = await state.get_data()
    amount_raw = state_data.get("room_amount")
    amount = service.parse_amount(str(amount_raw)) if amount_raw is not None else None
    if amount is None:
        if callback.message:
            await callback.message.answer(
                "❌ Нет активной заявки. Нажмите «Создать комнату» снова.",
                reply_markup=main_menu_markup(),
            )
        return

    user = await service.get_or_create_user(callback.from_user.id, callback.from_user.username)
    if user.is_banned:
        if callback.message:
            await callback.message.answer("❌ Ваш аккаунт заблокирован администратором.")
        return
    if not user.wallet_address:
        if callback.message:
            await callback.message.answer(
                "❌ Кошелёк не подключен. Сначала подключите кошелёк.",
                reply_markup=main_menu_markup(),
            )
        return

    request = await service.create_room_request(user, amount)
    await state.clear()
    if callback.message:
        await callback.message.answer(
            "✅ Заявка на подтверждение оплаты отправлена администратору.",
            reply_markup=back_to_menu_markup(),
        )

    admin_markup = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="✅ Подтвердить",
                    callback_data=f"admin_create_confirm:{request.id}",
                ),
                InlineKeyboardButton(
                    text="❌ Отклонить",
                    callback_data=f"admin_create_reject:{request.id}",
                ),
            ]
        ]
    )
    text = (
        f"Пользователь {service.user_display(user)} хочет создать комнату.\n"
        f"💸 Сумма: {service.amount_ton(request.amount)}\n"
        f"👛 Кошелёк пользователя: {request.wallet_snapshot}"
    )
    for admin_tg_id in service.admin_tg_ids:
        await callback.bot.send_message(chat_id=admin_tg_id, text=text, reply_markup=admin_markup)


@router.callback_query(F.data.startswith("admin_create_confirm:") | F.data.startswith("admin_create_reject:"))
async def cb_admin_create_request(callback: CallbackQuery, service: BotService) -> None:
    await callback.answer()
    if not callback.from_user or not callback.data:
        return
    if callback.from_user.id not in service.admin_tg_ids:
        await callback.answer("Команда доступна только администраторам.", show_alert=True)
        return

    action, req_id_str = callback.data.split(":", 1)
    if not req_id_str.isdigit():
        return
    request = await service.get_create_request(int(req_id_str))
    if not request or request.status != "pending":
        if callback.message:
            await callback.message.answer("❌ Заявка уже обработана.")
        return

    if action == "admin_create_confirm":
        try:
            room = await service.approve_create_request(request)
        except ValueError as exc:
            if callback.message:
                await callback.message.answer(str(exc))
            return
        await callback.bot.send_message(
            chat_id=request.user.tg_id,
            text="✅ Комната успешно создана.",
            reply_markup=main_menu_markup(),
        )
        if callback.message:
            await callback.message.answer(
                f"✅ Комната {service.room_global_identifier(room)} создана ({room.joined_count} из 2)."
            )
    else:
        await service.reject_create_request(request)
        await callback.bot.send_message(
            chat_id=request.user.tg_id,
            text="❌ Ваша заявка на создание комнаты отклонена.",
            reply_markup=main_menu_markup(),
        )
        if callback.message:
            await callback.message.answer("❌ Заявка отклонена.")


@router.callback_query(F.data == "menu_my_rooms")
async def cb_my_rooms(callback: CallbackQuery, service: BotService) -> None:
    await callback.answer()
    if not callback.from_user or not callback.message:
        return

    user = await service.get_or_create_user(callback.from_user.id, callback.from_user.username)
    if user.is_banned:
        await callback.message.answer("❌ Ваш аккаунт заблокирован администратором.")
        return

    rooms = await service.get_user_rooms(user.id)
    if not rooms:
        await callback.message.answer(
            "🏠 У вас пока нет комнат. Нажмите 'Создать комнату'",
            reply_markup=back_to_menu_markup(),
        )
        return

    rows = []
    for index, room in enumerate(rooms, start=1):
        rows.append(
            [
                InlineKeyboardButton(
                    text=(
                        f"🏠 Комната #{index} | "
                        f"👥 {service.participants_label(room)} | "
                        f"💸 {service.amount_ton(room.amount)}"
                    ),
                    callback_data=f"room_show:{room.id}",
                )
            ]
        )
    rows.append([InlineKeyboardButton(text="🔙 Назад", callback_data="menu_main")])
    await callback.message.answer(
        "🏠 Ваши комнаты",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
    )


@router.callback_query(F.data.startswith("room_show:"))
async def cb_room_show(callback: CallbackQuery, service: BotService) -> None:
    await callback.answer()
    if not callback.from_user or not callback.message or not callback.data:
        return

    room_id_str = callback.data.split(":", 1)[1]
    if not room_id_str.isdigit():
        return
    room = await service.get_room_by_id(int(room_id_str))
    if not room or room.creator.tg_id != callback.from_user.id:
        await callback.message.answer("❌ Комната не найдена.", reply_markup=back_to_menu_markup())
        return

    room_name = await service.local_room_name(room.creator_id, room.id)
    if room.is_blocked:
        link_state = "Ссылка неактивна (комната заблокирована)"
        active_link = None
    elif room.is_open and room.joined_count < 2:
        link_state = "Ссылка активна"
        active_link = await service.room_link(callback.bot, room)
    else:
        link_state = "Ссылка неактивна (комната заполнена)"
        active_link = None

    rows = []
    if active_link:
        rows.append(
            [
                InlineKeyboardButton(
                    text="📋 Скопировать ссылку",
                    callback_data="copy_room_link",
                    copy_text=CopyTextButton(text=active_link),
                )
            ]
        )
    rows.append([InlineKeyboardButton(text="🔙 Назад в мои комнаты", callback_data="menu_my_rooms")])
    rows.append([InlineKeyboardButton(text="🔙 Назад", callback_data="menu_main")])

    await callback.message.answer(
        "\n".join(
            [
                f"🏠 {room_name}",
                f"👥 Участники: {service.participants_label(room)}",
                f"💸 Сумма: {service.amount_ton(room.amount)}",
                f"👛 Кошелёк создателя: {room.creator_wallet}",
                f"🔗 {link_state}",
            ]
        ),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
    )


@router.callback_query(F.data == "copy_room_link")
async def cb_copy_link(callback: CallbackQuery) -> None:
    await callback.answer("✅ Ссылка скопирована")


@router.callback_query(F.data.startswith("join_confirm_payment:"))
async def cb_join_confirm(callback: CallbackQuery, service: BotService) -> None:
    await callback.answer()
    if not callback.from_user or not callback.message or not callback.data:
        return

    room_id_str = callback.data.split(":", 1)[1]
    if not room_id_str.isdigit():
        return
    room = await service.get_room_by_id(int(room_id_str))
    if not room:
        await callback.message.answer("❌ Комната не найдена.")
        return

    joiner = await service.get_or_create_user(callback.from_user.id, callback.from_user.username)
    if joiner.is_banned:
        await callback.message.answer("❌ Ваш аккаунт заблокирован администратором.")
        return

    try:
        request = await service.create_join_request(joiner, room)
    except ValueError as exc:
        await callback.message.answer(str(exc), reply_markup=back_to_menu_markup())
        return

    creator_markup = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="✅ Подтвердить",
                    callback_data=f"creator_join_confirm:{request.id}",
                ),
                InlineKeyboardButton(
                    text="❌ Отклонить",
                    callback_data=f"creator_join_reject:{request.id}",
                ),
            ]
        ]
    )
    await callback.bot.send_message(
        chat_id=room.creator.tg_id,
        text=(
            f"Пользователь {service.user_display(joiner)} хочет присоединиться к вашей комнате.\n"
            f"💸 Сумма: {service.amount_ton(room.amount)}"
        ),
        reply_markup=creator_markup,
    )
    await callback.message.answer(
        "✅ Заявка на присоединение отправлена создателю комнаты.",
        reply_markup=back_to_menu_markup(),
    )


@router.callback_query(F.data.startswith("creator_join_confirm:"))
async def cb_creator_join_confirm(callback: CallbackQuery, service: BotService) -> None:
    await callback.answer()
    if not callback.from_user or not callback.message or not callback.data:
        return
    req_id_str = callback.data.split(":", 1)[1]
    if not req_id_str.isdigit():
        return

    request = await service.get_join_request(int(req_id_str))
    if not request or request.status != "pending":
        await callback.message.answer("❌ Заявка уже обработана.")
        return
    if request.room.creator.tg_id != callback.from_user.id:
        await callback.answer("Подтверждать может только создатель комнаты.", show_alert=True)
        return

    try:
        new_room = await service.approve_join_request(request)
    except ValueError as exc:
        await callback.message.answer(str(exc))
        return

    room = await service.get_room_by_id(request.room_id)
    if not room:
        await callback.message.answer("❌ Комната не найдена.")
        return

    room_name = await service.local_room_name(room.creator_id, room.id)
    link_status = "Ссылка неактивна." if not room.is_open else "Ссылка остаётся активной."
    await callback.message.answer(
        f"✅ Пользователь {service.user_display(request.joiner)} добавлен. "
        f"{room_name} теперь {service.participants_label(room)}. {link_status}"
    )

    joiner_text = "✅ Оплата подтверждена. Вы присоединились к комнате."
    if new_room:
        joiner_local = await service.local_room_name(new_room.creator_id, new_room.id)
        joiner_text += (
            "\n\nВам автоматически создана собственная комната:\n"
            f"{joiner_local} | {service.participants_label(new_room)} | "
            f"💸 {service.amount_ton(new_room.amount)}\n"
            f"👛 Кошелёк: {new_room.creator_wallet}\n"
            "Откройте «Мои комнаты», чтобы увидеть ссылку."
        )
    await callback.bot.send_message(
        chat_id=request.joiner.tg_id,
        text=joiner_text,
        reply_markup=main_menu_markup(),
    )


@router.callback_query(F.data.startswith("creator_join_reject:"))
async def cb_creator_join_reject(callback: CallbackQuery, service: BotService) -> None:
    await callback.answer()
    if not callback.from_user or not callback.message or not callback.data:
        return
    req_id_str = callback.data.split(":", 1)[1]
    if not req_id_str.isdigit():
        return

    request = await service.get_join_request(int(req_id_str))
    if not request or request.status != "pending":
        await callback.message.answer("❌ Заявка уже обработана.")
        return
    if request.room.creator.tg_id != callback.from_user.id:
        await callback.answer("Отклонять может только создатель комнаты.", show_alert=True)
        return

    await service.reject_join_request(request)
    await callback.message.answer("❌ Заявка отклонена.")
    await callback.bot.send_message(
        chat_id=request.joiner.tg_id,
        text="❌ Ваша заявка на присоединение отклонена создателем комнаты.",
        reply_markup=main_menu_markup(),
    )


@router.callback_query(F.data == "menu_rules")
async def cb_rules(callback: CallbackQuery, service: BotService) -> None:
    await callback.answer()
    if callback.message:
        await callback.message.answer(service.rules_text, reply_markup=back_to_menu_markup())


@router.message(F.text & ~F.text.startswith("/"))
async def fallback(message: Message) -> None:
    await message.answer("Используйте кнопки меню ниже.", reply_markup=main_menu_markup())
