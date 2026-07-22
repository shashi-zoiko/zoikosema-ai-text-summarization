/**
 * People realtime engine — binds the store to the live control-WS transport and
 * the LiveKit media plane.
 *
 * Responsibilities:
 *   • Translate control-WS messages into reducer events, threading the server
 *     `seq` when present. Backwards-compatible: messages WITHOUT a seq (today's
 *     fire-and-forget server) are applied as unsequenced deltas, so the engine
 *     works against both the current and the seq-stamped server.
 *   • Request a snapshot on (re)connect and whenever the store detects a gap /
 *     needs resync — recovery without a meeting rejoin.
 *   • Feed the LiveKit roster (useParticipants) in as authoritative media
 *     presence.
 *
 * The message translation is a pure function (translateMessage) so it is
 * unit-testable without a socket; the thin wiring (subscribe/send/timers) lives
 * in createRealtimeEngine.
 */
import { EVENT, DELTA } from './constants.js'
import { personKey } from './identity.js'

/**
 * Pure: control-WS message → reducer event (or null to ignore).
 * @param {object} msg parsed control-WS JSON
 */
export function translateMessage(msg) {
  if (!msg || typeof msg.type !== 'string') return null
  const seq = typeof msg.seq === 'number' ? msg.seq : undefined
  switch (msg.type) {
    case 'people-snapshot': // new authoritative snapshot (seq-stamped, full)
      return {
        type: EVENT.SNAPSHOT,
        seq: seq ?? 0,
        self: msg.self ?? null,
        peers: msg.peers ?? [],
        waiting: msg.waiting ?? [],
        permissions: msg.permissions ?? {},
        capabilities: msg.capabilities ?? null,
      }
    case 'peer-joined':
      return { type: EVENT.DELTA, seq, delta: { kind: DELTA.JOINED, peer: msg.peer ?? msg } }
    case 'peer-left':
      return { type: EVENT.DELTA, seq, delta: { kind: DELTA.LEFT, user_id: msg.user_id ?? msg.userId, identity: msg.identity } }
    case 'role-changed':
      return { type: EVENT.DELTA, seq, delta: { kind: DELTA.ROLE, user_id: msg.user_id ?? msg.userId, role: msg.role } }
    case 'raise-hand':
      return { type: EVENT.DELTA, seq, delta: { kind: DELTA.HAND, user_id: msg.user_id ?? msg.userId, raised: msg.raised ?? msg.hand, at: msg.at } }
    case 'waiting-room': // full waiting-list replace (idempotent)
      return { type: EVENT.DELTA, seq, delta: { kind: DELTA.WAITING_RESET, waiting: msg.waiting ?? msg.list ?? [] } }
    case 'meeting-permissions':
      return { type: EVENT.DELTA, seq, delta: { kind: DELTA.PERMISSIONS, permissions: msg.permissions ?? msg } }
    default:
      return null // admitted/denied/chat/reaction/caption/etc. are not People state
  }
}

const defaultNow = () =>
  (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

export function createRealtimeEngine({ store, transport, telemetry, now = defaultNow } = {}) {
  const telem = (name, props) => { try { telemetry?.(name, props) } catch { /* never break the pipeline */ } }
  let unsub = null
  let awaitingRecovery = false
  let recoveryStart = 0

  function requestSnapshot(reason = 'resync') {
    awaitingRecovery = true
    recoveryStart = now()
    try {
      transport.send({ type: 'people-snapshot-request', since: store.seq(), reason })
    } catch {
      // transport down — a reconnect will re-trigger this
    }
  }

  function handleMessage(msg) {
    // Legacy `welcome` is the initial roster snapshot but omits the waiting list
    // (a separate message). Carry the current waiting rows forward so a welcome
    // doesn't wipe the queue on reconnect.
    if (msg && msg.type === 'welcome') {
      const cur = store.getSnapshot()
      const waiting = Object.values(cur.byId)
        .filter((p) => p.status === 'waiting')
        .map((p) => ({ user_id: p.userId, name: p.name, is_guest: p.isGuest, color: p.color, avatar_url: p.avatarUrl, joined_at: p.requestedAt }))
      store.dispatch({
        type: EVENT.SNAPSHOT,
        seq: typeof msg.seq === 'number' ? msg.seq : cur.seq,
        self: msg.self ?? null,
        peers: msg.peers ?? [],
        waiting,
        permissions: msg.permissions ?? cur.permissions,
      })
      finishRecoveryIfPending()
      return
    }

    const ev = translateMessage(msg)
    if (!ev) return
    store.dispatch(ev)

    if (ev.type === EVENT.SNAPSHOT) finishRecoveryIfPending()

    // A detected gap / overflow triggers a single snapshot request for recovery.
    if (store.needsResync() && !awaitingRecovery) {
      requestSnapshot('gap')
    }
  }

  function finishRecoveryIfPending() {
    if (awaitingRecovery) {
      awaitingRecovery = false
      telem('people_reconnect_recovered', { recover_ms: Math.round(now() - recoveryStart) })
    }
  }

  /** Feed the authoritative LiveKit roster (from useParticipants). */
  function syncMedia(mediaPeers, { full = true } = {}) {
    store.dispatch({ type: EVENT.MEDIA_PRESENCE, peers: mediaPeers, full })
  }

  /** Call when the transport (re)connects — pull a fresh snapshot. */
  function onConnected() {
    requestSnapshot('connect')
  }

  function start() {
    unsub = transport.subscribe(handleMessage)
    return stop
  }
  function stop() {
    if (unsub) { unsub(); unsub = null }
  }

  return { start, stop, handleMessage, requestSnapshot, syncMedia, onConnected, personKey }
}
