import { describe, it, expect } from 'vitest'
import { initialPeopleState, reducePeople } from './peopleReducer.js'
import { assignGroup, selectGroups, selectRowCount, passes } from './selectors.js'
import { GROUP, ROLE, STATUS, DEVICE, CONN, FILTER } from './constants.js'
import { snapshotEvent, mediaPresenceEvent, handDelta } from './fixtures.js'

const P = (id, over = {}) => ({ user_id: id, identity: `u:${id}`, name: `U${id}`, role: ROLE.PARTICIPANT, ...over })

describe('canonical grouping — one participant, one group', () => {
  it('assigns each person to exactly one group by priority', () => {
    expect(assignGroup({ status: STATUS.WAITING })).toBe(GROUP.WAITING)
    expect(assignGroup({ role: ROLE.HOST })).toBe(GROUP.HOSTS)
    expect(assignGroup({ role: ROLE.COHOST })).toBe(GROUP.COHOSTS)
    expect(assignGroup({ role: ROLE.PARTICIPANT, presenting: true })).toBe(GROUP.PRESENTERS)
    expect(assignGroup({ role: ROLE.PARTICIPANT, isGuest: true })).toBe(GROUP.EXTERNAL_GUESTS)
    expect(assignGroup({ role: ROLE.PARTICIPANT })).toBe(GROUP.PARTICIPANTS)
    expect(assignGroup({ isService: true })).toBe(GROUP.MEETING_SERVICES)
  })

  it('a host who is presenting stays a HOST (presenting is an indicator, not a group jump)', () => {
    expect(assignGroup({ role: ROLE.HOST, presenting: true })).toBe(GROUP.HOSTS)
  })

  it('a guest promoted to co-host lives in COHOSTS but keeps the external badge (isGuest)', () => {
    const p = { role: ROLE.COHOST, isGuest: true }
    expect(assignGroup(p)).toBe(GROUP.COHOSTS)
    expect(p.isGuest).toBe(true) // badge still present on the row
  })

  it('never produces duplicate rows across groups', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent(
      [P(1, { role: ROLE.HOST }), P(2, { role: ROLE.COHOST }), P(3, { isGuest: true }), P(4, { presenting: true })],
      [{ user_id: 5, name: 'w' }], { seq: 1 }))
    const { groups } = selectGroups(s)
    const allKeys = groups.flatMap((g) => g.people.map((p) => p.key))
    expect(new Set(allKeys).size).toBe(allKeys.length) // no dupes
    expect(allKeys.sort()).toEqual(['1', '2', '3', '4', '5'])
  })
})

describe('ordering', () => {
  it('non-waiting groups keep stable join order — never reordered by hand raise', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(10), P(11), P(12)], [], { seq: 1 }))
    s = reducePeople(s, handDelta(2, 12, true, 100)) // last person raises hand
    const { groups } = selectGroups(s) // no raised-hands filter
    const participants = groups.find((g) => g.id === GROUP.PARTICIPANTS)
    expect(participants.people.map((p) => p.key)).toEqual(['10', '11', '12']) // stable, not reordered
  })

  it('raised hands reorder ONLY inside the Raised Hands filter (by raise time)', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(10), P(11), P(12)], [], { seq: 1 }))
    s = reducePeople(s, handDelta(2, 12, true, 100))
    s = reducePeople(s, handDelta(3, 10, true, 50)) // earlier raise
    const { groups } = selectGroups(s, { filters: [FILTER.RAISED_HANDS] })
    const arr = groups.flatMap((g) => g.people.map((p) => p.key))
    expect(arr).toEqual(['10', '12']) // 10 raised earlier (t=50) → first; 11 excluded
  })

  it('waiting queue is oldest-first', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([], [
      { user_id: 1, name: 'a', joined_at: 300 },
      { user_id: 2, name: 'b', joined_at: 100 },
      { user_id: 3, name: 'c', joined_at: 200 },
    ], { seq: 1 }))
    const { groups } = selectGroups(s)
    const waiting = groups.find((g) => g.id === GROUP.WAITING)
    expect(waiting.people.map((p) => p.key)).toEqual(['2', '3', '1'])
  })
})

describe('search & filters', () => {
  it('search matches on name, case-insensitively', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([
      { user_id: 1, name: 'Alice' }, { user_id: 2, name: 'Bob' },
    ], [], { seq: 1 }))
    const { matched } = selectGroups(s, { query: 'ali' })
    expect(matched).toBe(1)
  })

  it('filters narrow with AND semantics', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([
      P(1, { role: ROLE.HOST }), P(2, { role: ROLE.COHOST }), P(3),
    ], [], { seq: 1 }))
    s = reducePeople(s, mediaPresenceEvent([
      { identity: 'u:1', mic: DEVICE.OFF }, { identity: 'u:2', mic: DEVICE.ON }, { identity: 'u:3', mic: DEVICE.OFF },
    ]))
    // Hosts filter → {1,2}; Muted filter → {1,3}; AND → {1}
    const { matched, groups } = selectGroups(s, { filters: [FILTER.HOSTS, FILTER.MUTED] })
    expect(matched).toBe(1)
    expect(groups.flatMap((g) => g.people.map((p) => p.key))).toEqual(['1'])
  })

  it('connection-attention filter surfaces only degraded peers', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent([P(1), P(2)], [], { seq: 1 }))
    s = reducePeople(s, mediaPresenceEvent([
      { identity: 'u:1', connection: CONN.ATTENTION }, { identity: 'u:2', connection: CONN.GOOD },
    ]))
    const { groups } = selectGroups(s, { filters: [FILTER.CONNECTION_ATTENTION] })
    expect(groups.flatMap((g) => g.people.map((p) => p.key))).toEqual(['1'])
  })

  it('passes() composes search + filters', () => {
    const p = { name: 'Zoe', role: ROLE.HOST, mic: DEVICE.OFF, status: STATUS.ACTIVE }
    expect(passes(p, { query: 'zo', filters: [FILTER.HOSTS, FILTER.MUTED] })).toBe(true)
    expect(passes(p, { query: 'xx', filters: [] })).toBe(false)
  })
})

describe('row count (virtualization trigger)', () => {
  it('counts group headers + members', () => {
    let s = reducePeople(initialPeopleState(), snapshotEvent(
      [P(1, { role: ROLE.HOST }), P(2), P(3)], [], { seq: 1 }))
    // Hosts group (1 header + 1) + Participants group (1 header + 2) = 5 rows
    expect(selectRowCount(s)).toBe(5)
  })
})
