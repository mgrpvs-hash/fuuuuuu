"""Repository layer for SQLAlchemy models."""

from __future__ import annotations

from decimal import Decimal
from typing import Sequence

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import CreateRequest, JoinRequest, Room, RoomParticipant, User


class UserRepository:
    """User persistence operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_or_create_user(self, tg_id: int, username: str | None) -> User:
        user = await self.get_user_by_tg_id(tg_id)
        if user:
            user.username = username
            await self.session.flush()
            return user
        user = User(tg_id=tg_id, username=username)
        self.session.add(user)
        await self.session.flush()
        return user

    async def get_user_by_tg_id(self, tg_id: int) -> User | None:
        query: Select[tuple[User]] = select(User).where(User.tg_id == tg_id)
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_user(self, user_id: int) -> User | None:
        query: Select[tuple[User]] = select(User).where(User.id == user_id)
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def set_wallet(self, user: User, wallet: str) -> None:
        user.wallet_address = wallet
        await self.session.flush()

    async def count_users(self) -> int:
        result = await self.session.execute(select(func.count(User.id)))
        return int(result.scalar_one() or 0)

    async def list_tg_ids(self) -> list[int]:
        result = await self.session.execute(select(User.tg_id))
        return [int(item) for item in result.scalars().all()]


class RoomRepository:
    """Room and participant persistence operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_room(
        self,
        creator_id: int,
        creator_username: str | None,
        amount: Decimal,
        creator_wallet: str,
        token: str,
    ) -> Room:
        room = Room(
            creator_id=creator_id,
            creator_username=creator_username,
            amount=amount,
            creator_wallet=creator_wallet,
            token=token,
            joined_count=0,
            is_open=True,
            is_blocked=False,
        )
        self.session.add(room)
        await self.session.flush()
        return room

    async def get_room(self, room_id: int) -> Room | None:
        query = (
            select(Room)
            .where(Room.id == room_id)
            .options(
                selectinload(Room.creator),
                selectinload(Room.participant_links).selectinload(RoomParticipant.user),
            )
        )
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_room_by_token(self, token: str) -> Room | None:
        query = (
            select(Room)
            .where(Room.token == token)
            .options(
                selectinload(Room.creator),
                selectinload(Room.participant_links).selectinload(RoomParticipant.user),
            )
        )
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def get_room_by_identifier(self, identifier: str) -> Room | None:
        room = await self.get_room_by_token(identifier)
        if room:
            return room
        if identifier.isdigit():
            return await self.get_room(int(identifier))
        return None

    async def list_creator_rooms(self, creator_id: int) -> Sequence[Room]:
        query = (
            select(Room)
            .where(Room.creator_id == creator_id)
            .order_by(Room.id.asc())
            .options(
                selectinload(Room.creator),
                selectinload(Room.participant_links).selectinload(RoomParticipant.user),
            )
        )
        result = await self.session.execute(query)
        return result.scalars().all()

    async def list_creator_room_ids(self, creator_id: int) -> list[int]:
        query = select(Room.id).where(Room.creator_id == creator_id).order_by(Room.id.asc())
        result = await self.session.execute(query)
        return [int(item) for item in result.scalars().all()]

    async def list_all_rooms(self) -> Sequence[Room]:
        query = (
            select(Room)
            .order_by(Room.id.asc())
            .options(
                selectinload(Room.creator),
                selectinload(Room.participant_links).selectinload(RoomParticipant.user),
            )
        )
        result = await self.session.execute(query)
        return result.scalars().all()

    async def count_rooms(self) -> int:
        result = await self.session.execute(select(func.count(Room.id)))
        return int(result.scalar_one() or 0)

    async def total_room_amount(self) -> Decimal:
        result = await self.session.execute(select(func.coalesce(func.sum(Room.amount), 0)))
        value = result.scalar_one()
        return value if isinstance(value, Decimal) else Decimal(str(value))

    async def participant_exists(self, room_id: int, user_id: int) -> bool:
        query = select(RoomParticipant.id).where(
            RoomParticipant.room_id == room_id,
            RoomParticipant.user_id == user_id,
        )
        result = await self.session.execute(query)
        return result.scalar_one_or_none() is not None

    async def add_participant(self, room: Room, user: User) -> RoomParticipant:
        link = RoomParticipant(
            room_id=room.id,
            user_id=user.id,
            username_snapshot=user.username,
        )
        self.session.add(link)
        await self.session.flush()
        return link

    async def list_joined_rooms_by_user(self, user_id: int) -> Sequence[Room]:
        query = (
            select(Room)
            .join(RoomParticipant, RoomParticipant.room_id == Room.id)
            .where(RoomParticipant.user_id == user_id)
            .order_by(Room.id.asc())
            .options(
                selectinload(Room.creator),
                selectinload(Room.participant_links).selectinload(RoomParticipant.user),
            )
        )
        result = await self.session.execute(query)
        return result.scalars().all()


class RequestRepository:
    """Create/join request persistence operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_room_request(
        self,
        user_id: int,
        amount: Decimal,
        wallet_snapshot: str,
    ) -> CreateRequest:
        request = CreateRequest(
            user_id=user_id,
            amount=amount,
            wallet_snapshot=wallet_snapshot,
            status="pending",
        )
        self.session.add(request)
        await self.session.flush()
        return request

    async def get_create_request(self, request_id: int) -> CreateRequest | None:
        query = (
            select(CreateRequest)
            .where(CreateRequest.id == request_id)
            .options(selectinload(CreateRequest.user))
        )
        result = await self.session.execute(query)
        return result.scalar_one_or_none()

    async def create_join_request(self, room_id: int, joiner_id: int) -> JoinRequest:
        request = JoinRequest(room_id=room_id, joiner_id=joiner_id, status="pending")
        self.session.add(request)
        await self.session.flush()
        return request

    async def get_join_request(self, request_id: int) -> JoinRequest | None:
        query = (
            select(JoinRequest)
            .where(JoinRequest.id == request_id)
            .options(
                selectinload(JoinRequest.room)
                .selectinload(Room.participant_links)
                .selectinload(RoomParticipant.user),
                selectinload(JoinRequest.room).selectinload(Room.creator),
                selectinload(JoinRequest.joiner),
            )
        )
        result = await self.session.execute(query)
        return result.scalar_one_or_none()
