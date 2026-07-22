/**
 * People action dispatcher — idempotent, pending-tracked, no optimistic completion.
 *
 * Wraps a transport adapter (REST/WS calls to the existing admit/deny/admit-all/
 * promote endpoints) with the module's action discipline:
 *   • Every privileged action carries an idempotency key (safe retries / double
 *     click dedup). A same-action pending already in flight is a no-op that
 *     returns the existing key.
 *   • The action marks the target PENDING (a visible indicator) but NEVER mutates
 *     the authoritative role/status — that only changes when the server's
 *     authoritative event arrives and the reducer clears the pending.
 *   • Admit All is snapshot-based: it captures the current waiting keys and the
 *     current seq for server-side conflict resolution, then marks each pending.
 *   • Failures mark the pending FAILED (error indicator) and surface a reason.
 *
 * Pure orchestration — inject a fake transport to unit-test without a network.
 */
import { EVENT, ACTION, PENDING_STATE, STATUS } from './constants.js'
import { selectWaiting } from './selectors.js'

const defaultNow = () =>
  (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

export function createPeopleActions({
  store, transport, telemetry, now = defaultNow, idFactory,
  timeoutMs = 12000, setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  let counter = 0
  const makeIdemKey = idFactory || ((action, id) => `${action}:${id}:${++counter}`)
  const telem = (name, props) => { try { telemetry?.(name, props) } catch { /* never break an action */ } }

  // Bound a pending action: if no AUTHORITATIVE server event clears it within
  // `timeoutMs`, mark it FAILED (→ Retry) rather than spinning forever. This is
  // still "no optimistic completion" — we never fake success; we just stop
  // waiting on a confirmation that a dropped WS reconnect may have lost. If the
  // event already cleared/changed the pending, this is a no-op.
  function armTimeout(key, action, idemKey) {
    setTimeoutFn(() => {
      const p = store.getSnapshot().byId[key]?.pending
      if (p && p.state === PENDING_STATE.PENDING && p.action === action && p.idemKey === idemKey) {
        store.dispatch({ type: EVENT.PENDING_FAILED, key, action, reason: 'timeout' })
        telem('people_action_failed', { action, reason: 'timeout' })
      }
    }, timeoutMs)
  }

  function reasonOf(err) {
    if (!err) return 'failed'
    if (err.status === 403 || err.code === 4403) return 'forbidden'
    if (err.status === 409) return 'conflict'
    if (err.name === 'AbortError' || err.code === 'timeout') return 'timeout'
    return err.reason || err.message || 'failed'
  }

  async function run(action, key, userId, fn) {
    const person = store.getSnapshot().byId[key]
    // Idempotency / double-click dedup: reuse an in-flight same-action pending.
    if (person?.pending?.state === PENDING_STATE.PENDING && person.pending.action === action) {
      return person.pending.idemKey
    }
    const idemKey = makeIdemKey(action, userId)
    store.dispatch({ type: EVENT.PENDING, key, action, idemKey })
    armTimeout(key, action, idemKey)
    telem('people_action_requested', { action })
    const t0 = now()
    try {
      const result = await fn(idemKey)
      // A transport MAY return authoritative reducer events — e.g. a REST
      // response that already CONFIRMED the change server-side. Applying them is
      // NOT optimistic completion: the server committed and reported the result,
      // so the acting client can confirm without waiting on a separate (possibly
      // dropped) WS broadcast. WS-only transports return nothing and rely on the
      // broadcast, exactly as before.
      if (result && Array.isArray(result.events)) {
        for (const ev of result.events) store.dispatch(ev)
      }
      telem('people_action_confirmed', { action, action_ms: Math.round(now() - t0) })
      return idemKey
    } catch (err) {
      const reason = reasonOf(err)
      store.dispatch({ type: EVENT.PENDING_FAILED, key, action, reason })
      telem('people_action_failed', { action, reason })
      throw err
    }
  }

  return {
    admit(key, userId) {
      return run(ACTION.ADMIT, key, userId, (idemKey) => transport.admit(userId, { idemKey }))
    },
    deny(key, userId) {
      return run(ACTION.DENY, key, userId, (idemKey) => transport.deny(userId, { idemKey }))
    },
    promote(key, userId) {
      return run(ACTION.PROMOTE, key, userId, (idemKey) => transport.promote(userId, { idemKey }))
    },
    demote(key, userId) {
      return run(ACTION.DEMOTE, key, userId, (idemKey) => transport.demote(userId, { idemKey }))
    },
    /**
     * Snapshot-based Admit All. Captures the queue + seq at call time, marks each
     * waiting person pending, and issues ONE bulk command. Idempotent via idemKey;
     * the server resolves conflicts against `sinceSeq`.
     */
    async admitAll() {
      const state = store.getSnapshot()
      const waiting = selectWaiting(state).filter((p) => p.status === STATUS.WAITING)
      if (waiting.length === 0) return null
      const idemKey = makeIdemKey(ACTION.ADMIT_ALL, 'all')
      const keys = waiting.map((p) => p.key)
      const userIds = waiting.map((p) => p.userId).filter((v) => v != null)
      for (const p of waiting) {
        store.dispatch({ type: EVENT.PENDING, key: p.key, action: ACTION.ADMIT, idemKey })
      }
      telem('people_action_requested', { action: ACTION.ADMIT_ALL, count: keys.length })
      const t0 = now()
      try {
        await transport.admitAll({ idemKey, userIds, sinceSeq: state.seq })
        telem('people_action_confirmed', { action: ACTION.ADMIT_ALL, action_ms: Math.round(now() - t0), count: keys.length })
        return idemKey
      } catch (err) {
        const reason = reasonOf(err)
        for (const p of waiting) {
          store.dispatch({ type: EVENT.PENDING_FAILED, key: p.key, action: ACTION.ADMIT, reason })
        }
        telem('people_action_failed', { action: ACTION.ADMIT_ALL, reason })
        throw err
      }
    },
  }
}
