import { describe, it, expect } from 'vitest'
import { initialPeopleState, reducePeople } from './peopleReducer.js'
import { EVENT, DELTA, ROLE, STATUS, DEVICE, CONN, PENDING_STATE, MAX_BUFFERED_DELTAS } from './constants.js'
import { selectPeople, selectWaiting } from './selectors.js'
import {
  buildWaiting, snapshotEvent, mediaPresenceEvent,
  deltaEvent, joinDelta, leftDelta, roleDelta, handDelta, scene200, scene500,
} from './fixtures.js'

const P = (id, over = {}) => ({ user_id: id, identity: `u:${id}`, name: `U${id}`, role: ROLE.PARTICIPANT, ...over })

describe('snapshot loading & reconciliation', () => {
  it('loads a snapshot, keys by user_id, marks ready', () => {
    const s = reducePeople(initialPeopleState(), snapshotEvent([P(1, { role: ROLE.HOST }), P(2)], [], { seq: 5 }))
    expect(s.ready).toBe(true)
    expect(s.seq).toBe(5)
    expect(Object.keys(s.byId).sort()).toEqual(['1', '2'])
    expect(s.byId['1'].role).toBe(ROLE.HOST)
  })

  it('dedups: a user in BOTH waiting and peers yields ONE active row', () => {
    const s = reducePeople(initialPeopleState(), snapshotEvent([P(1)], [{ user_id: 1, name: 'dup' }], { seq: 1 }))
    expect(selectPeople(s)).toHaveLength(1)
    expect(s.byId['1'].status).toBe(STATUS.ACTIVE)
  })

  it('a fresh snapshot after a gap clears the gap and resyncs (no rejoin)', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1)], [], { seq: 1 }))
    s = reducePeople(s, roleDelta(4, 1, ROLE.COHOST)) // gap (expected 2)
    expect(s.gap).not.toBeNull()
    s = reducePeople(s, snapshotEvent([P(1, { role: ROLE.COHOST })], [], { seq: 4 }))
    expect(s.gap).toBeNull()
    expect(s.seq).toBe(4)
    expect(s.byId['1'].role).toBe(ROLE.COHOST)
  })
})

describe('ordered deltas, dedup, gap detection, replay', () => {
  it('applies contiguous deltas in order', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1)], [], { seq: 1 }))
    s = reducePeople(s, joinDelta(2, P(2)))
    s = reducePeople(s, roleDelta(3, 2, ROLE.COHOST))
    expect(s.seq).toBe(3)
    expect(s.byId['2'].role).toBe(ROLE.COHOST)
  })

  it('drops duplicates and stragglers (seq <= applied) with a STABLE reference', () => {
    const base = reducePeople(initialPeopleState(), snapshotEvent([P(1)], [], { seq: 3 }))
    // Reference identity preserved → no re-render on a dropped event (spec).
    expect(reducePeople(base, roleDelta(3, 1, ROLE.HOST))).toBe(base) // dup seq
    expect(reducePeople(base, roleDelta(2, 1, ROLE.HOST))).toBe(base) // straggler
    expect(base.byId['1'].role).toBe(ROLE.PARTICIPANT)
  })

  it('detects a gap, buffers, and does NOT apply past the hole', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1), P(2)], [], { seq: 1 }))
    s = reducePeople(s, roleDelta(3, 2, ROLE.COHOST)) // expected 2, got 3 → gap
    expect(s.gap).toEqual({ expected: 2, got: 3 })
    expect(s.byId['2'].role).toBe(ROLE.PARTICIPANT) // NOT applied yet
    expect(Object.keys(s.buffer)).toEqual(['3'])
  })

  it('replays buffered out-of-order deltas on catch-up, clearing the gap', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1), P(2)], [], { seq: 1 }))
    s = reducePeople(s, roleDelta(3, 2, ROLE.COHOST)) // buffered (gap)
    s = reducePeople(s, handDelta(2, 1, true, 100)) // fills hole → drains 3
    expect(s.gap).toBeNull()
    expect(s.seq).toBe(3)
    expect(s.byId['1'].handRaised).toBe(true)
    expect(s.byId['2'].role).toBe(ROLE.COHOST)
  })

  it('buffer overflow forces a resync instead of unbounded growth', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1)], [], { seq: 1 }))
    for (let i = 0; i < MAX_BUFFERED_DELTAS + 5; i++) {
      s = reducePeople(s, handDelta(3 + i, 1, true)) // all ahead of expected 2
    }
    expect(s.needsResync).toBe(true)
  })

  it('interleaved out-of-order stream converges to the correct state', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1), P(2)], [], { seq: 1 }))
    // arrive: 3, 2, 5, 4  (4 fills, then 5 drains)
    s = reducePeople(s, roleDelta(3, 2, ROLE.COHOST))
    expect(s.byId['2'].role).toBe(ROLE.PARTICIPANT) // held behind the hole
    s = reducePeople(s, handDelta(2, 1, true, 10))
    s = reducePeople(s, handDelta(5, 2, true, 30))
    s = reducePeople(s, handDelta(4, 1, false, 20))
    expect(s.seq).toBe(5)
    expect(s.gap).toBeNull()
    expect(s.byId['1'].handRaised).toBe(false)
    expect(s.byId['2'].role).toBe(ROLE.COHOST)
    expect(s.byId['2'].handRaised).toBe(true)
  })
})

describe('two-plane authoritative merge (control seq vs media presence)', () => {
  it('media presence sets mic/camera without clobbering control role/hand', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1, { role: ROLE.HOST })], [], { seq: 1 }))
    s = reducePeople(s, handDelta(2, 1, true, 5))
    s = reducePeople(s, mediaPresenceEvent([{ identity: 'u:1', mic: DEVICE.OFF, camera: DEVICE.ON, connection: CONN.ATTENTION }]))
    expect(s.byId['1'].role).toBe(ROLE.HOST) // control-owned, preserved
    expect(s.byId['1'].handRaised).toBe(true) // control-owned, preserved
    expect(s.byId['1'].mic).toBe(DEVICE.OFF) // media-owned
    expect(s.byId['1'].connection).toBe(CONN.ATTENTION)
  })

  it('full media presence removes peers no longer present (self-heals on reconnect)', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1), P(2), P(3)], [], { seq: 1 }))
    s = reducePeople(s, mediaPresenceEvent([{ identity: 'u:1' }, { identity: 'u:3' }]))
    expect(Object.keys(s.byId).sort()).toEqual(['1', '3'])
  })

  it('media presence never removes a WAITING person', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1)], [{ user_id: 2, name: 'w' }], { seq: 1 }))
    s = reducePeople(s, mediaPresenceEvent([{ identity: 'u:1' }]))
    expect(s.byId['2'].status).toBe(STATUS.WAITING)
  })

  it('an EMPTY full media snapshot does not wipe a fresh seed (media-not-ready)', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1), P(2)], [], { seq: 1 }))
    s = reducePeople(s, mediaPresenceEvent([])) // media plane not ready yet
    expect(Object.keys(s.byId).sort()).toEqual(['1', '2']) // preserved
  })

  it('media-sourced people derive userId from identity (privileged actions need it)', () => {
    const s = reducePeople(initialPeopleState(), mediaPresenceEvent([{ identity: 'u:5', isGuest: true }]))
    expect(s.byId['5'].userId).toBe(5) // NOT null → promote can target it
  })

  it('a promote pending on a media-only guest clears on the authoritative role event', () => {
    // Repro of the stuck-spinner bug: a guest who joined via media presence
    // (no control seed) must still be promotable end-to-end.
    let s = reducePeople(initialPeopleState(), mediaPresenceEvent([{ identity: 'u:5', isGuest: true }]))
    s = reducePeople(s, { type: EVENT.PENDING, key: '5', action: 'promote' })
    expect(s.byId['5'].pending.state).toBe(PENDING_STATE.PENDING)
    // Server broadcasts an UNSEQUENCED role-changed (today's control WS).
    s = reducePeople(s, { type: EVENT.DELTA, delta: { kind: DELTA.ROLE, user_id: 5, role: ROLE.COHOST } })
    expect(s.byId['5'].role).toBe(ROLE.COHOST)
    expect(s.byId['5'].pending).toBeNull() // spinner clears
  })
})

describe('waiting queue & admission deltas', () => {
  it('waiting list orders oldest request first', () => {
    const s = reducePeople(initialPeopleState(), snapshotEvent([], buildWaiting(3), { seq: 1 }))
    const w = selectWaiting(s)
    expect(w.map((p) => p.requestedAt)).toEqual([...w.map((p) => p.requestedAt)].sort((a, b) => a - b))
  })

  it('WAITING_RESET replaces the whole queue idempotently', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([], buildWaiting(3), { seq: 1 }))
    s = reducePeople(s, deltaEvent(2, { kind: DELTA.WAITING_RESET, waiting: buildWaiting(1) }))
    expect(selectWaiting(s)).toHaveLength(1)
  })

  it('WAITING_REMOVE drops the queued row', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([], [{ user_id: 9001, name: 'g' }], { seq: 1 }))
    s = reducePeople(s, deltaEvent(2, { kind: DELTA.WAITING_REMOVE, user_id: 9001 }))
    expect(s.byId['9001']).toBeUndefined()
  })
})

describe('pending actions — no optimistic completion', () => {
  it('a pending promote does NOT change the role until an authoritative event', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(2)], [], { seq: 1 }))
    s = reducePeople(s, { type: EVENT.PENDING, key: '2', action: 'promote', idemKey: 'k1' })
    expect(s.byId['2'].role).toBe(ROLE.PARTICIPANT) // NOT optimistically co_host
    expect(s.byId['2'].pending.state).toBe(PENDING_STATE.PENDING)
    s = reducePeople(s, roleDelta(2, 2, ROLE.COHOST)) // authoritative
    expect(s.byId['2'].role).toBe(ROLE.COHOST)
    expect(s.byId['2'].pending).toBeNull() // auto-cleared on satisfaction
  })

  it('a pending admit clears when the person leaves the waiting set', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([], [{ user_id: 9001, name: 'g' }], { seq: 1 }))
    s = reducePeople(s, { type: EVENT.PENDING, key: '9001', action: 'admit' })
    expect(s.byId['9001'].pending.state).toBe(PENDING_STATE.PENDING)
    s = reducePeople(s, deltaEvent(2, { kind: DELTA.WAITING_REMOVE, user_id: 9001 }))
    expect(s.byId['9001']).toBeUndefined() // gone from queue → resolved
  })

  it('a failed action marks the pending FAILED (error indicator), role unchanged', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(2)], [], { seq: 1 }))
    s = reducePeople(s, { type: EVENT.PENDING, key: '2', action: 'promote' })
    s = reducePeople(s, { type: EVENT.PENDING_FAILED, key: '2', action: 'promote', reason: 'forbidden' })
    expect(s.byId['2'].pending.state).toBe(PENDING_STATE.FAILED)
    expect(s.byId['2'].pending.reason).toBe('forbidden')
    expect(s.byId['2'].role).toBe(ROLE.PARTICIPANT)
  })

  it('a LEFT delta keeps a row that still has a pending action in flight', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(2)], [], { seq: 1 }))
    s = reducePeople(s, { type: EVENT.PENDING, key: '2', action: 'promote' })
    s = reducePeople(s, leftDelta(2, 2))
    expect(s.byId['2']).toBeDefined()
    expect(s.byId['2'].status).toBe(STATUS.LEFT)
  })
})

describe('version tracking & reference identity', () => {
  it('global version bumps on change and no-ops return the same reference', () => {
    const s0 = reducePeople(initialPeopleState(), snapshotEvent([P(1)], [], { seq: 1 }))
    const s1 = reducePeople(s0, roleDelta(2, 1, ROLE.HOST))
    expect(s1.version).toBeGreaterThan(s0.version)
    const s2 = reducePeople(s1, roleDelta(3, 1, ROLE.HOST)) // same role → person no-op
    expect(s2.byId['1'].v).toBe(s1.byId['1'].v) // entity version unchanged
  })

  it('reset returns a fresh empty state', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1)], [], { seq: 1 }))
    s = reducePeople(s, { type: EVENT.RESET })
    expect(s.ready).toBe(false)
    expect(Object.keys(s.byId)).toHaveLength(0)
  })
})

describe('scale fixtures (200 & 500) + performance budget', () => {
  it('loads 200 participants with correct counts', () => {
    const { snapshot, media } = scene200()
    let s = reducePeople(initialPeopleState(), snapshot)
    s = reducePeople(s, media)
    // 196 active (media-present) + 4 waiting (untouched by media) = 200 total rows
    expect(selectPeople(s).length).toBe(200)
    expect(Object.keys(s.byId).length).toBe(200)
    expect(selectWaiting(s).length).toBe(4)
  })

  it('loads 500 participants within a generous reducer budget', () => {
    const { snapshot, media } = scene500()
    const t0 = performance.now()
    let s = reducePeople(initialPeopleState(), snapshot)
    s = reducePeople(s, media)
    const loadMs = performance.now() - t0
    expect(Object.keys(s.byId).length).toBe(500)
    expect(loadMs).toBeLessThan(150) // spec target is far tighter; generous for CI

    // 100 deltas/sec sustained: apply 200 contiguous deltas, measure.
    const t1 = performance.now()
    let seq = s.seq
    for (let i = 0; i < 200; i++) {
      seq++
      s = reducePeople(s, handDelta(seq, 1, i % 2 === 0, i))
    }
    const deltaMs = (performance.now() - t1) / 200
    expect(deltaMs).toBeLessThan(50) // per-delta budget (spec: <=50ms)
  })
})
