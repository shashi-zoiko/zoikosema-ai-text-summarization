from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import String, DateTime, ForeignKey, Integer, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_direct: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    members: Mapped[list["ChannelMember"]] = relationship(
        back_populates="channel", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        back_populates="channel", cascade="all, delete-orphan"
    )


class ChannelMember(Base):
    __tablename__ = "channel_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    channel_id: Mapped[int] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    is_muted: Mapped[bool] = mapped_column(Boolean, default=False)

    channel: Mapped[Channel] = relationship(back_populates="members")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    channel_id: Mapped[int] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Opaque client-generated send id. Used for end-to-end idempotency: a unique
    # partial index on (channel_id, sender_id, client_id) means a retried POST
    # (e.g. after a lost response) returns the original row instead of inserting
    # a duplicate. Nullable — server-originated / legacy WS inserts leave it NULL.
    client_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None
    )
    reply_to_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("messages.id"), nullable=True, default=None
    )
    file_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True, default=None)
    file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, default=None)
    file_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, default=None)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=None)

    channel: Mapped[Channel] = relationship(back_populates="messages")
    reactions: Mapped[list["MessageReaction"]] = relationship(
        back_populates="message", cascade="all, delete-orphan"
    )


class MessageReaction(Base):
    __tablename__ = "message_reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    emoji: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    message: Mapped[Message] = relationship(back_populates="reactions")


class MessageReadReceipt(Base):
    __tablename__ = "message_read_receipts"

    id: Mapped[int] = mapped_column(primary_key=True)
    channel_id: Mapped[int] = mapped_column(
        ForeignKey("channels.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    last_read_message_id: Mapped[int] = mapped_column(ForeignKey("messages.id"))
    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
