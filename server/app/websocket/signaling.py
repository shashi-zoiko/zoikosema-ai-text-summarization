import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.deps import get_participant_from_token
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

log = logging.getLogger(__name__)

router = APIRouter()


async def _run(fn, *args, **kwargs):
    """Run a blocking SQLAlchemy / bcrypt call off the event loop.

    This handler is `async` but does synchronous psycopg2 and bcrypt work; run
    inline, each call blocked the single uvicorn event loop for its DB round-trip
    (or ~50-100ms of bcrypt), so one participant's join/admit froze every other
    socket on the instance — the meeting "freeze at ~15 joins" symptom. Offloading
    to a worker thread keeps the loop free.

    Safe with the shared per-connection Session: it is touched only by this one
    coroutine and these calls are always awaited sequentially (never two in flight
    for the same session), so no cross-thread session access ever overlaps.
    """
    if kwargs:
        return await asyncio.to_thread(lambda: fn(*args, **kwargs))
    return await asyncio.to_thread(fn, *args)


# Track connection metadata per websocket
_conn_info: dict[WebSocket, dict] = {}
# Reverse lookup: (meeting_id, user_id) -> WebSocket (for sending admission signals)
_user_ws: dict[tuple[int, int], WebSocket] = {}
# (meeting_id, user_id) -> asyncio.Event that wakes a waiting-room hold loop the
# instant the host admits/denies, instead of waiting for the next safety poll or
# a client keepalive ping. Set by both the WS host-action handler and the REST
# admit/deny endpoints (which run on the same event loop).
_status_events: dict[tuple[int, int], asyncio.Event] = {}


def _status_event(meeting_id: int, user_id: int) -> asyncio.Event:
    key = (meeting_id, user_id)
    ev = _status_events.get(key)
    if ev is None:
        ev = asyncio.Event()
        _status_events[key] = ev
    return ev


def wake_status_waiter(meeting_id: int, user_id: int) -> None:
    """Wake this user's waiting-room hold loop so it re-reads status now."""
    ev = _status_events.get((meeting_id, user_id))
    if ev is not None:
        ev.set()


async def notify_user(meeting_id: int, user_id: int, payload: dict) -> bool:
    """Push a JSON payload to a single user's live meeting socket.

    Returns True if a socket existed and the send succeeded. Safe to call from
    any coroutine running on the serving loop (REST admit/deny do).
    """
    ws = _user_ws.get((meeting_id, user_id))
    if ws is None:
        return False
    try:
        await ws.send_json(payload)
        return True
    except Exception:
        return False


async def signal_admitted(meeting_id: int, user_id: int) -> None:
    """Instant admission notification: push 'admitted' to the waiting client AND
    wake its server-side hold loop. Idempotent — safe to call more than once."""
    delivered = await notify_user(meeting_id, user_id, {"type": "admitted"})
    wake_status_waiter(meeting_id, user_id)
    log.info(
        "[ADMISSION_EVENT_SENT] meeting=%s user=%s type=admitted delivered=%s",
        meeting_id, user_id, delivered,
    )


async def signal_admitted_many(meeting_id: int, user_ids: list[int]) -> None:
    """Fan out 'admitted' to many waiting clients CONCURRENTLY.

    Admit-all previously awaited signal_admitted() one user at a time, so the
    host's request blocked on N sequential socket sends (and each wake). Each
    push targets a different socket and is independent, so we gather them — the
    whole fan-out now costs ~one send, not N. Exceptions are swallowed per user
    (gather return_exceptions) so one dead socket can't sink the rest."""
    if not user_ids:
        return
    await asyncio.gather(
        *(signal_admitted(meeting_id, uid) for uid in user_ids),
        return_exceptions=True,
    )


async def signal_denied(meeting_id: int, user_id: int) -> None:
    """Instant denial notification: push 'denied' + wake the hold loop."""
    await notify_user(meeting_id, user_id, {"type": "denied"})
    wake_status_waiter(meeting_id, user_id)
    log.info("[ADMISSION_EVENT_SENT] meeting=%s user=%s type=denied", meeting_id, user_id)


async def broadcast_event(code: str, payload: dict) -> None:
    """Broadcast an app-level event to every connected socket in a meeting room.

    Callable from REST handlers (running on the serving loop) so server-side
    state changes — e.g. recording start/stop — reach all participants over the
    same control WS that carries chat/reactions/etc.
    """
    await meet_manager.broadcast(f"meeting:{code}", payload)


async def broadcast_waiting_list(code: str, meeting_id: int) -> None:
    """Recompute and push the waiting list to all host/co-host sockets in the
    room. Opens its own short-lived DB session so REST endpoints can call it."""
    db: Session = SessionLocal()
    try:
        meeting = await _run(db.get, Meeting, meeting_id)
        if meeting is not None:
            await _send_waiting_list(f"meeting:{code}", meeting, db)
    finally:
        db.close()


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
    from app.models.user import User

    # Bulk-load every pending user in ONE query instead of db.get() per row.
    # The per-row lookup was an N+1 that ran on every admit (the waiting list is
    # recomputed and rebroadcast each time), so an admit-all over N waiters cost
    # O(N²) point reads against the (possibly pooled/remote) DB. Both queries run
    # in one worker-thread hop so the event loop is never blocked on the DB here.
    def _load():
        rows = db.scalars(
            select(MeetingParticipant).where(
                MeetingParticipant.meeting_id == meeting.id,
                MeetingParticipant.status == STATUS_PENDING,
            )
        ).all()
        ids = [p.user_id for p in rows]
        by_id = (
            {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids))).all()}
            if ids
            else {}
        )
        return rows, by_id

    pending, users = await asyncio.to_thread(_load)
    waiting = []
    for p in pending:
        u = users.get(p.user_id)
        # joined_at drives the client-side "Waiting Xs" timer; email/avatar_url
        # enrich the People-panel waiting rows. All three are additive — older
        # clients ignore unknown fields.
        waiting.append({
            "user_id": p.user_id,
            "name": u.name if u else "Unknown",
            "color": u.avatar_color if u else "#5b8def",
            "is_guest": bool(u.is_guest) if u else False,
            "email": (u.email if u and not u.is_guest else None),
            "avatar_url": (u.avatar_url if u else None),
            "joined_at": p.joined_at.isoformat() if p.joined_at else None,
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
        # Accepts both signed-in users and anonymous guests (guest tokens). The
        # rest of this handler is identity-agnostic — a guest is a real User row
        # so every (meeting_id, user_id)-keyed path below works unchanged.
        user = await _run(get_participant_from_token, token, db)
        if not user:
            await websocket.close(code=4401)
            return

        meeting = await _run(db.scalar, select(Meeting).where(Meeting.code == code))
        if not meeting or not meeting.is_active:
            await websocket.close(code=4404)
            return

        # Meeting password check (host exempt). bcrypt is CPU-heavy (~50-100ms);
        # off-loop so a burst of joins to a locked meeting doesn't serialize on it.
        if meeting.password_hash and meeting.host_id != user.id:
            ok = bool(pwd) and await _run(verify_password, pwd, meeting.password_hash)
            if not ok:
                await websocket.close(code=4403, reason="Incorrect meeting password")
                return

        # ── Determine participant status ────────────────────────────────
        participant = await _run(_get_participant, meeting.id, user.id, db)
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
                await _run(db.commit)
            elif participant.status == STATUS_LEFT:
                # Re-joining after leaving
                if meeting.waiting_room_enabled and not is_host:
                    participant.status = STATUS_PENDING
                else:
                    participant.status = STATUS_ADMITTED
                participant.last_seen_at = datetime.now(timezone.utc)
                participant.left_at = None
                await _run(db.commit)
        else:
            # New participant
            if meeting.locked and not is_host:
                await websocket.close(code=4423)
                return
            role = ROLE_HOST if is_host else ROLE_PARTICIPANT
            status = STATUS_ADMITTED if is_host or not meeting.waiting_room_enabled else STATUS_PENDING

            def _create():
                p = MeetingParticipant(
                    meeting_id=meeting.id,
                    user_id=user.id,
                    role=role,
                    status=status,
                )
                db.add(p)
                try:
                    db.commit()
                except IntegrityError:
                    # Concurrent first-join raced two INSERTs; UNIQUE(meeting_id,
                    # user_id) rejects the loser. Recover the winner's row (same
                    # idiom as join_meeting) instead of 500ing the socket.
                    db.rollback()
                    p = db.scalars(
                        select(MeetingParticipant)
                        .where(
                            MeetingParticipant.meeting_id == meeting.id,
                            MeetingParticipant.user_id == user.id,
                        )
                        .order_by(MeetingParticipant.id.desc())
                    ).first()
                    if p is None:
                        raise
                    return p
                db.refresh(p)
                return p

            participant = await asyncio.to_thread(_create)

        # peer_id is ephemeral signaling state used only in-process (see the
        # _conn_info entries below) and is NEVER read back from Postgres. Keep it
        # in memory only — persisting it wrote to meeting_participants on EVERY WS
        # connect/reconnect (pure churn on the hot join path) for zero readers.
        peer_id = uuid.uuid4().hex[:10]

        await websocket.accept()
        room = f"meeting:{code}"

        host_or_cohost = await _run(_is_host_or_cohost, meeting, user.id, db)

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
                "is_guest": user.is_guest,
                "is_host_or_cohost": False,
                "role": participant.role,
                "status": STATUS_PENDING,
            }
            log.info("[WAITING_USER_CREATED] meeting=%s user=%s name=%s guest=%s", meeting.id, user.id, user.name, user.is_guest)

            await websocket.send_json({
                "type": "waiting-room-hold",
                "meeting_title": meeting.title,
            })

            # Notify hosts that someone is waiting
            await meet_manager.join(room, websocket)
            await _send_waiting_list(room, meeting, db)

            # ── Event-driven hold (no client-ping dependency) ───────────
            # Race three signals: (a) a frame from the client (leave / ping /
            # disconnect), (b) an admit/deny Event set the instant the host
            # acts, and (c) a 2 s safety timeout that re-reads the DB so the
            # user is NEVER stuck even if the push was lost or the tab is
            # backgrounded (which freezes the client's keepalive). On
            # admission we notify the client and close THIS socket — the
            # client then opens a fresh room socket (status is already
            # ADMITTED), so we never fall through to the welcome path here
            # and never risk a ghost from sending on a socket the client is
            # tearing down.
            status_ev = _status_event(meeting.id, user.id)
            status_ev.clear()
            recv_task = asyncio.ensure_future(websocket.receive_json())
            wait_task = asyncio.ensure_future(status_ev.wait())
            outcome = None  # 'admitted' | 'denied' | 'left' | 'disconnect'
            try:
                while outcome is None:
                    done, _ = await asyncio.wait(
                        {recv_task, wait_task},
                        timeout=2.0,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    if recv_task in done:
                        try:
                            data = recv_task.result()
                        except Exception:
                            outcome = "disconnect"
                            break
                        if (data or {}).get("type") == "leave":
                            outcome = "left"
                            break
                        # ping or other frame — keep listening
                        recv_task = asyncio.ensure_future(websocket.receive_json())
                    if wait_task in done:
                        status_ev.clear()
                        wait_task = asyncio.ensure_future(status_ev.wait())
                    # Re-read status on every wake (event or timeout). A fresh
                    # SELECT under READ COMMITTED sees the host's committed
                    # change made on another connection.
                    await _run(db.refresh, participant)
                    status_now = participant.status
                    if status_now == STATUS_ADMITTED:
                        outcome = "admitted"
                        break
                    if status_now in (STATUS_DENIED, STATUS_KICKED):
                        outcome = "denied"
                        break
                    # Release the pooled DB connection back between polls so N
                    # concurrent waiters don't each pin one for the whole wait
                    # (keeps headroom under the Supabase pooler at 20+ waiting
                    # users). The next refresh re-checks the row out cheaply.
                    await _run(db.rollback)
            finally:
                recv_task.cancel()
                wait_task.cancel()

            # ── Common cleanup for every pending exit ───────────────────
            # Only touch shared (meeting,user)-keyed state if THIS socket is
            # still the registered one. A newer tab/reconnect may have already
            # superseded us (dedup at join) and owns the key now — clobbering
            # its _user_ws / _status_events would strand the live socket.
            was_active = _user_ws.get((meeting.id, user.id)) is websocket
            await meet_manager.leave(room, websocket)
            _conn_info.pop(websocket, None)
            if was_active:
                _user_ws.pop((meeting.id, user.id), None)
                _status_events.pop((meeting.id, user.id), None)

            if outcome == "left" and was_active:
                participant.status = STATUS_LEFT
                participant.left_at = datetime.now(timezone.utc)
                await _run(db.commit)

            if outcome == "admitted":
                log.info("[ADMISSION_RECEIVED] meeting=%s user=%s", meeting.id, user.id)
                # Tell the lobby client to proceed; it closes this socket and
                # opens a fresh room socket. Guarded — the client may have
                # already closed after the host-side push.
                try:
                    await websocket.send_json({"type": "admitted"})
                except Exception:
                    pass
            elif outcome == "denied":
                try:
                    await websocket.send_json({"type": "denied"})
                    await websocket.close(code=4403)
                except Exception:
                    pass

            # Refresh the host's waiting list (someone left it) and exit. The
            # participant row keeps its ADMITTED status so the room socket
            # the client opens next is admitted straight through.
            await _send_waiting_list(room, meeting, db)
            return

        else:
            # Directly admitted — join the room
            _conn_info[websocket] = {
                "peer_id": peer_id,
                "user_id": user.id,
                "name": user.name,
                "color": user.avatar_color,
                "is_guest": user.is_guest,
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
            "is_guest": user.is_guest,
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
                "is_guest": bool(info.get("is_guest", False)),
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
                "is_guest": user.is_guest,
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
                # Release the pooled DB connection back to the pool while we
                # idle waiting for the next client frame. Without this, every
                # admitted participant pins one pooled connection for the WHOLE
                # meeting (the open transaction from join/welcome is never
                # ended), so ~15 participants exhaust the pool — and the
                # Supabase session pooler's 15-client cap — after which every
                # new join, admit-all, and even background init_db 500s. This
                # mirrors the same release the waiting-room hold loop already
                # does between polls; the next db.* re-checks a connection out
                # cheaply and processes the message.
                await _run(db.rollback)
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
                    # `body` is an E2E-encrypted envelope ("zk1:iv.ct"), NOT
                    # plaintext — the server relays it verbatim and cannot read
                    # it. The cap is generous (base64 of AES-GCM is ~33% larger
                    # than the plaintext) so a legit message is never truncated,
                    # which would corrupt the ciphertext and fail decryption.
                    # Refresh to honour live permission changes mid-meeting.
                    await _run(db.refresh, meeting)
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
                            "is_guest": user.is_guest,
                            "body": body[:8000],
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

                # ── Collaboration: annotations, presenters ──
                # NOTE: whiteboard/notes are intentionally NOT relayed. Each
                # participant keeps a private notebook (rich-text notes + personal
                # drawing canvas) persisted via the REST private-notes API; there
                # is deliberately no wb-stroke/wb-clear broadcast here.
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
                    await _run(db.refresh, meeting)
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
                    log.info("[ADMISSION_REQUEST] meeting=%s host=%s target=%s via=ws", meeting.id, user.id, target_user_id)
                    tp = await _run(_get_participant, meeting.id, target_user_id, db)
                    if tp and tp.status == STATUS_PENDING:
                        tp.status = STATUS_ADMITTED
                        tp.last_seen_at = datetime.now(timezone.utc)
                        await _run(db.commit)
                        await signal_admitted(meeting.id, target_user_id)
                        await _send_waiting_list(room, meeting, db)

                elif kind == "admit-all" and host_or_cohost:
                    def _admit_all():
                        rows = db.scalars(
                            select(MeetingParticipant).where(
                                MeetingParticipant.meeting_id == meeting.id,
                                MeetingParticipant.status == STATUS_PENDING,
                            )
                        ).all()
                        for tp in rows:
                            tp.status = STATUS_ADMITTED
                            tp.last_seen_at = datetime.now(timezone.utc)
                        db.commit()
                        return [tp.user_id for tp in rows]

                    target_ids = await asyncio.to_thread(_admit_all)
                    log.info("[ADMISSION_REQUEST] meeting=%s host=%s admit-all count=%s via=ws", meeting.id, user.id, len(target_ids))
                    await signal_admitted_many(meeting.id, target_ids)
                    await _send_waiting_list(room, meeting, db)

                elif kind == "deny" and host_or_cohost:
                    target_user_id = data.get("user_id")
                    if not target_user_id:
                        continue
                    tp = await _run(_get_participant, meeting.id, target_user_id, db)
                    if tp and tp.status == STATUS_PENDING:
                        tp.status = STATUS_DENIED
                        await _run(db.commit)
                        await signal_denied(meeting.id, target_user_id)
                        await _send_waiting_list(room, meeting, db)

                # ponytail: host "kick / remove participant" was removed by
                # product decision — hosts can no longer force-disconnect anyone.
                # STATUS_KICKED is kept only for historical rows + the join guard.

                elif kind == "promote" and meeting.host_id == user.id:
                    target_user_id = data.get("user_id")
                    if not target_user_id:
                        continue
                    tp = await _run(_get_participant, meeting.id, target_user_id, db)
                    if tp and tp.status == STATUS_ADMITTED:
                        tp.role = ROLE_COHOST if tp.role == ROLE_PARTICIPANT else ROLE_PARTICIPANT
                        await _run(db.commit)
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
                        await _run(db.commit)
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
                        await _run(db.commit)
                        await meet_manager.broadcast(
                            room,
                            {"type": "theme-changed", "theme": theme_id},
                        )

                elif kind == "lock" and host_or_cohost:
                    locked = bool(data.get("locked", True))
                    meeting.locked = locked
                    await _run(db.commit)
                    await meet_manager.broadcast(
                        room,
                        {"type": "meeting-locked", "locked": locked},
                    )

                # ponytail: in-meeting "end meeting for all" was removed — a host
                # now just leaves (Google-Meet style) and the meeting stays live
                # until everyone leaves. Deliberate admin teardown still lives in
                # the REST POST /api/meetings/{code}/end endpoint.

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

            # Update participant status (off-loop so a mass leave at meeting end
            # doesn't serialize every disconnect on the event loop).
            def _mark_disconnected():
                db.refresh(participant)
                if participant.status == STATUS_ADMITTED:
                    participant.status = STATUS_DISCONNECTED
                participant.last_seen_at = datetime.now(timezone.utc)
                if participant.status not in (STATUS_DISCONNECTED,):
                    participant.left_at = datetime.now(timezone.utc)
                db.commit()

            await asyncio.to_thread(_mark_disconnected)
    finally:
        db.close()
