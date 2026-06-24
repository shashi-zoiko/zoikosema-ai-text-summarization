import json
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select, desc, func, update
from sqlalchemy.orm import Session

from app.core.database import get_db, SessionLocal
from app.core.deps import get_current_user, get_user_from_token
from app.models.user import User
from app.models.organization import Notification
from app.schemas.organization import NotificationOut

router = APIRouter(tags=["notifications"])

# ── In-memory WS connections for real-time push ───────────────────────────
_ws_connections: Dict[int, list[WebSocket]] = {}


async def push_notification(user_id: int, notification: dict) -> None:
    """Push a notification to all connected WebSocket clients for a user."""
    conns = _ws_connections.get(user_id, [])
    dead = []
    for ws in conns:
        try:
            await ws.send_json({"type": "notification", "notification": notification})
        except Exception:
            dead.append(ws)
    for ws in dead:
        conns.remove(ws)


async def push_to_user(user_id: int, payload: dict) -> int:
    """Push an arbitrary JSON payload to all WS connections for a user.
    Returns the number of live connections the payload reached."""
    conns = _ws_connections.get(user_id, [])
    dead = []
    delivered = 0
    for ws in conns:
        try:
            await ws.send_json(payload)
            delivered += 1
        except Exception:
            dead.append(ws)
    for ws in dead:
        try:
            conns.remove(ws)
        except ValueError:
            pass
    return delivered


def create_notification_sync(
    db: Session,
    user_id: int,
    notif_type: str,
    title: str,
    body: str | None = None,
    data: dict | None = None,
) -> Notification:
    """Helper to create a notification from synchronous code (e.g. REST endpoints)."""
    notif = Notification(
        user_id=user_id,
        type=notif_type,
        title=title,
        body=body,
        data=json.dumps(data) if data else None,
    )
    db.add(notif)
    db.flush()
    return notif


# ── REST endpoints ────────────────────────────────────────────────────────

@router.get("/api/notifications", response_model=list[NotificationOut])
def list_notifications(
    unread_only: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        stmt = stmt.where(Notification.is_read == False)  # noqa: E712
    stmt = stmt.order_by(desc(Notification.created_at)).limit(limit)
    return db.scalars(stmt).all()


@router.get("/api/notifications/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    count = db.scalar(
        select(func.count()).where(
            Notification.user_id == user.id,
            Notification.is_read == False,  # noqa: E712
        )
    )
    return {"count": count or 0}


@router.post("/api/notifications/{notif_id}/read")
def mark_read(
    notif_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notif = db.scalar(
        select(Notification).where(
            Notification.id == notif_id,
            Notification.user_id == user.id,
        )
    )
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    db.commit()
    return {"detail": "Marked as read"}


@router.post("/api/notifications/read-all")
def mark_all_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read == False)  # noqa: E712
        .values(is_read=True)
    )
    db.commit()
    return {"detail": "All notifications marked as read"}


@router.delete("/api/notifications/{notif_id}", status_code=204)
def delete_notification(
    notif_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notif = db.scalar(
        select(Notification).where(
            Notification.id == notif_id,
            Notification.user_id == user.id,
        )
    )
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    db.delete(notif)
    db.commit()


# ── WebSocket for real-time notifications ─────────────────────────────────

@router.websocket("/ws/notifications")
async def ws_notifications(
    ws: WebSocket,
    token: str = Query(...),
):
    db = SessionLocal()
    try:
        user = get_user_from_token(token, db)
    except Exception:
        user = None
    # get_user_from_token returns None (not an exception) for an expired or
    # invalid token. Guard it explicitly — otherwise `user.id` below raised
    # AttributeError: 'NoneType' has no attribute 'id' and crashed the socket.
    if user is None:
        await ws.close(code=4401)
        db.close()
        return

    await ws.accept()

    if user.id not in _ws_connections:
        _ws_connections[user.id] = []
    _ws_connections[user.id].append(ws)

    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                continue
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        if user.id in _ws_connections:
            try:
                _ws_connections[user.id].remove(ws)
            except ValueError:
                pass
        db.close()
