import { describe, it, expect, vi } from 'vitest'
import { createPeopleStore } from './peopleStore.js'
import { ROLE } from './constants.js'
import { snapshotEvent, roleDelta, handDelta } from './fixtures.js'

const P = (id, over = {}) => ({ user_id: id, identity: `u:${id}`, name: `U${id}`, role: ROLE.PARTICIPANT, ...over })

describe('PeopleStore', () => {
  it('notifies subscribers only when state actually changes', () => {
    const store = createPeopleStore()
    let n = 0
    const unsub = store.subscribe(() => { n++ })
    store.dispatch(snapshotEvent([P(1)], [], { seq: 1 }))
    expect(n).toBe(1)
    store.dispatch(roleDelta(1, 1, ROLE.HOST)) // seq 1 <= applied 1 → dropped, no notify
    expect(n).toBe(1)
    store.dispatch(roleDelta(2, 1, ROLE.HOST)) // applies
    expect(n).toBe(2)
    unsub()
    store.dispatch(roleDelta(3, 1, ROLE.PARTICIPANT))
    expect(n).toBe(2) // unsubscribed
  })

  it('counts dropped duplicates for telemetry without re-rendering', () => {
    const store = createPeopleStore()
    store.dispatch(snapshotEvent([P(1)], [], { seq: 5 }))
    store.dispatch(roleDelta(5, 1, ROLE.HOST)) // dup
    store.dispatch(roleDelta(3, 1, ROLE.HOST)) // straggler
    expect(store.stats().dropped).toBe(2)
  })

  it('emits privacy-safe telemetry (counts/seq/durations only)', () => {
    const onTelemetry = vi.fn()
    const store = createPeopleStore({ onTelemetry })
    store.dispatch(snapshotEvent([P(1), P(2)], [], { seq: 1 }))
    const snap = onTelemetry.mock.calls.find((c) => c[0] === 'people_snapshot_loaded')
    expect(snap).toBeTruthy()
    expect(snap[1]).toEqual({ count: 2, seq: 1 })
    // No PII keys ever appear in payloads.
    for (const [, props] of onTelemetry.mock.calls) {
      const keys = Object.keys(props || {})
      expect(keys).not.toContain('name')
      expect(keys).not.toContain('email')
    }
  })

  it('signals needsResync after a gap so the engine can request a snapshot', () => {
    const store = createPeopleStore()
    store.dispatch(snapshotEvent([P(1)], [], { seq: 1 }))
    store.dispatch(roleDelta(4, 1, ROLE.HOST)) // gap (expected 2)
    expect(store.needsResync()).toBe(true)
    store.dispatch(handDelta(2, 1, true)) // fills hole
    store.dispatch(handDelta(3, 1, false))
    expect(store.needsResync()).toBe(false)
  })
})
