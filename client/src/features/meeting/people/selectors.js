/**
 * Pure selectors over PeopleReducer state: grouping, ordering, search, filters.
 *
 * All pure and framework-free (unit-tested in Node). The UI memoizes these
 * against `state.version` so recompute happens only on real change.
 *
 * Ordering contract (spec):
 *   • Stable ordering — NEVER reordered by active speaker. Non-waiting groups
 *     render in join order (`state.order` index).
 *   • Waiting queue — oldest request first (requestedAt ascending).
 *   • Raised hands — only reordered (by raise time) INSIDE the Raised Hands
 *     filter; everywhere else a raised hand is just an indicator.
 *
 * Grouping contract: one participant → exactly ONE canonical group. External is
 * a BADGE on the row (person.isGuest), and additionally the group for guests who
 * aren't otherwise host/co-host/presenter.
 */
import { GROUP, GROUP_ORDER, ROLE, STATUS, DEVICE, CONN, FILTER } from './constants.js'

/** Canonical group for a person — priority ordered, mutually exclusive. */
export function assignGroup(p) {
  if (p.status === STATUS.WAITING) return GROUP.WAITING
  if (p.isService) return GROUP.MEETING_SERVICES
  if (p.role === ROLE.HOST) return GROUP.HOSTS
  if (p.role === ROLE.COHOST) return GROUP.COHOSTS
  if (p.presenting) return GROUP.PRESENTERS
  if (p.isGuest) return GROUP.EXTERNAL_GUESTS
  if (p.viewOnly) return GROUP.VIEW_ONLY
  return GROUP.PARTICIPANTS
}

/** All people as an array in stable join order. */
export function selectPeople(state) {
  const out = []
  for (const key of state.order) {
    const p = state.byId[key]
    if (p) out.push(p)
  }
  // Include any entities somehow not in `order` (defensive; keeps them visible).
  if (out.length !== Object.keys(state.byId).length) {
    for (const key of Object.keys(state.byId)) {
      if (!state.order.includes(key)) out.push(state.byId[key])
    }
  }
  return out
}

/** Waiting people, oldest request first (deterministic, tie-broken by key). */
export function selectWaiting(state) {
  const waiting = selectPeople(state).filter((p) => p.status === STATUS.WAITING)
  return waiting.sort((a, b) => {
    const ta = a.requestedAt ?? 0
    const tb = b.requestedAt ?? 0
    if (ta !== tb) return ta - tb
    return String(a.key).localeCompare(String(b.key))
  })
}

/** Case-insensitive substring match on display name (indexed by the caller). */
export function matchesSearch(p, q) {
  if (!q) return true
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (p.name || '').toLowerCase().includes(needle)
}

function filterPredicate(filter) {
  switch (filter) {
    case FILTER.WAITING: return (p) => p.status === STATUS.WAITING
    case FILTER.HOSTS: return (p) => p.role === ROLE.HOST || p.role === ROLE.COHOST
    case FILTER.PRESENTERS: return (p) => !!p.presenting
    case FILTER.EXTERNAL: return (p) => !!p.isGuest
    case FILTER.RAISED_HANDS: return (p) => !!p.handRaised
    case FILTER.MUTED: return (p) => p.mic === DEVICE.OFF
    case FILTER.CAMERA_OFF: return (p) => p.camera === DEVICE.OFF
    case FILTER.SHARING: return (p) => !!p.presenting
    case FILTER.CONNECTION_ATTENTION: return (p) => p.connection === CONN.ATTENTION
    default: return () => true
  }
}

/** Does a person pass ALL active filters (AND-narrowing) + the search query? */
export function passes(p, { query = '', filters = [] } = {}) {
  if (!matchesSearch(p, query)) return false
  for (const f of filters) {
    if (!filterPredicate(f)(p)) return false
  }
  return true
}

/**
 * Grouped, ordered, filtered view for rendering.
 * @returns {{ groups: Array<{id, order:number, people}>, total, matched, waitingCount, raisedCount }}
 */
export function selectGroups(state, opts = {}) {
  const { query = '', filters = [] } = opts
  const raisedHandsOnly = filters.includes(FILTER.RAISED_HANDS)
  const people = selectPeople(state)

  const buckets = new Map()
  for (const g of GROUP_ORDER) buckets.set(g, [])

  let matched = 0
  for (const p of people) {
    if (!passes(p, { query, filters })) continue
    matched++
    const g = assignGroup(p)
    if (!buckets.has(g)) buckets.set(g, [])
    buckets.get(g).push(p)
  }

  // Order within each group.
  const orderIndex = new Map(state.order.map((k, i) => [k, i]))
  for (const [g, arr] of buckets) {
    if (g === GROUP.WAITING) {
      arr.sort((a, b) => (a.requestedAt ?? 0) - (b.requestedAt ?? 0) || String(a.key).localeCompare(String(b.key)))
    } else if (raisedHandsOnly) {
      // Only inside the Raised Hands filter do we reorder by raise time.
      arr.sort((a, b) => (a.handRaisedAt ?? Infinity) - (b.handRaisedAt ?? Infinity) ||
        (orderIndex.get(a.key) ?? 0) - (orderIndex.get(b.key) ?? 0))
    } else {
      arr.sort((a, b) => (orderIndex.get(a.key) ?? 0) - (orderIndex.get(b.key) ?? 0))
    }
  }

  const groups = GROUP_ORDER
    .map((id, i) => ({ id, order: i, people: buckets.get(id) || [] }))
    .filter((grp) => grp.people.length > 0)

  return {
    groups,
    total: people.length,
    matched,
    waitingCount: (buckets.get(GROUP.WAITING) || []).length,
    raisedCount: people.filter((p) => p.handRaised).length,
  }
}

/** Total rows that would render for a given view — drives the virtualization decision. */
export function selectRowCount(state, opts = {}) {
  const { groups } = selectGroups(state, opts)
  // rows = group headers + members
  return groups.reduce((n, g) => n + 1 + g.people.length, 0)
}

/** Lightweight stats for telemetry (no PII). */
export function selectStats(state) {
  return {
    total: Object.keys(state.byId).length,
    waiting: selectPeople(state).filter((p) => p.status === STATUS.WAITING).length,
    seq: state.seq,
    version: state.version,
    ...state.stats,
  }
}
