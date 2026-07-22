/**
 * PeopleStore — thin, framework-free wrapper around PeopleReducer.
 *
 * Same shape as captions/captionStore.js (the house pattern for ordered
 * streaming state): immutable snapshots + {subscribe,getSnapshot} for React's
 * useSyncExternalStore, an injected scheduler for deterministic tests, and an
 * onTelemetry seam. It holds no React and no network — the realtime engine feeds
 * it events; the UI reads snapshots through a hook.
 *
 * Every dispatch measures reducer latency and emits gap-detected / gap-recovered
 * / resync-needed / snapshot-loaded telemetry so the engine and UI don't each
 * re-derive them.
 */
import { initialPeopleState, reducePeople } from './peopleReducer.js'
import { EVENT } from './constants.js'

const defaultScheduler = {
  now: () =>
    (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
}

export function createPeopleStore({ scheduler = defaultScheduler, onTelemetry } = {}) {
  let state = initialPeopleState()
  const listeners = new Set()
  let dropped = 0 // duplicate/straggler deltas rejected (no state change)

  const telem = (name, props) => {
    try { onTelemetry?.(name, props) } catch { /* telemetry never breaks the pipeline */ }
  }

  const publish = () => {
    for (const l of listeners) l()
  }

  /** Apply one reducer event. Returns true if state changed. */
  function dispatch(ev) {
    const prev = state
    const t0 = scheduler.now()
    const next = reducePeople(prev, ev)
    const ms = scheduler.now() - t0

    if (next === prev) {
      // No state change. A seq'd delta at/behind the applied cursor is a dropped
      // duplicate/straggler — count it for realtime-health telemetry without a
      // re-render (reducer intentionally kept the same reference).
      if (ev.type === EVENT.DELTA && typeof ev.seq === 'number' && ev.seq <= prev.seq) {
        dropped++
        telem('people_delta_dropped', { seq: ev.seq, applied: prev.seq })
      }
      return false
    }
    state = next

    // Derived telemetry (privacy-safe: counts/seq/durations only).
    if (ev.type === EVENT.SNAPSHOT) {
      telem('people_snapshot_loaded', { count: Object.keys(next.byId).length, seq: next.seq })
    } else if (ev.type === EVENT.DELTA) {
      telem('people_delta_applied', { type: ev.delta?.kind ?? 'delta', reducer_ms: ms })
    }
    if (!prev.gap && next.gap) telem('people_gap_detected', { expected: next.gap.expected, got: next.gap.got })
    if (prev.gap && !next.gap) telem('people_gap_recovered', { via: 'buffer' })
    if (!prev.needsResync && next.needsResync) telem('people_gap_detected', { resync: true })

    publish()
    return true
  }

  return {
    dispatch,
    getSnapshot: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    reset: () => dispatch({ type: EVENT.RESET }),
    // needsResync is read by the engine to decide whether to request a snapshot.
    needsResync: () => state.needsResync || !!state.gap,
    seq: () => state.seq,
    // Store-owned counters (merged with reducer stats) for telemetry.
    stats: () => ({ ...state.stats, dropped }),
  }
}
