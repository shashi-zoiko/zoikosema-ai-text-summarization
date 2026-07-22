import { describe, it, expect, vi } from 'vitest'
import { createPeopleStore } from './peopleStore.js'
import { createRealtimeEngine, translateMessage } from './realtimeEngine.js'
import { EVENT, DELTA, ROLE } from './constants.js'

function fakeTransport() {
  const handlers = new Set()
  return {
    sent: [],
    send(p) { this.sent.push(p) },
    subscribe(h) { handlers.add(h); return () => handlers.delete(h) },
    emit(msg) { for (const h of handlers) h(msg) },
  }
}

describe('translateMessage (pure)', () => {
  it('maps legacy control-WS messages to reducer events, threading seq when present', () => {
    expect(translateMessage({ type: 'peer-joined', seq: 5, peer: { user_id: 2 } }))
      .toMatchObject({ type: EVENT.DELTA, seq: 5, delta: { kind: DELTA.JOINED } })
    expect(translateMessage({ type: 'role-changed', user_id: 2, role: ROLE.COHOST }))
      .toMatchObject({ type: EVENT.DELTA, seq: undefined, delta: { kind: DELTA.ROLE, role: ROLE.COHOST } })
    expect(translateMessage({ type: 'waiting-room', waiting: [] }))
      .toMatchObject({ type: EVENT.DELTA, delta: { kind: DELTA.WAITING_RESET } })
    expect(translateMessage({ type: 'chat' })).toBeNull()
  })
})

describe('engine wiring', () => {
  it('applies translated messages to the store', () => {
    const store = createPeopleStore()
    const transport = fakeTransport()
    const engine = createRealtimeEngine({ store, transport })
    engine.start()
    transport.emit({ type: 'people-snapshot', seq: 1, self: null, peers: [{ user_id: 1, role: ROLE.HOST }], waiting: [] })
    expect(store.getSnapshot().byId['1'].role).toBe(ROLE.HOST)
  })

  it('legacy welcome carries the existing waiting queue forward (no wipe)', () => {
    const store = createPeopleStore()
    const transport = fakeTransport()
    const engine = createRealtimeEngine({ store, transport })
    engine.start()
    transport.emit({ type: 'people-snapshot', seq: 1, peers: [], waiting: [{ user_id: 9001, name: 'g', joined_at: 1 }] })
    transport.emit({ type: 'welcome', peers: [{ user_id: 1, role: ROLE.HOST }] }) // no waiting field
    expect(store.getSnapshot().byId['9001']).toBeDefined() // queue preserved
    expect(store.getSnapshot().byId['1']).toBeDefined()
  })

  it('requests a snapshot on a detected gap (recovery, no rejoin)', () => {
    const store = createPeopleStore()
    const transport = fakeTransport()
    const engine = createRealtimeEngine({ store, transport })
    engine.start()
    transport.emit({ type: 'people-snapshot', seq: 1, peers: [{ user_id: 1 }], waiting: [] })
    transport.emit({ type: 'role-changed', seq: 4, user_id: 1, role: ROLE.COHOST }) // gap (expected 2)
    const req = transport.sent.find((m) => m.type === 'people-snapshot-request')
    expect(req).toBeTruthy()
    expect(req.since).toBe(1)
  })

  it('emits reconnect-recovered telemetry when a requested snapshot lands', () => {
    const store = createPeopleStore()
    const transport = fakeTransport()
    const telemetry = vi.fn()
    const engine = createRealtimeEngine({ store, transport, telemetry })
    engine.start()
    engine.onConnected() // triggers a snapshot request
    transport.emit({ type: 'people-snapshot', seq: 1, peers: [{ user_id: 1 }], waiting: [] })
    expect(telemetry).toHaveBeenCalledWith('people_reconnect_recovered', expect.any(Object))
  })

  it('syncMedia feeds the LiveKit roster as authoritative media presence', () => {
    const store = createPeopleStore()
    const transport = fakeTransport()
    const engine = createRealtimeEngine({ store, transport })
    engine.start()
    transport.emit({ type: 'people-snapshot', seq: 1, peers: [{ user_id: 1 }], waiting: [] })
    engine.syncMedia([{ identity: 'u:1', mic: 'off' }])
    expect(store.getSnapshot().byId['1'].mic).toBe('off')
  })
})
