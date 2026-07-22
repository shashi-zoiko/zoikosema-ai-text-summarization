import { describe, it, expect, vi } from 'vitest'
import { createPeopleStore } from './peopleStore.js'
import { createPeopleActions } from './actions.js'
import { ROLE, PENDING_STATE, EVENT, DELTA } from './constants.js'
import { snapshotEvent, roleDelta } from './fixtures.js'

const P = (id, over = {}) => ({ user_id: id, identity: `u:${id}`, name: `U${id}`, role: ROLE.PARTICIPANT, ...over })

function setup(transport, { setTimeoutFn = () => {} } = {}) {
  const store = createPeopleStore()
  let n = 0
  // Default: a no-op timer so tests don't arm real 12s confirmation timeouts.
  const actions = createPeopleActions({ store, transport, idFactory: (a, id) => `${a}:${id}:${++n}`, setTimeoutFn })
  return { store, actions }
}

describe('promote — no optimistic completion', () => {
  it('marks pending, does NOT change role until the authoritative event', async () => {
    const transport = { promote: vi.fn().mockResolvedValue({}) }
    const { store, actions } = setup(transport)
    store.dispatch(snapshotEvent([P(2)], [], { seq: 1 }))

    await actions.promote('2', 2)
    expect(transport.promote).toHaveBeenCalledWith(2, { idemKey: 'promote:2:1' })
    expect(store.getSnapshot().byId['2'].pending.state).toBe(PENDING_STATE.PENDING)
    expect(store.getSnapshot().byId['2'].role).toBe(ROLE.PARTICIPANT) // NOT optimistic

    store.dispatch(roleDelta(2, 2, ROLE.COHOST)) // authoritative
    expect(store.getSnapshot().byId['2'].role).toBe(ROLE.COHOST)
    expect(store.getSnapshot().byId['2'].pending).toBeNull()
  })
})

describe('REST-confirmed actions (WS-independent completion)', () => {
  it('applies authoritative events returned by the transport, clearing the pending', async () => {
    const transport = {
      promote: vi.fn().mockResolvedValue({
        events: [{ type: EVENT.DELTA, delta: { kind: DELTA.ROLE, user_id: 2, role: ROLE.COHOST } }],
      }),
    }
    const { store, actions } = setup(transport)
    store.dispatch(snapshotEvent([P(2)], [], { seq: 1 }))
    await actions.promote('2', 2)
    // No separate WS role-changed needed — the REST response confirmed it.
    expect(store.getSnapshot().byId['2'].role).toBe(ROLE.COHOST)
    expect(store.getSnapshot().byId['2'].pending).toBeNull()
  })
})

describe('idempotency & dedup', () => {
  it('a double-click while pending does not send twice (reuses the key)', async () => {
    const transport = { promote: vi.fn().mockResolvedValue({}) }
    const { store, actions } = setup(transport)
    store.dispatch(snapshotEvent([P(2)], [], { seq: 1 }))
    const [k1, k2] = await Promise.all([actions.promote('2', 2), actions.promote('2', 2)])
    expect(transport.promote).toHaveBeenCalledTimes(1)
    expect(k1).toBe(k2)
  })
})

describe('confirmation timeout (bounded spinner → retry)', () => {
  it('marks a pending action FAILED if no authoritative confirmation arrives', async () => {
    let fire
    const transport = { promote: vi.fn().mockResolvedValue({}) }
    const { store, actions } = setup(transport, { setTimeoutFn: (fn) => { fire = fn } })
    store.dispatch(snapshotEvent([P(2)], [], { seq: 1 }))
    await actions.promote('2', 2)
    expect(store.getSnapshot().byId['2'].pending.state).toBe(PENDING_STATE.PENDING)
    fire() // timeout fires without any role-changed event
    expect(store.getSnapshot().byId['2'].pending.state).toBe(PENDING_STATE.FAILED)
    expect(store.getSnapshot().byId['2'].pending.reason).toBe('timeout')
  })

  it('does NOT fail if the authoritative event confirmed first (late timeout is a no-op)', async () => {
    let fire
    const transport = { promote: vi.fn().mockResolvedValue({}) }
    const { store, actions } = setup(transport, { setTimeoutFn: (fn) => { fire = fn } })
    store.dispatch(snapshotEvent([P(2)], [], { seq: 1 }))
    await actions.promote('2', 2)
    store.dispatch(roleDelta(2, 2, ROLE.COHOST)) // authoritative confirm clears pending
    expect(store.getSnapshot().byId['2'].pending).toBeNull()
    fire() // late timeout
    expect(store.getSnapshot().byId['2'].pending).toBeNull()
  })
})

describe('failure handling', () => {
  it('marks the pending FAILED with a reason and rethrows', async () => {
    const transport = { promote: vi.fn().mockRejectedValue({ status: 403 }) }
    const { store, actions } = setup(transport)
    store.dispatch(snapshotEvent([P(2)], [], { seq: 1 }))
    await expect(actions.promote('2', 2)).rejects.toBeDefined()
    expect(store.getSnapshot().byId['2'].pending.state).toBe(PENDING_STATE.FAILED)
    expect(store.getSnapshot().byId['2'].pending.reason).toBe('forbidden')
  })
})

describe('admit all — snapshot-based & bulk', () => {
  it('captures the queue, marks each pending, issues ONE bulk command with sinceSeq', async () => {
    const transport = { admitAll: vi.fn().mockResolvedValue({}) }
    const { store, actions } = setup(transport)
    store.dispatch(snapshotEvent([], [
      { user_id: 9001, name: 'a', joined_at: 1 },
      { user_id: 9002, name: 'b', joined_at: 2 },
    ], { seq: 7 }))

    await actions.admitAll()
    expect(transport.admitAll).toHaveBeenCalledTimes(1)
    const arg = transport.admitAll.mock.calls[0][0]
    expect(arg.userIds.sort()).toEqual([9001, 9002])
    expect(arg.sinceSeq).toBe(7)
    expect(store.getSnapshot().byId['9001'].pending.state).toBe(PENDING_STATE.PENDING)
    expect(store.getSnapshot().byId['9002'].pending.state).toBe(PENDING_STATE.PENDING)
  })

  it('is a no-op on an empty queue', async () => {
    const transport = { admitAll: vi.fn() }
    const { store, actions } = setup(transport)
    store.dispatch(snapshotEvent([P(1)], [], { seq: 1 }))
    const res = await actions.admitAll()
    expect(res).toBeNull()
    expect(transport.admitAll).not.toHaveBeenCalled()
  })
})
