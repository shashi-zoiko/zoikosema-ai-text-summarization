/**
 * Deterministic People fixtures for tests and synthetic scale readiness.
 *
 * No Math.random — everything derives from the index so runs are reproducible.
 * Used by unit tests, the 200-participant integration fixtures, and the 500-
 * participant synthetic scale/perf fixtures required by the spec.
 */
import { ROLE, DEVICE, CONN, EVENT, DELTA } from './constants.js'

const NAMES = ['Ava', 'Ben', 'Cara', 'Dan', 'Eve', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jack',
  'Kai', 'Lia', 'Mia', 'Noah', 'Owen', 'Pia', 'Quin', 'Rae', 'Sam', 'Tara']

/** Build `n` control-plane peer records, deterministically varied. */
export function buildPeers(n, { startId = 1, hostEvery = 0, cohostEvery = 7, guestEvery = 5, presentEvery = 11 } = {}) {
  const peers = []
  for (let i = 0; i < n; i++) {
    const id = startId + i
    let role = ROLE.PARTICIPANT
    if (hostEvery && i % hostEvery === 0) role = ROLE.HOST
    else if (i === 0) role = ROLE.HOST
    else if (cohostEvery && i % cohostEvery === 0) role = ROLE.COHOST
    peers.push({
      user_id: id,
      identity: `u:${id}`,
      name: `${NAMES[i % NAMES.length]} ${id}`,
      role,
      is_guest: guestEvery ? i % guestEvery === 0 && role === ROLE.PARTICIPANT : false,
      presenting: presentEvery ? i % presentEvery === 3 : false,
      avatar_url: null,
      color: `#${((id * 2654435761) >>> 8).toString(16).slice(0, 6).padStart(6, '0')}`,
      joined_at: 1_700_000_000_000 + id * 1000,
    })
  }
  return peers
}

/** Build `n` waiting-room records (oldest first by requestedAt). */
export function buildWaiting(n, { startId = 9000 } = {}) {
  const out = []
  for (let i = 0; i < n; i++) {
    const id = startId + i
    out.push({
      user_id: id,
      name: `Guest ${id}`,
      is_guest: true,
      color: '#94A3B8',
      joined_at: 1_700_000_500_000 + i * 1000, // ascending → oldest first
    })
  }
  return out
}

/** Media-plane peers mirroring control peers (present in the SFU). */
export function buildMediaPeers(peers, { mutedEvery = 3, camOffEvery = 2, attentionEvery = 17 } = {}) {
  return peers.map((p, i) => ({
    identity: p.identity ?? `u:${p.user_id}`,
    userId: p.user_id,
    name: p.name,
    isGuest: p.is_guest,
    mic: mutedEvery && i % mutedEvery === 0 ? DEVICE.OFF : DEVICE.ON,
    camera: camOffEvery && i % camOffEvery === 0 ? DEVICE.OFF : DEVICE.ON,
    presenting: !!p.presenting,
    connection: attentionEvery && i % attentionEvery === 0 ? CONN.ATTENTION : CONN.GOOD,
    sessions: 1,
  }))
}

export function snapshotEvent(peers, waiting = [], { seq = 1, self = null, permissions = {} } = {}) {
  return { type: EVENT.SNAPSHOT, seq, self, peers, waiting, permissions }
}

export function mediaPresenceEvent(mediaPeers, { full = true } = {}) {
  return { type: EVENT.MEDIA_PRESENCE, peers: mediaPeers, full }
}

export function deltaEvent(seq, delta) {
  return { type: EVENT.DELTA, seq, delta }
}

export function joinDelta(seq, peer) {
  return deltaEvent(seq, { kind: DELTA.JOINED, peer })
}
export function leftDelta(seq, userId) {
  return deltaEvent(seq, { kind: DELTA.LEFT, user_id: userId })
}
export function roleDelta(seq, userId, role) {
  return deltaEvent(seq, { kind: DELTA.ROLE, user_id: userId, role })
}
export function handDelta(seq, userId, raised, at) {
  return deltaEvent(seq, { kind: DELTA.HAND, user_id: userId, raised, at })
}

/** The 200-participant integration fixture (spec). */
export function scene200() {
  const peers = buildPeers(196, { cohostEvery: 9 })
  const waiting = buildWaiting(4)
  return {
    snapshot: snapshotEvent(peers, waiting, { seq: 1, self: peers[0] }),
    media: mediaPresenceEvent(buildMediaPeers(peers)),
    peers,
    waiting,
  }
}

/** The 500-participant synthetic scale/perf fixture (spec). */
export function scene500() {
  const peers = buildPeers(490, { cohostEvery: 13 })
  const waiting = buildWaiting(10)
  return {
    snapshot: snapshotEvent(peers, waiting, { seq: 1, self: peers[0] }),
    media: mediaPresenceEvent(buildMediaPeers(peers)),
    peers,
    waiting,
  }
}
