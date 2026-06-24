import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.deps import get_user_from_token
from app.core.security import verify_password
from app.models.meeting import (
    Meeting,
    MeetingParticipant,
    ROLE_HOST,
    ROLE_COHOST,
    ROLE_PARTICIPANT,
    STATUS_PENDING,
    STATUS_ADMITTED,
    STATUS_DISCONNECTED,
    STATUS_DENIED,
    STATUS_KICKED,
    STATUS_LEFT,
)
from app.websocket.manager import meet_manager

router = APIRouter()


# Track connection metadata per websocket
_conn_info: dict[WebSocket, dict] = {}
# Reverse lookup: (meeting_id, user_id) -> WebSocket (for sending admission signals)
_user_ws: dict[tuple[int, int], WebSocket] = {}


def _is_host_or_cohost(meeting: Meeting, user_id: int, db: Session) -> bool:
    if meeting.host_id == user_id:
        return True
    p = db.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.user_id == user_id,
            MeetingParticipant.role == ROLE_COHOST,
        )
    )
    return p is not None


def _get_participant(meeting_id: int, user_id: int, db: Session) -> MeetingParticipant | None:
    return db.scalar(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting_id,
            MeetingParticipant.user_id == user_id,
        )
    )


async def _send_waiting_list(room: str, meeting: Meeting, db: Session):
    """Send the current waiting-room list to all host/co-host connections."""
    pending = db.scalars(
        select(MeetingParticipant).where(
            MeetingParticipant.meeting_id == meeting.id,
            MeetingParticipant.status == STATUS_PENDING,
        )
    ).all()

    waiting = []
    from app.models.user import User
    for p in pending:
        u = db.get(User, p.user_id)
        waiting.append({
            "user_id": p.user_id,
            "name": u.name if u else "Unknown",
            "color": u.avatar_color if u else "#5b8def",
        })

    for member_ws in meet_manager.members(room):
        info = _conn_info.get(member_ws)
        if info and info.get("is_host_or_cohost"):
            try:
                await member_ws.send_json({"type": "waiting-room", "waiting": waiting})
            except Exception:
                pass


@router.websocket("/ws/meetings/{code}")
async def meeting_ws(websocket: WebSocket, code: str, token: str = "", pwd: str = ""):
    db: Session = SessionLocal()
    try:
        user = get_user_from_token(token, db)
        if not user:
            await websocket.close(code=4401)
            return

        meeting = db.scalar(select(Meeting).where(Meeting.code == code))
        if not meeting or not meeting.is_active:
            await websocket.close(code=4404)
            return

        # Meeting password check (host exempt)
        if meeting.password_hash and meeting.host_id != user.id:
            if not pwd or not verify_password(pwd, meeting.password_hash):
                await websocket.close(code=4403, reason="Incorrect meeting password")
                return

        # ── Determine participant status ────────────────────────────────
        participant = _get_participant(meeting.id, user.id, db)
        is_host = meeting.host_id == user.id

        if participant:
            if participant.status in (STATUS_DENIED, STATUS_KICKED):
                await websocket.close(code=4403)
                return
            if participant.status == STATUS_DISCONNECTED:
                # Reconnection — re-admit
                participant.status = STATUS_ADMITTED
                participant.last_seen_at = datetime.now(timezone.utc)
                participant.left_at = None
                db.commit()
            elif participant.status == STATUS_LEFT:
                # Re-joining after leaving
                if meeting.waiting_room_enabled and not is_host:
                    participant.status = STATUS_PENDING
                else:
                    participant.status = STATUS_ADMITTED
                participant.last_seen_at = datetime.now(timezone.utc)
                participant.left_at = None
                db.commit()
        else:
            # New participant
            if meeting.locked and not is_host:
                await websocket.close(code=4423)
                return
            role = ROLE_HOST if is_host else ROLE_PARTICIPANT
            status = STATUS_ADMITTED if is_host or not meeting.waiting_room_enabled else STATUS_PENDING
            participant = MeetingParticipant(
                meeting_id=meeting.id,
                user_id=user.id,
                role=role,
                status=status,
            )
            db.add(participant)
            db.commit()
            db.refresh(participant)

        peer_id = uuid.uuid4().hex[:10]
        participant.peer_id = peer_id
        db.commit()

        await websocket.accept()
        room = f"meeting:{code}"

        host_or_cohost = _is_host_or_cohost(meeting, user.id, db)

        # If the same user already has a live WS in this meeting (extra tab,
        # stale connection that never sent a close frame, reconnect race),
        # evict the old one before registering the new one. Without this,
        # every reload/extra-tab paints a duplicate tile for the same user.
        prior_ws = _user_ws.get((meeting.id, user.id))
        if prior_ws is not None and prior_ws is not websocket:
            prior_info = _conn_info.pop(prior_ws, None)
            await meet_manager.leave(room, prior_ws)
            # Order matters: broadcast peer-left *before* closing the old WS.
            # Peers tear down their PC to the ghost on receiving peer-left,
            # which stops them rendering audio from the old session. If we
            # close first, the old client's onclose handler races with the
            # peer-left broadcast over the network — peers can keep playing
            # audio from the ghost PC for the duration of that round trip.
            if prior_info:
                await meet_manager.broadcast(
                    room,
                    {"type": "peer-left", "peer_id": prior_info["peer_id"]},
                )
            try:
                # 4001 = "superseded by a newer session" (see client onclose).
                # Distinct code so the old tab shows a clear message and does
                # not auto-reconnect, which would ping-pong with this tab.
                await prior_ws.close(code=4001, reason="superseded")
            except Exception:
                pass

        # Register reverse lookup
        _user_ws[(meeting.id, user.id)] = websocket

        # ── Waiting room: user is pending ───────────────────────────────
        if participant.status == STATUS_PENDING:
            _conn_info[websocket] = {
                "peer_id": peer_id,
                "user_id": user.id,
                "name": user.name,
                "color": user.avatar_color,
                "is_host_or_cohost": False,
                "role": participant.role,
                "status": STATUS_PENDING,
            }

            await websocket.send_json({
                "type": "waiting-room-hold",
                "meeting_title": meeting.title,
            })

            # Notify hosts that someone is waiting
            await meet_manager.join(room, websocket)
            await _send_waiting_list(room, meeting, db)

            try:
                while True:
                    data = await websocket.receive_json()
                    kind = data.get("type")

                    if kind == "leave":
                        participant.status = STATUS_LEFT
                        participant.left_at = datetime.now(timezone.utc)
                        db.commit()
                        break

                    # Check if status changed (admitted by host via REST or WS)
                    db.refresh(participant)
                    if participant.status == STATUS_ADMITTED:
                        break
                    if participant.status in (STATUS_DENIED, STATUS_KICKED):
                        await websocket.send_json({"type": "denied"})
                        await websocket.close(code=4403)
                        await meet_manager.leave(room, websocket)
                        _conn_info.pop(websocket, None)
                        if _user_ws.get((meeting.id, user.id)) is websocket:
                            _user_ws.pop((meeting.id, user.id), None)
                        await _send_waiting_list(room, meeting, db)
                        return
            except WebSocketDisconnect:
                await meet_manager.leave(room, websocket)
                _conn_info.pop(websocket, None)
                if _user_ws.get((meeting.id, user.id)) is websocket:
                    _user_ws.pop((meeting.id, user.id), None)
                await _send_waiting_list(room, meeting, db)
                return

            # If we get here, check if participant left voluntarily
            if participant.status == STATUS_LEFT:
                await meet_manager.leave(room, websocket)
                _conn_info.pop(websocket, None)
                if _user_ws.get((meeting.id, user.id)) is websocket:
                    _user_ws.pop((meeting.id, user.id), None)
                await _send_waiting_list(room, meeting, db)
                return

            # Admitted — fall through to main meeting loop
            await _send_waiting_list(room, meeting, db)

        else:
            # Directly admitted — join the room
            _conn_info[websocket] = {
                "peer_id": peer_id,
                "user_id": user.id,
                "name": user.name,
                "color": user.avatar_color,
                "is_host_or_cohost": host_or_cohost,
                "role": participant.role,
                "status": STATUS_ADMITTED,
            }
            await meet_manager.join(room, websocket)

        # ── Admitted: send welcome + enter main loop ────────────────────
        _conn_info[websocket] = {
            "peer_id": peer_id,
            "user_id": user.id,
            "name": user.name,
            "color": user.avatar_color,
            "is_host_or_cohost": host_or_cohost,
            "role": participant.role,
            "status": STATUS_ADMITTED,
            # Optimistic default for peer-joined / welcome — the joining
            # client will send its real media-state milliseconds later, but
            # this keeps existing keys in shape so consumers can rely on
            # peer.audio / peer.video always being defined.
            "audio": True,
            "video": True,
            "screen": False,
        }

        existing = []
        seen_user_ids: set[int] = set()
        stale_to_drop: list[WebSocket] = []
        for member_ws in meet_manager.members(room):
            info = _conn_info.get(member_ws)
            if not info or info.get("status") != STATUS_ADMITTED:
                continue
            if member_ws is websocket:
                continue
            uid = info.get("user_id")
            # `_user_ws` holds the single live ws per user (the dedup at join
            # guarantees this). Any other ws in the room set with the same
            # user_id is a ghost — a previous tab that died without a clean
            # close. Skip it and clean it up so it doesn't reach the welcome
            # peer list of any future joiner either.
            if uid is not None and _user_ws.get((meeting.id, uid)) is not member_ws:
                stale_to_drop.append(member_ws)
                continue
            # Belt-and-suspenders: even if _user_ws lookup somehow failed, do
            # not emit two peer entries for the same user_id.
            if uid in seen_user_ids:
                stale_to_drop.append(member_ws)
                continue
            seen_user_ids.add(uid)
            # Include current screen-share state so a late joiner shows the
            # correct "sharing" badge immediately, instead of waiting for
            # the next screen-share-started broadcast (which they missed).
            existing.append({
                "peer_id": info["peer_id"],
                "user_id": info["user_id"],
                "name": info["name"],
                "color": info["color"],
                "role": info.get("role", "participant"),
                # Include mic/camera state so the late joiner doesn't render
                # a <video> over a peer whose camera is actually off — that
                # element would freeze on whatever single frame happened to
                # arrive first (or stay black) until the next media-state
                # broadcast. Default to True for backwards compat with peers
                # that haven't sent a media-state yet.
                "audio": bool(info.get("audio", True)),
                "video": bool(info.get("video", True)),
                "screen": bool(info.get("screen", False)),
                "share_mode": info.get("share_mode"),
            })

        # Reap the ghosts we filtered out so they stop showing up everywhere.
        for ghost in stale_to_drop:
            ghost_info = _conn_info.pop(ghost, None)
            await meet_manager.leave(room, ghost)
            try:
                await ghost.close(code=4001, reason="superseded")
            except Exception:
                pass
            if ghost_info:
                await meet_manager.broadcast(
                    room,
                    {"type": "peer-left", "peer_id": ghost_info["peer_id"]},
                )

        await websocket.send_json({
            "type": "welcome",
            "self": {
                "peer_id": peer_id,
                "user_id": user.id,
                "name": user.name,
                "color": user.avatar_color,
            },
            "peers": existing,
            "is_host": is_host,
            "role": participant.role,
            "meeting": {
                "title": meeting.title,
                "waiting_room_enabled": meeting.waiting_room_enabled,
                "locked": meeting.locked,
                "chat_enabled": meeting.chat_enabled,
                "screenshare_enabled": meeting.screenshare_enabled,
                "theme": meeting.theme or "forest",
            },
        })

        # Notify everyone else
        await meet_manager.broadcast(
            room,
            {"type": "peer-joined", "peer": _conn_info[websocket]},
            exclude=websocket,
        )

        # If host just joined, send them the waiting list
        if host_or_cohost:
            await _send_waiting_list(room, meeting, db)

        try:
            while True:
                data = await websocket.receive_json()
                kind = data.get("type")

                # WebRTC SDP/ICE relay (offer/answer/ice-candidate) was removed
                # together with the peer-to-peer mesh room. LiveKit's SFU owns
                # ALL media signaling now — this control WS carries app-level
                # events only (chat, reactions, hand, waiting-room, host
                # actions, captions, whiteboard, theme). A stray media-signaling
                # frame from a stale client is ignored rather than relayed, so
                # no browser-to-browser media path can ever be established.
                if kind in {"offer", "answer", "ice-candidate"}:
                    continue

                if kind == "media-state":
                    audio_state = bool(data.get("audio", True))
                    video_state = bool(data.get("video", True))
                    screen_state = bool(data.get("screen", False))
                    # Persist on this connection's record so the next user to
                    # join sees the correct mic/camera state immediately via
                    # the welcome packet (existing-peers list). Without this,
                    # late joiners default to assuming every existing peer's
                    # camera is on and render an empty/frozen <video> until
                    # the next media-state message — the root cause of the
                    # "ghost face for new arrivals" half of the bug.
                    info = _conn_info.get(websocket)
                    if info is not None:
                        info["audio"] = audio_state
                        info["video"] = video_state
                        # Screen is tracked separately via screen-share-*
                        # events, but mirror it here for completeness.
                        info["screen"] = screen_state
                    await meet_manager.broadcast(
                        room,
                        {
                            "type": "media-state",
                            "peer_id": peer_id,
                            "audio": audio_state,
                            "video": video_state,
                            "screen": screen_state,
                        },
                        exclude=websocket,
                    )

                elif kind == "chat":
                    body = (data.get("body") or "").strip()
                    if not body:
                        continue
                    # Refresh to honour live permission changes mid-meeting.
                    db.refresh(meeting)
                    if not meeting.chat_enabled and not host_or_cohost:
                        await websocket.send_json({
                            "type": "permission-denied",
                            "action": "chat",
                            "reason": "Chat is disabled by the host.",
                        })
                        continue
                    await meet_manager.broadcast(
                        room,
                        {
                            "type": "chat",
                            "peer_id": peer_id,
                            "user_id": user.id,
                            "name": user.name,
                            "color": user.avatar_color,
                            "body": body[:2000],
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        },
                    )

                elif kind == "reaction":
                    await meet_manager.broadcast(
                        room,
                        {
                            "type": "reaction",
                            "peer_id": peer_id,
                            "user_id": user.id,
                            "name": user.name,
                            "emoji": (data.get("emoji") or "\U0001f44d")[:8],
                        },
                    )

                elif kind == "raise-hand":
                    await meet_manager.broadcast(
                        room,
                        {
                            "type": "raise-hand",
                            "peer_id": peer_id,
                            "user_id": user.id,
                            "name": user.name,
                            "raised": bool(data.get("raised", True)),
                        },
                    )

                elif kind == "caption":
                    # Browser-side speech recognition produces captions; the server
                    # only relays them to other peers, no transcript persistence.
                    text = (data.get("text") or "").strip()
                    if not text:
                        continue
                    await meet_manager.broadcast(
                        room,
                        {
                            "type": "caption",
                            "peer_id": peer_id,
                            "name": user.name,
                            "color": user.avatar_color,
                            "text": text[:300],
                            "is_final": bool(data.get("is_final", True)),
                        },
                        exclude=websocket,
                    )

                # ── Collaboration: whiteboard, annotations, presenters ──
                elif kind == "wb-stroke":
                    # Relay whiteboard stroke to all others
                    await meet_manager.broadcast(
                        room,
                        {
                            "type": "wb-stroke",
                            "peer_id": peer_id,
                            "name": user.name,
                            "stroke": data.get("stroke"),
                        },
                        exclude=websocket,
                    )

                elif kind == "wb-clear":
                    await meet_manager.broadcast(
                        room,
                        {"type": "wb-clear", "peer_id": peer_id, "name": user.name},
                        exclude=websocket,
                    )

                elif kind == "annotation":
                    # Relay screen annotation to all others
                    await meet_manager.broadcast(
                        room,
                        {
                            "type": "annotation",
                            "peer_id": peer_id,
                            "name": user.name,
                            "annotation": data.get("annotation"),
                        },
                        exclude=websocket,
                    )

                elif kind == "annotation-clear":
                    await meet_manager.broadcast(
                        room,
                        {"type": "annotation-clear", "peer_id": peer_id},
                        exclude=websocket,
                    )

                elif kind == "screen-share-started":
                    db.refresh(meeting)
                    if not meeting.screenshare_enabled and not host_or_cohost:
                        await websocket.send_json({
                            "type": "permission-denied",
                            "action": "screenshare",
                            "reason": "Screen sharing is disabled by the host.",
                        })
                        continue
                    # Record the active share so late joiners get it via welcome.
                    share_mode = data.get("share_mode", "screen")
                    info = _conn_info.get(websocket)
                    if info is not None:
                        info["screen"] = True
                        info["share_mode"] = share_mode
                    # Broadcast that a user started sharing (multi-presenter)
                    await meet_manager.broadcast(
                        room,
                        {
                            "type": "screen-share-started",
                            "peer_id": peer_id,
                            "name": user.name,
                            "share_mode": share_mode,
                        },
                        exclude=websocket,
                    )

                elif kind == "screen-share-stopped":
                    info = _conn_info.get(websocket)
                    if info is not None:
                        info["screen"] = False
                        info.pop("share_mode", None)
                    await meet_manager.broadcast(
                        room,
                        {
                            "type": "screen-share-stopped",
                            "peer_id": peer_id,
                            "name": user.name,
                        },
                        exclude=websocket,
                    )

                # ── Host/co-host actions via WebSocket ──────────────────
                elif kind == "admit" and host_or_cohost:
                    target_user_id = data.get("user_id")
                    if not target_user_id:
                        continue
                    tp = _get_participant(meeting.id, target_user_id, db)
                    if tp and tp.status == STATUS_PENDING:
                        tp.status = STATUS_ADMITTED
                        tp.last_seen_at = datetime.now(timezone.utc)
                        db.commit()
                        # Notify the waiting user
                        target_ws = _user_ws.get((meeting.id, target_user_id))
                        if target_ws:
                            try:
                                await target_ws.send_json({"type": "admitted"})
                            except Exception:
                                pass
                        await _send_waiting_list(room, meeting, db)

                elif kind == "admit-all" and host_or_cohost:
                    pending = db.scalars(
                        select(MeetingParticipant).where(
                            MeetingParticipant.meeting_id == meeting.id,
                            MeetingParticipant.status == STATUS_PENDING,
                        )
                    ).all()
                    for tp in pending:
                        tp.status = STATUS_ADMITTED
                        tp.last_seen_at = datetime.now(timezone.utc)
                        target_ws = _user_ws.get((meeting.id, tp.user_id))
                        if target_ws:
                            try:
                                await target_ws.send_json({"type": "admitted"})
                            except Exception:
                                pass
                    db.commit()
                    await _send_waiting_list(room, meeting, db)

                elif kind == "deny" and host_or_cohost:
                    target_user_id = data.get("user_id")
                    if not target_user_id:
                        continue
                    tp = _get_participant(meeting.id, target_user_id, db)
                    if tp and tp.status == STATUS_PENDING:
                        tp.status = STATUS_DENIED
                        db.commit()
                        target_ws = _user_ws.get((meeting.id, target_user_id))
                        if target_ws:
                            try:
                                await target_ws.send_json({"type": "denied"})
                            except Exception:
                                pass
                        await _send_waiting_list(room, meeting, db)

                elif kind == "kick" and host_or_cohost:
                    target_user_id = data.get("user_id")
                    if not target_user_id or target_user_id == meeting.host_id:
                        continue
                    tp = _get_participant(meeting.id, target_user_id, db)
                    if tp and tp.status == STATUS_ADMITTED:
                        tp.status = STATUS_KICKED
                        tp.left_at = datetime.now(timezone.utc)
                        db.commit()
                        # Find their websocket and notify
                        target_ws = _user_ws.get((meeting.id, target_user_id))
                        if target_ws:
                            try:
                                await target_ws.send_json({"type": "kicked"})
                            except Exception:
                                pass
                        # Broadcast peer-left
                        target_info = _conn_info.get(target_ws) if target_ws else None
                        if target_info:
                            await meet_manager.broadcast(
                                room,
                                {"type": "peer-left", "peer_id": target_info["peer_id"]},
                            )

                elif kind == "promote" and meeting.host_id == user.id:
                    target_user_id = data.get("user_id")
                    if not target_user_id:
                        continue
                    tp = _get_participant(meeting.id, target_user_id, db)
                    if tp and tp.status == STATUS_ADMITTED:
                        tp.role = ROLE_COHOST if tp.role == ROLE_PARTICIPANT else ROLE_PARTICIPANT
                        db.commit()
                        await meet_manager.broadcast(
                            room,
                            {
                                "type": "role-changed",
                                "user_id": target_user_id,
                                "role": tp.role,
                            },
                        )

                elif kind == "set-permissions" and host_or_cohost:
                    # Live-update meeting permissions and broadcast new state.
                    # Only the keys present in the payload are changed.
                    changed = False
                    if "chat_enabled" in data:
                        meeting.chat_enabled = bool(data["chat_enabled"])
                        changed = True
                    if "screenshare_enabled" in data:
                        meeting.screenshare_enabled = bool(data["screenshare_enabled"])
                        changed = True
                    if changed:
                        db.commit()
                        await meet_manager.broadcast(
                            room,
                            {
                                "type": "meeting-permissions",
                                "chat_enabled": meeting.chat_enabled,
                                "screenshare_enabled": meeting.screenshare_enabled,
                            },
                        )

                elif kind == "set-theme":
                    # Meeting-wide visual theme. Any participant may change it;
                    # it's a cosmetic, shared preference (not a host control).
                    # Persist so late joiners get it via welcome, then broadcast
                    # to everyone (sender included) so all stages re-skin in sync.
                    theme_id = (data.get("theme") or "").strip()[:24]
                    if theme_id and theme_id != meeting.theme:
                        meeting.theme = theme_id
                        db.commit()
                        await meet_manager.broadcast(
                            room,
                            {"type": "theme-changed", "theme": theme_id},
                        )

                elif kind == "lock" and host_or_cohost:
                    locked = bool(data.get("locked", True))
                    meeting.locked = locked
                    db.commit()
                    await meet_manager.broadcast(
                        room,
                        {"type": "meeting-locked", "locked": locked},
                    )

                elif kind == "end-meeting" and meeting.host_id == user.id:
                    meeting.is_active = False
                    meeting.ended_at = datetime.now(timezone.utc)
                    db.commit()
                    await meet_manager.broadcast(
                        room,
                        {"type": "meeting-ended"},
                    )
                    break

        except WebSocketDisconnect:
            pass
        finally:
            await meet_manager.leave(room, websocket)
            leaving = _conn_info.pop(websocket, None)
            # Only clear the reverse-lookup if it still points to *this* WS —
            # a newer session of the same user may have already replaced it
            # via the dedup at join, and we don't want to evict it.
            if _user_ws.get((meeting.id, user.id)) is websocket:
                _user_ws.pop((meeting.id, user.id), None)

            if leaving:
                await meet_manager.broadcast(
                    room,
                    {"type": "peer-left", "peer_id": leaving["peer_id"]},
                )

            # Update participant status
            db.refresh(participant)
            if participant.status == STATUS_ADMITTED:
                participant.status = STATUS_DISCONNECTED
            participant.last_seen_at = datetime.now(timezone.utc)
            if participant.status not in (STATUS_DISCONNECTED,):
                participant.left_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        db.close()
