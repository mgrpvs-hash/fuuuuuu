"""ORM models."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tg_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False, index=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    wallet_address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )

    created_rooms: Mapped[list["Room"]] = relationship(
        back_populates="creator",
        cascade="all, delete-orphan",
    )
    participants: Mapped[list["RoomParticipant"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(8), unique=True, index=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    creator_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    creator_wallet: Mapped[str] = mapped_column(String(255), nullable=False)
    joined_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    block_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    creator: Mapped["User"] = relationship(back_populates="created_rooms")
    participant_links: Mapped[list["RoomParticipant"]] = relationship(
        back_populates="room",
        cascade="all, delete-orphan",
    )


class RoomParticipant(Base):
    __tablename__ = "room_participants"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_participant"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    username_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    room: Mapped["Room"] = relationship(back_populates="participant_links")
    user: Mapped["User"] = relationship(back_populates="participants")


class CreateRequest(Base):
    __tablename__ = "create_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(24, 8), nullable=False)
    wallet_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped["User"] = relationship()


class JoinRequest(Base):
    __tablename__ = "join_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False)
    joiner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    room: Mapped["Room"] = relationship()
    joiner: Mapped["User"] = relationship()

