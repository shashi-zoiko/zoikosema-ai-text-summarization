import json
import logging
import os
import uuid
from datetime import datetime, timezone as tz

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select, func, desc, or_, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.chat import (
    Channel, ChannelMember, Message, MessageReaction, MessageReadReceipt,
)
from app.models.organization import NOTIF_CHAT_MENTION, Notification
from app.models.user import User
from app.schemas.chat import (
    ChannelCreate, ChannelMemberOut, ChannelOut,
    MessageCreate, MessageOut, ReactionIn, ReactionOut,
    ReadReceiptIn, ReadReceiptOut,
)
from app.api.notifications import push_to_user
from app.websocket.chat import _resolve_mentions
from app.websocket.manager import chat_manager

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/channels", tags=["chat"])

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
ALLOWED_EXTENSIONS = {
    "png", "jpg", "jpeg", "gif", "webp", "svg",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "txt", "csv", "zip", "json", "md",
    # Audio / voice notes
    "webm", "mp3", "wav", "ogg", "m4a",
}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def _membership(db: Session, channel_id: int, user_id: int) -> ChannelMember | None:
    return db.scalar(
        select(ChannelMember).where(
            ChannelMember.channel_id == channel_id, ChannelMember.user_id == user_id
        )
    )


# Serializers are intentionally split from loaders so list endpoints cannot
# accidentally re-introduce N+1 query patterns. _serialize_* takes pure data;
# anything needing DB access lives in _load_*_ctx and must accept a batch.

def _serialize_message(
    msg: Message,
    sender: User,
    reactions: list[MessageReaction],
    reaction_users: dict[int, User],
    reply_preview: str | None,
    client_id: str | None = None,
) -> MessageOut:
    return MessageOut(
        id=msg.id,
        channel_id=msg.channel_id,
        sender_id=msg.sender_id,
        sender_name=sender.name,
        sender_color=sender.avatar_color,
        body=msg.body,
        created_at=msg.created_at,
        deleted_at=msg.deleted_at,
        reply_to_id=msg.reply_to_id,
        reply_preview=reply_preview,
        file_url=msg.file_url,
        file_name=msg.file_name,
        file_type=msg.file_type,
        file_size=msg.file_size,
        client_id=client_id,
        reactions=[
            ReactionOut(
                emoji=r.emoji,
                user_id=r.user_id,
                user_name=reaction_users.get(r.user_id, sender).name,
            )
            for r in reactions
        ],
    )


def _load_message_ctx(
    db: Session, messages: list[Message]
) -> tuple[dict[int, list[MessageReaction]], dict[int, User], dict[int, str]]:
    """Batch-fetch reactions, reaction users, and reply previews for a list of
    messages in 3 queries total — replaces the per-message fetches that turned
    list_messages into 100+ sequential round-trips."""
    if not messages:
        return {}, {}, {}

    msg_ids = [m.id for m in messages]
    reactions_raw = db.scalars(
        select(MessageReaction).where(MessageReaction.message_id.in_(msg_ids))
    ).all()
    reactions_by_msg: dict[int, list[MessageReaction]] = {}
    for r in reactions_raw:
        reactions_by_msg.setdefault(r.message_id, []).append(r)

    reaction_user_ids = {r.user_id for r in reactions_raw}
    reaction_users: dict[int, User] = {}
    if reaction_user_ids:
        reaction_users = {
            u.id: u
            for u in db.scalars(select(User).where(User.id.in_(reaction_user_ids))).all()
        }

    reply_ids = {m.reply_to_id for m in messages if m.reply_to_id}
    reply_previews: dict[int, str] = {}
    if reply_ids:
        parents = db.scalars(select(Message).where(Message.id.in_(reply_ids))).all()
        for p in parents:
            if not p.deleted_at:
                reply_previews[p.id] = p.body[:120]

    return reactions_by_msg, reaction_users, reply_previews


def _serialize_single_message(
    db: Session, msg: Message, sender: User, client_id: str | None = None
) -> MessageOut:
    """For endpoints that return exactly one message (post_message, upload_file).
    Wraps the bulk loader so single-message paths stay one-call."""
    reactions_by_msg, reaction_users, reply_previews = _load_message_ctx(db, [msg])
    return _serialize_message(
        msg,
        sender,
        reactions_by_msg.get(msg.id, []),
        reaction_users,
        reply_previews.get(msg.reply_to_id) if msg.reply_to_id else None,
        client_id=client_id,
    )


# ── Real-time fan-out for REST-originated messages ───────────────────────
#
# The chat composer sends over plain HTTP (reliable even when the WebSocket is
# down) and uses the WS purely to *receive*. So every REST write has to fan its
# result out to the channel's live WS room itself, otherwise peers wouldn't see
# the message until their next manual refetch. broadcast_threadsafe hops the
# payload onto the serving loop from this synchronous (threadpool) handler.

def _broadcast_new_message(channel_id: int, out: MessageOut) -> None:
    payload = {"type": "message", "message": out.model_dump(mode="json")}
    try:
        chat_manager.broadcast_threadsafe(f"channel:{channel_id}", payload)
    except Exception:  # noqa: BLE001 — never let fan-out failure fail the write
        log.exception("chat: failed to broadcast message %s", out.id)


def _emit_mention_notifications(db: Session, msg: Message, sender: User) -> None:
    """Resolve @mentions in a freshly-persisted message, persist a Notification
    per mentioned member, and push it live to their notification socket. Mirrors
    the WebSocket send path so mentions work no matter which transport sent the
    message. Best-effort: a failure here must not fail the message write."""
    try:
        mentions = _resolve_mentions(db, msg.body, msg.channel_id, sender.id)
        if not mentions:
            return
        channel_obj = db.get(Channel, msg.channel_id)
        channel_label = channel_obj.name if channel_obj else "a channel"
        snippet = msg.body[:140]
        notifs = [
            Notification(
                user_id=u.id,
                type=NOTIF_CHAT_MENTION,
                title=f"{sender.name} mentioned you in {channel_label}",
                body=snippet,
                data=json.dumps({"channel_id": msg.channel_id, "message_id": msg.id}),
            )
            for u in mentions
        ]
        db.add_all(notifs)
        db.commit()
        for n in notifs:
            db.refresh(n)
            chat_manager.schedule(push_to_user(n.user_id, {
                "type": "notification",
                "notification": {
                    "id": n.id,
                    "type": n.type,
                    "title": n.title,
                    "body": n.body,
                    "is_read": False,
                    "created_at": n.created_at.isoformat(),
                    "data": {"channel_id": msg.channel_id, "message_id": msg.id},
                },
            }))
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("chat: failed to emit mention notifications for msg %s", msg.id)


def _serialize_single_channel(db: Session, channel: Channel, user_id: int) -> ChannelOut:
    """For endpoints that return exactly one channel. Wraps the bulk loader."""
    members_by_channel, last_msg_by_channel, unread_by_channel = _load_channels_ctx(
        db, [channel], user_id
    )
    return _serialize_channel(
        channel,
        members_by_channel.get(channel.id, []),
        last_msg_by_channel.get(channel.id),
        unread_by_channel.get(channel.id, 0),
    )


def _serialize_channel(
    channel: Channel,
    members: list[User],
    last_message: Message | None,
    unread_count: int,
) -> ChannelOut:
    return ChannelOut(
        id=channel.id,
        name=channel.name,
        is_direct=channel.is_direct,
        created_at=channel.created_at,
        members=[ChannelMemberOut.model_validate(u) for u in members],
        last_message_preview=(last_message.body[:120] if last_message else None),
        last_message_at=last_message.created_at if last_message else None,
        unread_count=unread_count,
    )


def _load_channels_ctx(
    db: Session, channels: list[Channel], user_id: int
) -> tuple[dict[int, list[User]], dict[int, Message], dict[int, int]]:
    """Batch-fetch members, last messages, and unread counts for a list of
    channels — replaces the 3-queries-per-channel pattern in list_my_channels."""
    if not channels:
        return {}, {}, {}
    channel_ids = [c.id for c in channels]

    # Members per channel: single join, group in Python.
    member_rows = db.execute(
        select(ChannelMember.channel_id, User)
        .join(User, User.id == ChannelMember.user_id)
        .where(ChannelMember.channel_id.in_(channel_ids))
    ).all()
    members_by_channel: dict[int, list[User]] = {}
    for cid, u in member_rows:
        members_by_channel.setdefault(cid, []).append(u)

    # Last message per channel via correlated subquery on max(id), one round trip.
    last_id_subq = (
        select(Message.channel_id, func.max(Message.id).label("max_id"))
        .where(Message.channel_id.in_(channel_ids), Message.deleted_at.is_(None))
        .group_by(Message.channel_id)
        .subquery()
    )
    last_msgs = db.scalars(
        select(Message).join(last_id_subq, Message.id == last_id_subq.c.max_id)
    ).all()
    last_msg_by_channel = {m.channel_id: m for m in last_msgs}

    # Receipts for this user across all channels in one query.
    receipts = db.scalars(
        select(MessageReadReceipt).where(
            MessageReadReceipt.channel_id.in_(channel_ids),
            MessageReadReceipt.user_id == user_id,
        )
    ).all()
    receipt_by_channel = {r.channel_id: r.last_read_message_id for r in receipts}

    # Single query for all unread counts: per-channel "id > last_read_id" if a
    # receipt exists, else count-all. Never count the current user's own
    # messages as unread; otherwise a message you sent after your last receipt
    # can badge the conversation for you on the next channel-list refresh.
    conditions = []
    for cid in channel_ids:
        last_read = receipt_by_channel.get(cid)
        if last_read is None:
            conditions.append(Message.channel_id == cid)
        else:
            conditions.append(and_(Message.channel_id == cid, Message.id > last_read))

    unread_rows = db.execute(
        select(Message.channel_id, func.count(Message.id))
        .where(
            Message.deleted_at.is_(None),
            Message.sender_id != user_id,
            or_(*conditions),
        )
        .group_by(Message.channel_id)
    ).all()
    unread_by_channel: dict[int, int] = {cid: 0 for cid in channel_ids}
    for cid, cnt in unread_rows:
        unread_by_channel[cid] = cnt

    return members_by_channel, last_msg_by_channel, unread_by_channel


# ── Channels ────────────────────────────────────────────────────────────

@router.get("", response_model=list[ChannelOut])
def list_my_channels(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    channel_ids = db.scalars(
        select(ChannelMember.channel_id).where(ChannelMember.user_id == user.id)
    ).all()
    if not channel_ids:
        return []
    channels = list(db.scalars(
        select(Channel).where(Channel.id.in_(channel_ids)).order_by(desc(Channel.created_at))
    ).all())
    members_by_channel, last_msg_by_channel, unread_by_channel = _load_channels_ctx(
        db, channels, user.id
    )
    results = [
        _serialize_channel(
            c,
            members_by_channel.get(c.id, []),
            last_msg_by_channel.get(c.id),
            unread_by_channel.get(c.id, 0),
        )
        for c in channels
    ]
    results.sort(key=lambda c: c.last_message_at or c.created_at, reverse=True)
    return results


@router.post("", response_model=ChannelOut, status_code=201)
def create_channel(
    data: ChannelCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member_ids = set(data.member_ids) | {user.id}
    existing_users = db.scalars(select(User).where(User.id.in_(member_ids))).all()
    if len(existing_users) != len(member_ids):
        raise HTTPException(status_code=400, detail="Invalid member ids")

    if data.is_direct and len(member_ids) == 2:
        other_id = next(i for i in member_ids if i != user.id)
        candidates = db.scalars(
            select(Channel)
            .join(ChannelMember, ChannelMember.channel_id == Channel.id)
            .where(Channel.is_direct.is_(True), ChannelMember.user_id == user.id)
        ).all()
        for c in candidates:
            member_set = {m.user_id for m in c.members}
            if member_set == {user.id, other_id}:
                return _serialize_single_channel(db, c, user.id)

    channel = Channel(name=data.name.strip(), is_direct=data.is_direct, created_by=user.id)
    db.add(channel)
    db.flush()
    for uid in member_ids:
        db.add(ChannelMember(channel_id=channel.id, user_id=uid))
    db.commit()
    db.refresh(channel)
    return _serialize_single_channel(db, channel, user.id)


# ── Messages ────────────────────────────────────────────────────────────

@router.get("/{channel_id}/messages", response_model=list[MessageOut])
def list_messages(
    channel_id: int,
    limit: int = 50,
    before_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mem = _membership(db, channel_id, user.id)
    if not mem:
        # 404, not 403: a non-member must not be able to tell a channel exists.
        raise HTTPException(status_code=404, detail="Channel not found")
    if mem.is_muted:
        raise HTTPException(status_code=403, detail="You are muted in this channel")
    stmt = select(Message).where(Message.channel_id == channel_id)
    if before_id:
        stmt = stmt.where(Message.id < before_id)
    stmt = stmt.order_by(desc(Message.id)).limit(min(limit, 200))
    messages = list(db.scalars(stmt).all())
    messages.reverse()
    sender_ids = {m.sender_id for m in messages}
    senders = {u.id: u for u in db.scalars(select(User).where(User.id.in_(sender_ids))).all()}
    reactions_by_msg, reaction_users, reply_previews = _load_message_ctx(db, messages)
    return [
        _serialize_message(
            m,
            senders[m.sender_id],
            reactions_by_msg.get(m.id, []),
            reaction_users,
            reply_previews.get(m.reply_to_id) if m.reply_to_id else None,
        )
        for m in messages
    ]


@router.post("/{channel_id}/messages", response_model=MessageOut, status_code=201)
def post_message(
    channel_id: int,
    data: MessageCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mem = _membership(db, channel_id, user.id)
    if not mem:
        # 404, not 403: a non-member must not be able to tell a channel exists.
        raise HTTPException(status_code=404, detail="Channel not found")
    if mem.is_muted:
        raise HTTPException(status_code=403, detail="You are muted in this channel")

    if data.reply_to_id:
        parent = db.get(Message, data.reply_to_id)
        if not parent or parent.channel_id != channel_id:
            raise HTTPException(status_code=400, detail="Invalid reply target")

    # Idempotency: a retried send (lost response / flaky network) carries the
    # same client_id. Return the original row instead of inserting a duplicate,
    # and skip the re-broadcast / re-notify the first call already did.
    def _existing_for_client_id() -> Message | None:
        if not data.client_id:
            return None
        return db.scalar(
            select(Message).where(
                Message.channel_id == channel_id,
                Message.sender_id == user.id,
                Message.client_id == data.client_id,
            )
        )

    dup = _existing_for_client_id()
    if dup is not None:
        return _serialize_single_message(db, dup, user, client_id=data.client_id)

    msg = Message(
        channel_id=channel_id,
        sender_id=user.id,
        body=data.body.strip(),
        reply_to_id=data.reply_to_id,
        client_id=data.client_id,
    )
    db.add(msg)
    try:
        db.commit()
    except IntegrityError:
        # Concurrent retry won the unique-index race — return the row it wrote.
        db.rollback()
        dup = _existing_for_client_id()
        if dup is not None:
            return _serialize_single_message(db, dup, user, client_id=data.client_id)
        raise
    db.refresh(msg)
    out = _serialize_single_message(db, msg, user, client_id=data.client_id)
    _emit_mention_notifications(db, msg, user)
    _broadcast_new_message(channel_id, out)
    return out


@router.delete("/{channel_id}/messages/{message_id}", status_code=200)
def delete_message(
    channel_id: int,
    message_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _membership(db, channel_id, user.id):
        # 404, not 403: a non-member must not be able to tell a channel exists.
        raise HTTPException(status_code=404, detail="Channel not found")
    msg = db.get(Message, message_id)
    if not msg or msg.channel_id != channel_id:
        raise HTTPException(status_code=404, detail="Message not found")

    # Sender can delete their own; channel creator can delete any
    channel = db.get(Channel, channel_id)
    if msg.sender_id != user.id and channel.created_by != user.id:
        raise HTTPException(status_code=403, detail="Cannot delete this message")

    msg.deleted_at = datetime.now(tz.utc)
    db.commit()
    return {"ok": True, "message_id": message_id}


# ── Reactions ───────────────────────────────────────────────────────────

@router.post("/{channel_id}/messages/{message_id}/reactions", status_code=201)
def add_reaction(
    channel_id: int,
    message_id: int,
    data: ReactionIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _membership(db, channel_id, user.id):
        # 404, not 403: a non-member must not be able to tell a channel exists.
        raise HTTPException(status_code=404, detail="Channel not found")
    msg = db.get(Message, message_id)
    if not msg or msg.channel_id != channel_id or msg.deleted_at:
        raise HTTPException(status_code=404, detail="Message not found")

    existing = db.scalar(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == user.id,
            MessageReaction.emoji == data.emoji,
        )
    )
    if existing:
        return {"ok": True, "action": "already_exists"}

    reaction = MessageReaction(message_id=message_id, user_id=user.id, emoji=data.emoji)
    db.add(reaction)
    db.commit()
    return {"ok": True, "action": "added", "emoji": data.emoji, "user_id": user.id, "user_name": user.name}


@router.delete("/{channel_id}/messages/{message_id}/reactions/{emoji}", status_code=200)
def remove_reaction(
    channel_id: int,
    message_id: int,
    emoji: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _membership(db, channel_id, user.id):
        # 404, not 403: a non-member must not be able to tell a channel exists.
        raise HTTPException(status_code=404, detail="Channel not found")
    reaction = db.scalar(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == user.id,
            MessageReaction.emoji == emoji,
        )
    )
    if reaction:
        db.delete(reaction)
        db.commit()
    return {"ok": True, "action": "removed", "emoji": emoji}


# ── File Upload ─────────────────────────────────────────────────────────

@router.post("/{channel_id}/upload", response_model=MessageOut, status_code=201)
async def upload_file(
    channel_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mem = _membership(db, channel_id, user.id)
    if not mem:
        # 404, not 403: a non-member must not be able to tell a channel exists.
        raise HTTPException(status_code=404, detail="Channel not found")
    if mem.is_muted:
        raise HTTPException(status_code=403, detail="You are muted in this channel")

    ext = (file.filename or "file").rsplit(".", 1)[-1].lower() if file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type .{ext} not allowed")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    safe_name = f"{uuid.uuid4().hex}.{ext}"
    path = os.path.join(UPLOAD_DIR, safe_name)
    with open(path, "wb") as f:
        f.write(content)

    file_url = f"/api/uploads/{safe_name}"
    msg = Message(
        channel_id=channel_id,
        sender_id=user.id,
        body=file.filename or "File",
        file_url=file_url,
        file_name=file.filename,
        file_type=file.content_type or f"application/{ext}",
        file_size=len(content),
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    out = _serialize_single_message(db, msg, user)
    _broadcast_new_message(channel_id, out)
    return out


# ── Read Receipts ───────────────────────────────────────────────────────

@router.post("/{channel_id}/read", status_code=200)
def mark_read(
    channel_id: int,
    data: ReadReceiptIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _membership(db, channel_id, user.id):
        # 404, not 403: a non-member must not be able to tell a channel exists.
        raise HTTPException(status_code=404, detail="Channel not found")
    receipt = db.scalar(
        select(MessageReadReceipt).where(
            MessageReadReceipt.channel_id == channel_id,
            MessageReadReceipt.user_id == user.id,
        )
    )
    if receipt:
        if data.last_read_message_id > receipt.last_read_message_id:
            receipt.last_read_message_id = data.last_read_message_id
            receipt.read_at = datetime.now(tz.utc)
    else:
        receipt = MessageReadReceipt(
            channel_id=channel_id,
            user_id=user.id,
            last_read_message_id=data.last_read_message_id,
        )
        db.add(receipt)
    db.commit()
    return {"ok": True}


@router.get("/{channel_id}/read-receipts", response_model=list[ReadReceiptOut])
def get_read_receipts(
    channel_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not _membership(db, channel_id, user.id):
        # 404, not 403: a non-member must not be able to tell a channel exists.
        raise HTTPException(status_code=404, detail="Channel not found")
    receipts = db.scalars(
        select(MessageReadReceipt).where(MessageReadReceipt.channel_id == channel_id)
    ).all()
    uids = {r.user_id for r in receipts}
    users_map = {u.id: u for u in db.scalars(select(User).where(User.id.in_(uids))).all()}
    return [
        ReadReceiptOut(
            user_id=r.user_id,
            user_name=users_map[r.user_id].name,
            last_read_message_id=r.last_read_message_id,
            read_at=r.read_at,
        )
        for r in receipts if r.user_id in users_map
    ]


# ── Moderation (mute/unmute) ────────────────────────────────────────────

@router.post("/{channel_id}/mute/{target_user_id}", status_code=200)
def mute_user(
    channel_id: int,
    target_user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    channel = db.get(Channel, channel_id)
    # Non-creators (and non-existent channels) both get 404 so a channel's
    # existence can't be probed through this endpoint.
    if not channel or channel.created_by != user.id:
        raise HTTPException(status_code=404, detail="Channel not found")
    target_mem = _membership(db, channel_id, target_user_id)
    if not target_mem:
        raise HTTPException(status_code=404, detail="User not in channel")
    target_mem.is_muted = True
    db.commit()
    return {"ok": True, "user_id": target_user_id, "muted": True}


@router.post("/{channel_id}/unmute/{target_user_id}", status_code=200)
def unmute_user(
    channel_id: int,
    target_user_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    channel = db.get(Channel, channel_id)
    if not channel or channel.created_by != user.id:
        raise HTTPException(status_code=404, detail="Channel not found")
    target_mem = _membership(db, channel_id, target_user_id)
    if not target_mem:
        raise HTTPException(status_code=404, detail="User not in channel")
    target_mem.is_muted = False
    db.commit()
    return {"ok": True, "user_id": target_user_id, "muted": False}
