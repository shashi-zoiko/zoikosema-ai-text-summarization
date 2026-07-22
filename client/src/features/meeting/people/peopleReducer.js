/**
 * PeopleReducer — the pure, framework-free heart of the People module.
 *
 * Owns the normalized participant model and every state transition. No React, no
 * LiveKit, no network — a pure `(state, event) -> state` function, unit-testable
 * in Node (see peopleReducer.test.js). The store (peopleStore.js) wraps it for
 * useSyncExternalStore; the realtime engine (realtimeEngine.js) feeds it events.
 *
 * Guarantees implemented here:
 *   • Snapshot loading + authoritative reconciliation.
 *   • Ordered deltas by monotonic control-plane `seq` (generalizes the caption
 *     store's per-sender seq discipline to a single room-wide sequence).
 *   • Gap detection: seq > expected buffers out-of-order deltas and flags a gap
 *     for the engine to recover (snapshot/replay) — never applies past a hole.
 *   • Duplicate rejection: seq <= applied is dropped.
 *   • Buffered out-of-order replay: on catch-up, contiguous buffered deltas drain.
 *   • Deduplication: one canonical key per person (identity.js) → never two rows.
 *   • Version tracking: global + per-entity versions for conflict/rerender checks.
 *   • Two-plane authoritative merge: control plane (seq'd) owns role/hand/waiting;
 *     media plane (LiveKit presence, not seq'd) owns mic/camera/presenting/
 *     connection/sessions/active-membership. Disjoint field ownership → no
 *     cross-plane conflict.
 *   • Pending action tracking WITHOUT optimistic completion: a pending action
 *     never mutates authoritative fields; it clears only when a real server event
 *     satisfies it.
 *
 * State reference identity is preserved when nothing changes, so subscribers do
 * not re-render on dropped/duplicate/no-op events.
 */
import {
  ROLE, STATUS, DEVICE, CONN, DELTA, EVENT, PENDING_STATE, MAX_BUFFERED_DELTAS,
} from './constants.js'
import { personKey, keyFromUserId, userIdToIdentity, identityToUserId } from './identity.js'

/** @returns {object} a fresh, empty reducer state */
export function initialPeopleState() {
  return {
    ready: false, // snapshot has been loaded at least once
    seq: 0, // last applied control-plane seq
    byId: {}, // key -> Person (immutable snapshots)
    order: [], // stable join order of keys (never reordered by speaker/role)
    buffer: {}, // seq -> delta, out-of-order deltas awaiting catch-up
    gap: null, // { expected, got } when a hole is detected; null otherwise
    needsResync: false, // buffer overflow / unrecoverable gap → engine must snapshot
    version: 0, // global state version (bumps on every applied mutation)
    permissions: {}, // meeting-level permission flags (chat/screenshare/locked/…)
    // NOTE: `dropped` is owned by the store (peopleStore.js), not the reducer —
    // dropping a duplicate must not change state identity, so it can't live here.
    stats: { applied: 0, buffered: 0, gaps: 0, snapshots: 0 },
  }
}

function makePerson(patch) {
  return {
    key: patch.key,
    userId: patch.userId ?? null,
    identity: patch.identity ?? (patch.userId != null ? userIdToIdentity(patch.userId) : null),
    name: patch.name ?? 'Guest',
    isSelf: !!patch.isSelf,
    isGuest: !!patch.isGuest,
    role: patch.role ?? ROLE.PARTICIPANT,
    status: patch.status ?? STATUS.ACTIVE,
    handRaised: !!patch.handRaised,
    handRaisedAt: patch.handRaisedAt ?? null,
    presenting: !!patch.presenting,
    mic: patch.mic ?? DEVICE.UNKNOWN,
    camera: patch.camera ?? DEVICE.UNKNOWN,
    connection: patch.connection ?? CONN.UNKNOWN,
    sessions: patch.sessions ?? 1,
    avatarUrl: patch.avatarUrl ?? null,
    color: patch.color ?? null,
    requestedAt: patch.requestedAt ?? null,
    joinedAt: patch.joinedAt ?? null,
    v: 1,
    pending: patch.pending ?? null,
  }
}

const PERSON_FIELDS = [
  'userId', 'identity', 'name', 'isSelf', 'isGuest', 'role', 'status', 'handRaised',
  'handRaisedAt', 'presenting', 'mic', 'camera', 'connection', 'sessions',
  'avatarUrl', 'color', 'requestedAt', 'joinedAt', 'pending',
]

/** Merge a patch into a person; returns prev unchanged if nothing differs. */
function mergePerson(prev, patch) {
  let changed = false
  const next = { ...prev }
  for (const f of PERSON_FIELDS) {
    if (f in patch && patch[f] !== undefined && patch[f] !== prev[f]) {
      next[f] = patch[f]
      changed = true
    }
  }
  if (!changed) return prev
  next.v = prev.v + 1
  return next
}

/** Does an authoritative person state satisfy (and thus clear) its pending action? */
function pendingSatisfied(person) {
  const p = person.pending
  if (!p || p.state !== PENDING_STATE.PENDING) return false
  switch (p.action) {
    case 'promote':
      return person.role === ROLE.COHOST || person.role === ROLE.HOST
    case 'demote':
      return person.role === ROLE.PARTICIPANT
    case 'admit':
    case 'deny':
      // Confirmed once the person is no longer waiting (admitted, denied/left).
      return person.status !== STATUS.WAITING
    case 'lower_hand':
      return person.handRaised === false
    default:
      return false
  }
}

/** Clear a person's pending if a real event has satisfied it. */
function reconcilePending(person) {
  if (pendingSatisfied(person)) {
    if (person.pending === null) return person
    return { ...person, pending: null, v: person.v + 1 }
  }
  return person
}

function withPerson(state, key, nextPerson, order) {
  const byId = { ...state.byId, [key]: nextPerson }
  return { ...state, byId, order: order ?? state.order, version: state.version + 1 }
}

function removePerson(state, key) {
  if (!(key in state.byId)) return state
  const byId = { ...state.byId }
  delete byId[key]
  const order = state.order.includes(key) ? state.order.filter((k) => k !== key) : state.order
  return { ...state, byId, order, version: state.version + 1 }
}

function upsertOrder(order, key) {
  return order.includes(key) ? order : [...order, key]
}

// ── Normalizers: raw wire records → person patches (single keyspace) ──────────

/** Control-plane peer/self record (from welcome/snapshot). */
export function normalizePeer(rec, { isSelf = false } = {}) {
  const key = personKey(rec.user_id ?? rec.userId ?? rec.identity)
  if (key == null) return null
  return {
    key,
    userId: rec.user_id ?? rec.userId ?? null,
    identity: rec.identity ?? null,
    name: rec.name ?? rec.display_name ?? undefined,
    isSelf,
    isGuest: rec.is_guest ?? rec.isGuest ?? false,
    role: rec.role ?? ROLE.PARTICIPANT,
    status: STATUS.ACTIVE,
    handRaised: rec.hand ?? rec.handRaised ?? false,
    presenting: rec.presenting ?? rec.screen ?? false,
    avatarUrl: rec.avatar_url ?? rec.avatarUrl ?? null,
    color: rec.color ?? null,
    joinedAt: rec.joined_at ?? rec.joinedAt ?? null,
  }
}

/** Waiting-room record. */
export function normalizeWaiting(rec) {
  const key = personKey(rec.user_id ?? rec.userId)
  if (key == null) return null
  return {
    key,
    userId: rec.user_id ?? rec.userId ?? null,
    name: rec.name ?? undefined,
    isGuest: rec.is_guest ?? rec.isGuest ?? true,
    status: STATUS.WAITING,
    role: ROLE.PARTICIPANT,
    avatarUrl: rec.avatar_url ?? rec.avatarUrl ?? null,
    color: rec.color ?? null,
    requestedAt: rec.joined_at ?? rec.requestedAt ?? rec.requested_at ?? null,
  }
}

/** Media-plane peer (from LiveKit useParticipants()). */
export function normalizeMediaPeer(rec) {
  const key = personKey(rec.identity ?? rec.userId ?? rec.user_id)
  if (key == null) return null
  return {
    key,
    identity: rec.identity ?? null,
    // Derive from identity when the caller didn't supply it, so media-sourced
    // people always carry a user_id for privileged actions (promote/demote).
    userId: rec.userId ?? rec.user_id ?? identityToUserId(rec.identity),
    name: rec.name ?? undefined,
    isSelf: rec.isSelf,
    isGuest: rec.isGuest,
    status: STATUS.ACTIVE,
    mic: rec.mic ?? DEVICE.UNKNOWN,
    camera: rec.camera ?? DEVICE.UNKNOWN,
    presenting: rec.presenting ?? false,
    connection: rec.connection ?? CONN.UNKNOWN,
    sessions: rec.sessions ?? 1,
    avatarUrl: rec.avatarUrl ?? undefined,
    color: rec.color ?? undefined,
  }
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

function applySnapshot(state, ev) {
  const seq = ev.seq ?? 0
  const peers = Array.isArray(ev.peers) ? ev.peers : []
  const waiting = Array.isArray(ev.waiting) ? ev.waiting : []
  const selfKey = ev.self ? personKey(ev.self.user_id ?? ev.self.userId ?? ev.self.identity) : null

  const byId = {}
  const order = []
  // Preserve prior media fields (LiveKit plane) across a control snapshot so a
  // resync doesn't blank mic/camera/connection that the control plane never sends.
  const carryMedia = (key, patch) => {
    const prev = state.byId[key]
    if (prev) {
      patch.mic = patch.mic ?? prev.mic
      patch.camera = patch.camera ?? prev.camera
      patch.connection = patch.connection ?? prev.connection
      patch.presenting = patch.presenting ?? prev.presenting
      patch.sessions = patch.sessions ?? prev.sessions
      patch.identity = patch.identity ?? prev.identity
      patch.pending = prev.pending // pending survives resync; reconciled below
    }
    return patch
  }

  for (const raw of peers) {
    const patch = normalizePeer(raw, { isSelf: selfKey != null && personKey(raw.user_id ?? raw.userId ?? raw.identity) === selfKey })
    if (!patch) continue
    byId[patch.key] = reconcilePending(makePerson(carryMedia(patch.key, patch)))
    order.push(patch.key)
  }
  for (const raw of waiting) {
    const patch = normalizeWaiting(raw)
    if (!patch || byId[patch.key]) continue // dedup: never a waiting + active double
    byId[patch.key] = reconcilePending(makePerson(carryMedia(patch.key, patch)))
    order.push(patch.key)
  }

  // Drain any buffered deltas that are already covered by / follow this snapshot.
  let next = {
    ...state,
    ready: true,
    seq,
    byId,
    order,
    gap: null,
    needsResync: false,
    permissions: ev.permissions ? { ...ev.permissions } : state.permissions,
    version: state.version + 1,
    stats: { ...state.stats, snapshots: state.stats.snapshots + 1 },
  }
  next = drainBuffer(next)
  return next
}

// ── Deltas ──────────────────────────────────────────────────────────────────

function applyDeltaPayload(state, delta) {
  const kind = delta.kind
  switch (kind) {
    case DELTA.JOINED: {
      const patch = normalizePeer(delta.peer ?? delta, {})
      if (!patch) return state
      const prev = state.byId[patch.key]
      const person = prev ? mergePerson(prev, { ...patch, status: STATUS.ACTIVE }) : makePerson(patch)
      if (person === prev) return state
      return withPerson(state, patch.key, reconcilePending(person), upsertOrder(state.order, patch.key))
    }
    case DELTA.LEFT: {
      const key = personKey(delta.user_id ?? delta.userId ?? delta.key ?? delta.identity)
      if (key == null) return state
      // If they still have a pending action, keep the row (with an error/pending
      // indicator) rather than dropping it mid-flight.
      const prev = state.byId[key]
      if (prev?.pending?.state === PENDING_STATE.PENDING) {
        return withPerson(state, key, mergePerson(prev, { status: STATUS.LEFT }))
      }
      return removePerson(state, key)
    }
    case DELTA.ROLE: {
      const key = personKey(delta.user_id ?? delta.userId ?? delta.key)
      const prev = key != null ? state.byId[key] : null
      if (!prev) return state
      const next = reconcilePending(mergePerson(prev, { role: delta.role }))
      if (next === prev) return state
      return withPerson(state, key, next)
    }
    case DELTA.HAND: {
      const key = personKey(delta.user_id ?? delta.userId ?? delta.key)
      const prev = key != null ? state.byId[key] : null
      if (!prev) return state
      const raised = !!(delta.raised ?? delta.hand)
      const next = reconcilePending(mergePerson(prev, {
        handRaised: raised,
        handRaisedAt: raised ? (delta.at ?? prev.handRaisedAt ?? state.version) : null,
      }))
      if (next === prev) return state
      return withPerson(state, key, next)
    }
    case DELTA.WAITING_ADD: {
      const patch = normalizeWaiting(delta.peer ?? delta)
      if (!patch) return state
      const prev = state.byId[patch.key]
      if (prev && prev.status === STATUS.ACTIVE) return state // dedup: active wins
      const person = prev ? mergePerson(prev, patch) : makePerson(patch)
      if (person === prev) return state
      return withPerson(state, patch.key, person, upsertOrder(state.order, patch.key))
    }
    case DELTA.WAITING_REMOVE: {
      const key = personKey(delta.user_id ?? delta.userId ?? delta.key)
      if (key == null) return state
      const prev = state.byId[key]
      if (!prev) return state
      // Removed from the queue = admitted or denied. Clear a pending admit/deny;
      // drop the waiting row (media plane will re-add them as ACTIVE if admitted).
      if (prev.status === STATUS.WAITING) return removePerson(state, key)
      return state
    }
    case DELTA.WAITING_RESET: {
      const list = Array.isArray(delta.waiting) ? delta.waiting : []
      const nextKeys = new Set()
      let next = state
      for (const raw of list) {
        const patch = normalizeWaiting(raw)
        if (!patch) continue
        nextKeys.add(patch.key)
        const prev = next.byId[patch.key]
        if (prev && prev.status === STATUS.ACTIVE) continue
        const person = prev ? mergePerson(prev, patch) : makePerson(patch)
        if (person !== prev) next = withPerson(next, patch.key, person, upsertOrder(next.order, patch.key))
      }
      // Drop waiting rows no longer present in the authoritative full list.
      for (const key of Object.keys(next.byId)) {
        const person = next.byId[key]
        if (person.status === STATUS.WAITING && !nextKeys.has(key) &&
            person.pending?.state !== PENDING_STATE.PENDING) {
          next = removePerson(next, key)
        }
      }
      return next
    }
    case DELTA.PERMISSIONS: {
      const perms = delta.permissions ?? delta
      return { ...state, permissions: { ...state.permissions, ...perms }, version: state.version + 1 }
    }
    default:
      return state
  }
}

function drainBuffer(state) {
  let next = state
  while (next.buffer[next.seq + 1]) {
    const delta = next.buffer[next.seq + 1]
    const buffer = { ...next.buffer }
    delete buffer[next.seq + 1]
    const applied = applyDeltaPayload({ ...next, buffer }, delta)
    next = { ...applied, seq: next.seq + 1 }
  }
  // If the buffer drained the gap, clear it.
  if (next.gap && !hasBufferedAbove(next.buffer, next.seq)) {
    next = { ...next, gap: null }
  } else if (next.gap && next.buffer[next.seq + 1] === undefined && Object.keys(next.buffer).length > 0) {
    // still a hole — keep gap
  }
  return next
}

function hasBufferedAbove(buffer, seq) {
  for (const k of Object.keys(buffer)) if (Number(k) > seq) return true
  return false
}

function applyDelta(state, ev) {
  const seq = ev.seq
  if (typeof seq !== 'number') {
    // Unsequenced delta (legacy/compat) — apply directly, don't touch seq.
    const applied = applyDeltaPayload(state, ev.delta ?? ev)
    if (applied === state) return state
    return { ...applied, stats: { ...applied.stats, applied: applied.stats.applied + 1 } }
  }

  // Not ready yet — buffer until a snapshot establishes the baseline seq.
  if (!state.ready) {
    return bufferDelta(state, ev)
  }
  // Duplicate / straggler — return the SAME reference so subscribers do not
  // re-render on a dropped event (the store counts drops for telemetry).
  if (seq <= state.seq) {
    return state
  }
  // Contiguous — apply then drain any buffered followers.
  if (seq === state.seq + 1) {
    let next = applyDeltaPayload(state, ev.delta ?? ev)
    next = { ...next, seq }
    next = drainBuffer(next)
    return { ...next, stats: { ...next.stats, applied: next.stats.applied + 1 } }
  }
  // Gap: seq is ahead of expected. Buffer and flag for recovery.
  return bufferDelta(state, ev, /* gap */ true)
}

function bufferDelta(state, ev, gap = false) {
  const seq = ev.seq
  if (state.buffer[seq]) {
    return state // already buffered — same reference, no re-render
  }
  const bufferedCount = Object.keys(state.buffer).length
  if (bufferedCount >= MAX_BUFFERED_DELTAS) {
    // Overflow: give up on ordered replay, demand a fresh snapshot.
    return {
      ...state,
      needsResync: true,
      gap: state.gap ?? { expected: state.seq + 1, got: seq },
      stats: { ...state.stats, gaps: state.stats.gaps + 1 },
    }
  }
  const buffer = { ...state.buffer, [seq]: ev.delta ?? ev }
  const stats = { ...state.stats, buffered: state.stats.buffered + 1 }
  if (gap && state.ready) {
    return {
      ...state,
      buffer,
      gap: state.gap ?? { expected: state.seq + 1, got: seq },
      stats: { ...stats, gaps: state.gap ? stats.gaps : stats.gaps + 1 },
    }
  }
  return { ...state, buffer, stats }
}

// ── Media plane (LiveKit) authoritative upsert ────────────────────────────────

function applyMediaPresence(state, ev) {
  const peers = Array.isArray(ev.peers) ? ev.peers : []
  const full = ev.full !== false // default: authoritative full snapshot of present peers
  const present = new Set()
  let next = state

  for (const raw of peers) {
    const patch = normalizeMediaPeer(raw)
    if (!patch) continue
    present.add(patch.key)
    const prev = next.byId[patch.key]
    if (prev) {
      const merged = mergePerson(prev, { ...patch, status: STATUS.ACTIVE })
      if (merged !== prev) next = withPerson(next, patch.key, reconcilePending(merged), upsertOrder(next.order, patch.key))
    } else {
      next = withPerson(next, patch.key, makePerson(patch), upsertOrder(next.order, patch.key))
    }
  }

  // Removal only on a NON-EMPTY authoritative snapshot. An empty media list means
  // the media plane isn't ready yet (the local participant is always present in a
  // live call), NOT that everyone left — removing here would wipe a fresh seed.
  if (full && present.size > 0) {
    // Media plane is authoritative for presence: anyone previously ACTIVE but
    // absent from this snapshot has left the media session. Keep waiting rows and
    // rows with a pending action.
    for (const key of Object.keys(next.byId)) {
      const person = next.byId[key]
      if (person.status === STATUS.ACTIVE && !present.has(key) &&
          person.pending?.state !== PENDING_STATE.PENDING) {
        next = removePerson(next, key)
      }
    }
  }
  return next
}

// ── Pending actions (no optimistic completion) ────────────────────────────────

function applyPending(state, ev) {
  const key = personKey(ev.key ?? ev.user_id ?? ev.userId)
  if (key == null) return state
  const prev = state.byId[key]
  if (!prev) return state
  const pending = {
    action: ev.action,
    state: PENDING_STATE.PENDING,
    idemKey: ev.idemKey ?? null,
    atSeq: ev.atSeq ?? state.seq,
    reason: null,
  }
  // Does NOT mutate role/status/hand — authoritative fields only change on a
  // real server event. This is the "no optimistic completion" contract.
  return withPerson(state, key, { ...prev, pending, v: prev.v + 1 })
}

function applyPendingCleared(state, ev) {
  const key = personKey(ev.key ?? ev.user_id ?? ev.userId)
  const prev = key != null ? state.byId[key] : null
  if (!prev || !prev.pending) return state
  if (ev.action && prev.pending.action !== ev.action) return state
  return withPerson(state, key, { ...prev, pending: null, v: prev.v + 1 })
}

function applyPendingFailed(state, ev) {
  const key = personKey(ev.key ?? ev.user_id ?? ev.userId)
  const prev = key != null ? state.byId[key] : null
  if (!prev || !prev.pending) return state
  if (ev.action && prev.pending.action !== ev.action) return state
  const pending = { ...prev.pending, state: PENDING_STATE.FAILED, reason: ev.reason ?? 'failed' }
  return withPerson(state, key, { ...prev, pending, v: prev.v + 1 })
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Pure reducer. Returns a new state, or the SAME reference when the event caused
 * no change (dropped duplicate, no-op) so subscribers don't re-render.
 * @param {object} state
 * @param {{type: string} & object} ev
 */
export function reducePeople(state, ev) {
  if (!ev || typeof ev.type !== 'string') return state
  switch (ev.type) {
    case EVENT.SNAPSHOT:
      return applySnapshot(state, ev)
    case EVENT.DELTA:
      return applyDelta(state, ev)
    case EVENT.MEDIA_PRESENCE:
      return applyMediaPresence(state, ev)
    case EVENT.PENDING:
      return applyPending(state, ev)
    case EVENT.PENDING_CLEARED:
      return applyPendingCleared(state, ev)
    case EVENT.PENDING_FAILED:
      return applyPendingFailed(state, ev)
    case EVENT.RESET:
      return initialPeopleState()
    default:
      return state
  }
}

// Re-export the key helper used by callers building events.
export { keyFromUserId }
