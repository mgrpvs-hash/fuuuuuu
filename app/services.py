from __future__ import annotations

import secrets
import string

from app.constants import ROOM_BLOCK_REASON_BY_ADMIN
from app.models import Room
from app.repositories import RoomRepo


def room_global_id(room: Room) -> str:
    return room.token if room.token else str(room.id)


def room_counter(room: Room) -> str:
    return f"{room.joined_count} из 2"


def room_status(room: Room) -> str:
    return f"{room.joined_count}/2"


def blocked_reason(room: Room) -> str:
    if room.block_reason:
        return room.block_reason
    if room.is_blocked:
        return ROOM_BLOCK_REASON_BY_ADMIN
    return "Ссылка неактивна (комната заполнена)."


async def room_link(bot_username: str, room: Room) -> str:
    return f"t.me/{bot_username}?start=room_{room_global_id(room)}"


async def build_room_token(room_repo: RoomRepo) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        token = "".join(secrets.choice(alphabet) for _ in range(8))
        if not await room_repo.exists_token(token):
            return token
