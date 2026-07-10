import asyncio
import json
import re
from datetime import datetime, timezone as tz
from typing import Any, Callable, TypeVar

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.deps import get_user_from_token
from app.models.chat import Channel, ChannelMember, Message, MessageReaction, MessageReadReceipt
from app.models.organization import NOTIF_CHAT_MENTION, Notification
from app.models.user import User
from app.api.notifications import push_to_user
from app.websocket.manager import chat_manager

router = APIRouter()

T = TypeVar("T")


# Match @<word>. Word = letters/digits/_/. across non-whitespace, up to 80 chars.
# Names with spaces are matched by stripping spaces from the candidate user names
# during lookup, so "@JohnDoe" hits a user named "John Doe".
_MENTION_RE = re.compile(r"(?:^|\s)@([\w.\-]{1,80})", re.UNICODE)


# Running DB work in a worker thread keeps the WebSocket event loop free for
# other connections. Holding a long-lived Session for the WS lifetime starved
# the SQLAlchemy pool under load — every handler now opens and closes its own
# short-lived Session so connections return to the pool between frames.
async def _run_db(fn: Callable[[Session], T]) -> T:
    def _inner() -> T:
        db = SessionLocal()
        try:
            return fn(db)
        finally:
            db.close()
    return await asyncio.to_thread(_inner)


def _resolve_mentions(db: Session, body: str, channel_id: int, sender_id: int) -> list[User]:
    """Return distinct channel-member users mentioned in `body` via @<name>.
    Matches case-insensitively against name with spaces removed. Sender is excluded."""
    raw = _MENTION_RE.findall(body or "")
    if not raw:
        return []
    members = db.scalars(
        select(User)
        .join(ChannelMember, ChannelMember.user_id == User.id)
        .where(ChannelMember.channel_id == channel_id)
    ).all()
    by_handle: dict[str, User] = {}
    for u in members:
        handle = re.sub(r"\s+", "", u.name).lower()
        by_handle.setdefault(handle, u)
    seen: set[int] = set()
    matched: list[User] = []
    for token in raw:
        u = by_handle.get(token.lower())
        if u and u.id != sender_id and u.id not in seen:
            seen.add(u.id)
            matched.append(u)
    return matched


async def _auth(token: str, channel_id: int) -> dict:
    """Authenticate token and verify channel membership in one DB hit.
    Returns user/membership summary as plain dicts so values survive awaits
    without dragging a Session into the event loop."""
    def _do(db: Session) -> dict:
        user = get_user_from_token(token, db)
        if not user:
            return {"auth": False}
        membership = db.scalar(
            select(ChannelMember).where(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == user.id,
            )
        )
        if not membership:
            return {"auth": True, "member": False}
        return {
            "auth": True,
            "member": True,
            "user_id": user.id,
            "user_name": user.name,
            "user_color": user.avatar_color,
        }
    return await _run_db(_do)


def _persist_message(
    channel_id: int,
    sender_id: int,
    sender_name: str,
    sender_color: str,
    body: str,
    reply_to_id: int | None,
    client_id: str | None = None,
) -> Callable[[Session], dict[str, Any]]:
    """Insert message + resolve mentions + create notifications in ONE session.
    Returns a session-bound thunk for _run_db; the thunk yields a payload dict
    for broadcasting plus per-mention notification dicts so the caller can do
    live pushes off the event loop."""
    def _do(db: Session) -> dict[str, Any]:
        membership = db.scalar(
            select(ChannelMember).where(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == sender_id,
            )
        )
        if not membership:
            return {"error": "not_member"}
        if membership.is_muted:
            return {"error": "muted"}

        if reply_to_id:
            parent = db.get(Message, reply_to_id)
            valid_reply = bool(parent and parent.channel_id == channel_id)
        else:
            parent = None
            valid_reply = False
        effective_reply_id = reply_to_id if valid_reply else None

        msg = Message(
            channel_id=channel_id,
            sender_id=sender_id,
            body=body[:4000],
            reply_to_id=effective_reply_id,
        )
        db.add(msg)
        db.flush()

        reply_preview = None
        if effective_reply_id and parent and not parent.deleted_at:
            reply_preview = parent.body[:120]

        mentions = _resolve_mentions(db, msg.body, channel_id, sender_id)
        mention_ids = [u.id for u in mentions]

        notif_payloads: list[dict[str, Any]] = []
        if mentions:
            channel_obj = db.get(Channel, channel_id)
            channel_label = channel_obj.name if channel_obj else "a channel"
            snippet = msg.body[:140]
            # Bulk-create the notifications and flush once so every Notification
            # row gets its id without N round-trip commits.
            notifs = [
                Notification(
                    user_id=u.id,
                    type=NOTIF_CHAT_MENTION,
                    title=f"{sender_name} mentioned you in {channel_label}",
                    body=snippet,
                    data=json.dumps({"channel_id": channel_id, "message_id": msg.id}),
                )
                for u in mentions
            ]
            db.add_all(notifs)
            db.flush()
            for n in notifs:
                notif_payloads.append({
                    "user_id": n.user_id,
                    "notification": {
                        "id": n.id,
                        "type": n.type,
                        "title": n.title,
                        "body": n.body,
                        "is_read": False,
                        "created_at": n.created_at.isoformat(),
                        "data": {"channel_id": channel_id, "message_id": msg.id},
                    },
                })

        db.commit()

        broadcast_payload = {
            "type": "message",
            "message": {
                "id": msg.id,
                "channel_id": channel_id,
                "sender_id": sender_id,
                "sender_name": sender_name,
                "sender_color": sender_color,
                "body": msg.body,
                "created_at": msg.created_at.isoformat(),
                "deleted_at": None,
                "reply_to_id": msg.reply_to_id,
                "reply_preview": reply_preview,
                "file_url": None,
                "file_name": None,
                "file_type": None,
                "file_size": None,
                "reactions": [],
                "mentions": mention_ids,
                # Echo back the sender's client_id (if any) so the optimistic
                # bubble can swap itself for the persisted row. Other peers
                # ignore this field. Send `None` rather than omitting so the
                # field shape stays stable.
                "client_id": client_id,
            },
        }
        return {"payload": broadcast_payload, "notifications": notif_payloads}
    return _do


def _toggle_reaction(
    channel_id: int, message_id: int, user_id: int, user_name: str, emoji: str
) -> Callable[[Session], dict[str, Any] | None]:
    def _do(db: Session) -> dict[str, Any] | None:
        msg = db.get(Message, message_id)
        if not msg or msg.channel_id != channel_id or msg.deleted_at:
            return None
        existing = db.scalar(
            select(MessageReaction).where(
                MessageReaction.message_id == message_id,
                MessageReaction.user_id == user_id,
                MessageReaction.emoji == emoji,
            )
        )
        if existing:
            db.delete(existing)
            action = "removed"
        else:
            db.add(MessageReaction(message_id=message_id, user_id=user_id, emoji=emoji))
            action = "added"
        db.commit()
        return {
            "type": "reaction",
            "message_id": message_id,
            "emoji": emoji,
            "user_id": user_id,
            "user_name": user_name,
            "action": action,
        }
    return _do


def _soft_delete_message(
    channel_id: int, message_id: int, user_id: int
) -> Callable[[Session], dict[str, Any]]:
    def _do(db: Session) -> dict[str, Any]:
        msg = db.get(Message, message_id)
        if not msg or msg.channel_id != channel_id or msg.deleted_at:
            return {"error": "not_found"}
        channel = db.get(Channel, channel_id)
        if msg.sender_id != user_id and (not channel or channel.created_by != user_id):
            return {"error": "forbidden"}
        msg.deleted_at = datetime.now(tz.utc)
        db.commit()
        return {
            "broadcast": {
                "type": "message_deleted",
                "message_id": message_id,
                "deleted_by": user_id,
            }
        }
    return _do


def _update_read_receipt(
    channel_id: int, user_id: int, last_read_id: int
) -> Callable[[Session], None]:
    def _do(db: Session) -> None:
        receipt = db.scalar(
            select(MessageReadReceipt).where(
                MessageReadReceipt.channel_id == channel_id,
                MessageReadReceipt.user_id == user_id,
            )
        )
        if receipt:
            if last_read_id > receipt.last_read_message_id:
                receipt.last_read_message_id = last_read_id
                receipt.read_at = datetime.now(tz.utc)
        else:
            db.add(MessageReadReceipt(
                channel_id=channel_id,
                user_id=user_id,
                last_read_message_id=last_read_id,
            ))
        db.commit()
    return _do


@router.websocket("/ws/channels/{channel_id}")
async def channel_ws(websocket: WebSocket, channel_id: int, token: str = ""):
    auth = await _auth(token, channel_id)
    if not auth.get("auth"):
        await websocket.close(code=4401)
        return
    if not auth.get("member"):
        await websocket.close(code=4403)
        return

    user_id: int = auth["user_id"]
    user_name: str = auth["user_name"]
    user_color: str = auth["user_color"]

    await websocket.accept()
    room = f"channel:{channel_id}"
    await chat_manager.join(room, websocket)
    await chat_manager.broadcast(
        room,
        {"type": "presence", "user_id": user_id, "name": user_name, "joined": True},
        exclude=websocket,
    )

    try:
        while True:          
            data = await websocket.receive_json()
            kind = data.get("type")

            if kind == "message":
                body = (data.get("body") or "").strip()
                if not body:
                    continue
                client_id = data.get("client_id")
                # Cap to a sane length — this is opaque to the server, only
                # echoed back. A malicious client can't grow our payloads.
                if client_id is not None and (not isinstance(client_id, str) or len(client_id) > 64):
                    client_id = None
                result = await _run_db(_persist_message(
                    channel_id=channel_id,
                    sender_id=user_id,
                    sender_name=user_name,
                    sender_color=user_color,
                    body=body,
                    reply_to_id=data.get("reply_to_id"),
                    client_id=client_id,
                ))
                if result.get("error") == "muted":
                    await websocket.send_json({"type": "error", "message": "You are muted in this channel"})
                    continue
                if result.get("error") == "not_member":
                    await websocket.close(code=4403)
                    return
                await chat_manager.broadcast(room, result["payload"])
                for notif in result.get("notifications", []):
                    await push_to_user(notif["user_id"], {
                        "type": "notification",
                        "notification": notif["notification"],
                    })

            elif kind == "typing":
                # Typing doesn't touch the DB — skip the round-trip entirely.
                await chat_manager.broadcast(
                    room,
                    {"type": "typing", "user_id": user_id, "name": user_name},
                    exclude=websocket,
                )

            elif kind == "reaction":
                message_id = data.get("message_id")
                emoji = (data.get("emoji") or "").strip()
                if not message_id or not emoji:
                    continue
                payload = await _run_db(_toggle_reaction(channel_id, message_id, user_id, user_name, emoji))
                if payload:
                    await chat_manager.broadcast(room, payload)

            elif kind == "delete":
                message_id = data.get("message_id")
                if not message_id:
                    continue
                result = await _run_db(_soft_delete_message(channel_id, message_id, user_id))
                if result.get("error") == "forbidden":
                    await websocket.send_json({"type": "error", "message": "Cannot delete this message"})
                    continue
                if result.get("broadcast"):
                    await chat_manager.broadcast(room, result["broadcast"])

            elif kind == "read":
                last_read_id = data.get("last_read_message_id")
                if not last_read_id:
                    continue
                await _run_db(_update_read_receipt(channel_id, user_id, last_read_id))
                await chat_manager.broadcast(room, {
                    "type": "read_receipt",
                    "user_id": user_id,
                    "user_name": user_name,
                    "last_read_message_id": last_read_id,
                }, exclude=websocket)

    except WebSocketDisconnect:
        pass
    finally:
        await chat_manager.leave(room, websocket)
        await chat_manager.broadcast(
            room,
            {"type": "presence", "user_id": user_id, "name": user_name, "joined": False},
        )
