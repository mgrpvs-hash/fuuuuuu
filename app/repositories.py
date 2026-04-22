from __future__ import annotations

from decimal import Decimal

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import CreateRequest, JoinRequest, RequestStatus, Room, RoomParticipant, User


class UserRepo:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_or_create(self, user_id: int, username: str | None) -> User:
        user = await self.get(user_id)
        if user:
            if user.username != username:
                user.username = username
                await self.session.flush()
            return user
        user = User(id=user_id, username=username)
        self.session.add(user)
        await self.session.flush()
        return user

    async def get(self, user_id: int) -> User | None:
        result = await self.session.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def count(self) -> int:
        result = await self.session.execute(select(func.count(User.id)))
        return int(result.scalar_one() or 0)

    async def all_user_ids(self) -> list[int]:
        result = await self.session.execute(select(User.id))
        return [row[0] for row in result.all()]


class RoomRepo:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def exists_token(self, token: str) -> bool:
        result = await self.session.execute(select(Room.id).where(Room.token == token))
        return result.scalar_one_or_none() is not None

    async def create(
        self,
        creator_id: int,
        creator_username: str | None,
        amount: str,
        creator_wallet: str,
        token: str,
    ) -> Room:
        room = Room(
            token=token,
            amount=Decimal(amount),
            creator_id=creator_id,
            creator_username=creator_username,
            creator_wallet=creator_wallet,
            is_open=True,
            joined_count=0,
        )
        self.session.add(room)
        await self.session.flush()
        return room

    async def get_by_id(self, room_id: int) -> Room | None:
        result = await self.session.execute(
            select(Room)
            .where(Room.id == room_id)
            .options(selectinload(Room.participants))
        )
        return result.scalar_one_or_none()

    async def get_by_token_or_id(self, identifier: str) -> Room | None:
        room: Room | None = None
        if identifier.isdigit():
            room = await self.get_by_id(int(identifier))
            if room:
                return room
        result = await self.session.execute(
            select(Room).where(Room.token == identifier).options(selectinload(Room.participants))
        )
        return result.scalar_one_or_none()

    async def created_by_user(self, user_id: int) -> list[Room]:
        result = await self.session.execute(
            select(Room)
            .where(Room.creator_id == user_id)
            .order_by(Room.id.asc())
            .options(selectinload(Room.participants))
        )
        return list(result.scalars().all())

    async def all_rooms(self) -> list[Room]:
        result = await self.session.execute(
            select(Room).order_by(Room.id.asc()).options(selectinload(Room.participants))
        )
        return list(result.scalars().all())

    async def count(self) -> int:
        result = await self.session.execute(select(func.count(Room.id)))
        return int(result.scalar_one() or 0)

    async def sum_amounts(self) -> Decimal:
        result = await self.session.execute(select(func.coalesce(func.sum(Room.amount), 0)))
        value = result.scalar_one()
        return value if isinstance(value, Decimal) else Decimal(str(value))

    async def has_participant(self, room_id: int, user_id: int) -> bool:
        result = await self.session.execute(
            select(RoomParticipant).where(
                and_(RoomParticipant.room_id == room_id, RoomParticipant.user_id == user_id)
            )
        )
        return result.scalar_one_or_none() is not None

    async def add_participant(self, room: Room, user_id: int, username: str | None) -> None:
        self.session.add(RoomParticipant(room_id=room.id, user_id=user_id, username=username))
        room.joined_count += 1
        room.is_open = room.joined_count < 2
        await self.session.flush()

    async def participated_by_user(self, user_id: int) -> list[Room]:
        result = await self.session.execute(
            select(Room)
            .join(RoomParticipant, RoomParticipant.room_id == Room.id)
            .where(RoomParticipant.user_id == user_id)
            .order_by(Room.id.asc())
        )
        return list(result.scalars().all())

    async def block_all_by_creator(self, user_id: int, reason: str) -> int:
        rooms = await self.created_by_user(user_id)
        blocked = 0
        for room in rooms:
            if not room.is_blocked:
                blocked += 1
            room.is_blocked = True
            room.is_open = False
            room.block_reason = reason
        await self.session.flush()
        return blocked

    async def block_room(self, room: Room, reason: str) -> None:
        room.is_blocked = True
        room.is_open = False
        room.block_reason = reason
        await self.session.flush()

    async def unblock_room(self, room: Room) -> None:
        room.is_blocked = False
        room.block_reason = None
        room.is_open = room.joined_count < 2
        await self.session.flush()

    async def local_room_number(self, user_id: int, room_id: int) -> int | None:
        result = await self.session.execute(
            select(Room.id).where(Room.creator_id == user_id).order_by(Room.id.asc())
        )
        ids = [row[0] for row in result.all()]
        if room_id not in ids:
            return None
        return ids.index(room_id) + 1

    async def participants(self, room_id: int) -> list[tuple[int, str | None]]:
        result = await self.session.execute(
            select(RoomParticipant.user_id, RoomParticipant.username)
            .where(RoomParticipant.room_id == room_id)
            .order_by(RoomParticipant.user_id.asc())
        )
        return [(row[0], row[1]) for row in result.all()]


class CreateRequestRepo:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, user_id: int, username: str | None, amount: str, wallet: str) -> CreateRequest:
        req = CreateRequest(
            user_id=user_id,
            username=username,
            amount=Decimal(amount),
            wallet=wallet,
            status=RequestStatus.PENDING,
        )
        self.session.add(req)
        await self.session.flush()
        return req

    async def get(self, request_id: int) -> CreateRequest | None:
        result = await self.session.execute(select(CreateRequest).where(CreateRequest.id == request_id))
        return result.scalar_one_or_none()


class JoinRequestRepo:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, room_id: int, joiner_id: int, joiner_username: str | None) -> JoinRequest:
        req = JoinRequest(
            room_id=room_id,
            joiner_id=joiner_id,
            joiner_username=joiner_username,
            status=RequestStatus.PENDING,
        )
        self.session.add(req)
        await self.session.flush()
        return req

    async def get(self, request_id: int) -> JoinRequest | None:
        result = await self.session.execute(select(JoinRequest).where(JoinRequest.id == request_id))
        return result.scalar_one_or_none()

    async def has_pending(self, room_id: int, joiner_id: int) -> bool:
        result = await self.session.execute(
            select(JoinRequest).where(
                and_(
                    JoinRequest.room_id == room_id,
                    JoinRequest.joiner_id == joiner_id,
                    JoinRequest.status == RequestStatus.PENDING,
                )
            )
        )
        return result.scalar_one_or_none() is not None
