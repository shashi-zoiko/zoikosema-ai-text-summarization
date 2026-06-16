from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    member_ids: list[int] = Field(default_factory=list)
    is_direct: bool = False


class ChannelMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    avatar_color: str


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_direct: bool
    created_at: datetime
    members: list[ChannelMemberOut] = []
    last_message_preview: str | None = None
    last_message_at: datetime | None = None
    unread_count: int = 0


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    reply_to_id: int | None = None
    # Opaque client-generated id used to reconcile the optimistic UI bubble with
    # the persisted row. Echoed back verbatim on the response and on the WS
    # broadcast; never trusted for anything server-side.
    client_id: str | None = Field(default=None, max_length=64)


class ReactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    emoji: str
    user_id: int
    user_name: str


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    channel_id: int
    sender_id: int
    sender_name: str
    sender_color: str
    body: str
    created_at: datetime
    deleted_at: datetime | None = None
    reply_to_id: int | None = None
    reply_preview: str | None = None
    file_url: str | None = None
    file_name: str | None = None
    file_type: str | None = None
    file_size: int | None = None
    reactions: list[ReactionOut] = []
    # Echoed back to the sender so the optimistic bubble can swap itself for the
    # persisted row. Null for every recipient other than the original sender.
    client_id: str | None = None


class ReactionIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=32)


class ReadReceiptIn(BaseModel):
    last_read_message_id: int


class ReadReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    user_name: str
    last_read_message_id: int
    read_at: datetime
