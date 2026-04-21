"""Business logic service."""

from __future__ import annotations

import secrets
import string
from decimal import Decimal, InvalidOperation
from typing import Any

from aiogram import Bot
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import CreateRequest, JoinRequest, Room, User
from app.keyboards import main_menu_markup
from app.services.repositories import (
    AdminRepository,
    RequestRepository,
    RoomRepository,
    UserRepository,
)


class BotService:
    """Facade over repositories with room-chain business logic."""

    alphabet = string.ascii_letters + string.digits

    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.users = UserRepository(session)
        self.rooms = RoomRepository(session)
        self.requests = RequestRepository(session)
        self.admin = AdminRepository(session)

    @property
    def admin_tg_ids(self) -> set[int]:
        return self.settings.admin_ids

    @property
    def main_wallet(self) -> str:
        return self.settings.main_wallet

    @property
    def rules_text(self) -> str:
        return self.settings.rules_text.strip() or "Правила пока не добавлены."

    @staticmethod
    def parse_amount(raw_text: str) -> Decimal | None:
        try:
            value = Decimal(raw_text.strip().replace(",", "."))
        except InvalidOperation:
            return None
        if value <= 0:
            return None
        return value.normalize()

    @staticmethod
    def amount_ton(amount: Decimal | str) -> str:
        value = Decimal(amount) if isinstance(amount, str) else amount
        text = format(value.normalize(), "f").rstrip("0").rstrip(".")
        return f"{text or '0'} TON"

    @staticmethod
    def user_display(user: User) -> str:
        if user.username:
            return f"@{user.username} (ID: {user.tg_id})"
        return f"ID: {user.tg_id}"

    @staticmethod
    def room_global_identifier(room: Room) -> str:
        return room.token or str(room.id)

    @staticmethod
    def participants_label(room: Room) -> str:
        return f"{room.joined_count} из 2"

    async def has_participant(self, room_id: int, user_id: int) -> bool:
        return await self.rooms.participant_exists(room_id, user_id)

    async def get_or_create_user(self, tg_id: int, username: str | None) -> User:
        return await self.users.get_or_create_user(tg_id, username)

    async def set_wallet(self, user_id: int, wallet: str) -> None:
        user = await self.users.get_user(user_id)
        if user:
            await self.users.set_wallet(user, wallet)

    async def _generate_room_token(self) -> str:
        while True:
            token = "".join(secrets.choice(self.alphabet) for _ in range(8))
            if not await self.rooms.get_room_by_token(token):
                return token

    async def create_room_request(self, user: User, amount: Decimal) -> CreateRequest:
        wallet = user.wallet_address or ""
        return await self.requests.create_room_request(user.id, amount, wallet)

    async def get_create_request(self, request_id: int) -> CreateRequest | None:
        return await self.requests.get_create_request(request_id)

    async def approve_create_request(self, req: CreateRequest) -> Room:
        if req.status != "pending":
            raise ValueError("Заявка уже обработана.")
        creator = await self.users.get_user(req.user_id)
        if creator is None or not creator.wallet_address:
            raise ValueError("У пользователя не подключен кошелёк.")
        req.status = "confirmed"
        await self.session.flush()
        return await self.rooms.create_room(
            creator_id=creator.id,
            creator_username=creator.username,
            amount=req.amount,
            creator_wallet=creator.wallet_address,
            token=await self._generate_room_token(),
        )

    async def reject_create_request(self, req: CreateRequest) -> None:
        req.status = "rejected"
        await self.session.flush()

    async def get_room_by_id(self, room_id: int) -> Room | None:
        return await self.rooms.get_room(room_id)

    async def get_room_by_identifier(self, identifier: str) -> Room | None:
        return await self.rooms.get_room_by_identifier(identifier)

    async def get_user_rooms(self, user_id: int) -> list[Room]:
        return list(await self.rooms.list_creator_rooms(user_id))

    async def get_local_room_index(self, creator_id: int, room_id: int) -> int | None:
        room_ids = await self.rooms.list_creator_room_ids(creator_id)
        try:
            return room_ids.index(room_id) + 1
        except ValueError:
            return None

    async def local_room_name(self, creator_id: int, room_id: int) -> str:
        idx = await self.get_local_room_index(creator_id, room_id)
        return f"Комната #{idx}" if idx else "Комната"

    async def room_link(self, bot: Bot, room: Room) -> str:
        username = self.settings.bot_username
        if not username:
            me = await bot.get_me()
            username = me.username or "your_bot"
        return f"t.me/{username}?start=room_{self.room_global_identifier(room)}"

    async def create_join_request(self, joiner: User, room: Room) -> JoinRequest:
        if joiner.id == room.creator_id:
            raise ValueError("Вы создатель этой комнаты.")
        if joiner.is_banned:
            raise ValueError("Ваш аккаунт заблокирован администратором.")
        if room.is_blocked:
            raise ValueError("Комната заблокирована администратором.")
        if not room.is_open or room.joined_count >= 2:
            raise ValueError("❌ 🔗 Ссылка неактивна (комната заполнена).")
        if await self.rooms.participant_exists(room.id, joiner.id):
            raise ValueError("✅ Вы уже присоединились к этой комнате.")
        return await self.requests.create_join_request(room.id, joiner.id)

    async def get_join_request(self, request_id: int) -> JoinRequest | None:
        return await self.requests.get_join_request(request_id)

    async def approve_join_request(self, req: JoinRequest) -> Room | None:
        if req.status != "pending":
            raise ValueError("Заявка уже обработана.")
        room = await self.rooms.get_room(req.room_id)
        joiner = await self.users.get_user(req.joiner_id)
        if room is None or joiner is None:
            raise ValueError("Комната или пользователь не найдены.")
        if room.is_blocked:
            req.status = "rejected"
            await self.session.flush()
            raise ValueError("Комната заблокирована администратором.")
        if not room.is_open or room.joined_count >= 2:
            req.status = "rejected"
            await self.session.flush()
            raise ValueError("Комната уже заполнена.")
        if await self.rooms.participant_exists(room.id, joiner.id):
            req.status = "rejected"
            await self.session.flush()
            raise ValueError("✅ Вы уже присоединились к этой комнате.")

        await self.rooms.add_participant(room, joiner)
        room.joined_count = min(room.joined_count + 1, 2)
        room.is_open = room.joined_count < 2
        req.status = "confirmed"
        await self.session.flush()

        if joiner.wallet_address:
            return await self.rooms.create_room(
                creator_id=joiner.id,
                creator_username=joiner.username,
                amount=room.amount,
                creator_wallet=joiner.wallet_address,
                token=await self._generate_room_token(),
            )
        return None

    async def reject_join_request(self, req: JoinRequest) -> None:
        req.status = "rejected"
        await self.session.flush()

    async def get_stats(self) -> dict[str, Any]:
        return {
            "users_count": await self.users.count_users(),
            "rooms_count": await self.rooms.count_rooms(),
            "total_amount": await self.rooms.total_room_amount(),
        }

    async def admin_rooms_lines(self) -> list[str]:
        rooms = await self.rooms.list_all_rooms()
        if not rooms:
            return ["Список комнат пуст."]
        lines = ["🏠 Все комнаты:"]
        for room in rooms:
            creator = self.user_display(room.creator)
            lines.append(
                f"- ID: {self.room_global_identifier(room)} | Статус: {room.joined_count}/2 | "
                f"Сумма: {self.amount_ton(room.amount)} | Создатель: {creator}"
            )
        return lines

    async def ban_user_by_tg_id(self, tg_id: int) -> str:
        user = await self.users.get_user_by_tg_id(tg_id)
        if user is None:
            return "Пользователь не найден."
        if user.tg_id in self.admin_tg_ids:
            return "Нельзя забанить администратора."
        await self.admin.ban_user(user)
        rooms = await self.rooms.list_creator_rooms(user.id)
        for room in rooms:
            await self.admin.block_room(room, "Комната заблокирована из-за бана пользователя.")
        return f"Пользователь {self.user_display(user)} забанен. Заблокировано комнат: {len(rooms)}."

    async def unban_user_by_tg_id(self, tg_id: int) -> str:
        user = await self.users.get_user_by_tg_id(tg_id)
        if user is None:
            return "Пользователь не найден."
        await self.admin.unban_user(user)
        return f"Пользователь {self.user_display(user)} разбанен."

    async def block_room_by_identifier(self, identifier: str) -> str:
        room = await self.rooms.get_room_by_identifier(identifier)
        if room is None:
            return "Комната не найдена."
        await self.admin.block_room(room, "Комната заблокирована администратором.")
        return f"Комната {self.room_global_identifier(room)} заблокирована."

    async def unblock_room_by_identifier(self, identifier: str) -> str:
        room = await self.rooms.get_room_by_identifier(identifier)
        if room is None:
            return "Комната не найдена."
        await self.admin.unblock_room(room)
        return f"Комната {self.room_global_identifier(room)} разблокирована."

    async def debug_room(self, identifier: str) -> str:
        room = await self.rooms.get_room_by_identifier(identifier)
        if room is None:
            return "Комната не найдена."
        creator = self.user_display(room.creator)
        participants = []
        for participant in room.participant_links:
            if participant.user:
                participants.append(self.user_display(participant.user))
        participants_text = ", ".join(participants) if participants else "Нет"
        link_active = "Да" if room.is_open and not room.is_blocked and room.joined_count < 2 else "Нет"
        blocked = "Да" if room.is_blocked else "Нет"
        return (
            f"🔎 Комната {self.room_global_identifier(room)}\n"
            f"Создатель: {creator}\n"
            f"Участники: {participants_text}\n"
            f"Сумма: {self.amount_ton(room.amount)}\n"
            f"Статус: {room.joined_count}/2\n"
            f"Ссылка активна: {link_active}\n"
            f"Заблокирована: {blocked}"
        )

    async def chain_for_user_tg_id(self, tg_id: int) -> str:
        user = await self.users.get_user_by_tg_id(tg_id)
        if user is None:
            return "Пользователь не найден."
        created_rooms = await self.rooms.list_creator_rooms(user.id)
        joined_rooms = await self.rooms.list_joined_rooms_by_user(user.id)
        created_text = (
            ", ".join(self.room_global_identifier(room) for room in created_rooms) if created_rooms else "Нет"
        )
        joined_text = (
            ", ".join(self.room_global_identifier(room) for room in joined_rooms) if joined_rooms else "Нет"
        )
        return (
            f"⛓ Цепочка пользователя {self.user_display(user)}\n"
            f"Созданные комнаты: {created_text}\n"
            f"Где участвовал: {joined_text}"
        )

    async def broadcast(self, bot: Bot, text: str) -> tuple[int, int]:
        tg_ids = await self.users.list_tg_ids()
        sent_count = 0
        failed_count = 0
        for tg_id in tg_ids:
            try:
                await bot.send_message(chat_id=tg_id, text=text, reply_markup=main_menu_markup())
                sent_count += 1
            except Exception:
                failed_count += 1
        return sent_count, failed_count
