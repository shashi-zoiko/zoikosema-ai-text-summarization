/**
 * Unit tests for the caption buffer state machine (pure, no React/LiveKit).
 * Run: `node src/features/meeting/captions/captionStore.test.mjs`
 *
 * Covers the ordering/segmentation/lifecycle guarantees the old replace-only
 * reducer lacked: out-of-order rejection, dedup, partial→final commit, no
 * cross-utterance merge, independent per-speaker streams, rename, timeout, purge.
 */
import assert from 'node:assert/strict'
import { createCaptionStore } from './captionStore.js'

const CONFIG = { lang: 'en-US', silenceTimeoutMs: 3000 }

// Controllable fake scheduler so timeouts are deterministic.
function makeScheduler() {
  let t = 0
  const timers = new Map()
  let id = 0
  return {
    scheduler: {
      now: () => t,
      setTimeout: (fn, ms) => { const h = ++id; timers.set(h, { fn, at: t + ms }); return h },
      clearTimeout: (h) => timers.delete(h),
    },
    advance: (ms) => {
      t += ms
      for (const [h, { fn, at }] of [...timers]) if (at <= t) { timers.delete(h); fn() }
    },
    setNow: (v) => { t = v },
  }
}

const id = { A: { name: 'Alice', color: '#10B981', initials: 'AL', isGuest: false } }

let passed = 0
function test(name, fn) {
  fn()
  passed++
  // eslint-disable-next-line no-console
  console.log(`  ok  ${name}`)
}

// 1. partial updates then final commits; display = finalText + partial.
test('partial then final commit', () => {
  const { scheduler } = makeScheduler()
  const s = createCaptionStore({ config: CONFIG, scheduler })
  s.ingest({ speakerId: 'A', seq: 1, utteranceId: 1, text: 'hello', isFinal: false, identity: id.A })
  assert.equal(s.getSnapshot().A.text, 'hello')
  assert.equal(s.getSnapshot().A.partial, 'hello')
  assert.equal(s.getSnapshot().A.finalText, '')
  s.ingest({ speakerId: 'A', seq: 2, utteranceId: 1, text: 'hello world', isFinal: true, identity: id.A })
  assert.equal(s.getSnapshot().A.finalText, 'hello world')
  assert.equal(s.getSnapshot().A.partial, '')
  assert.equal(s.getSnapshot().A.text, 'hello world')
})

// 2. out-of-order and duplicate frames are dropped by seq.
test('out-of-order and duplicate dropped', () => {
  const { scheduler } = makeScheduler()
  const s = createCaptionStore({ config: CONFIG, scheduler })
  s.ingest({ speakerId: 'A', seq: 5, utteranceId: 1, text: 'newer', isFinal: false, identity: id.A })
  const before = s.getSnapshot()
  // stale straggler (seq 3 < 5) — must not rewind
  assert.equal(s.ingest({ speakerId: 'A', seq: 3, utteranceId: 1, text: 'older', isFinal: false, identity: id.A }), false)
  // exact duplicate (seq 5) — dropped
  assert.equal(s.ingest({ speakerId: 'A', seq: 5, utteranceId: 1, text: 'dup', isFinal: false, identity: id.A }), false)
  assert.equal(s.getSnapshot(), before) // reference unchanged → no re-render
  assert.equal(s.getSnapshot().A.text, 'newer')
})

// 3. a new utteranceId rolls to a fresh line (does not merge/append).
test('new utterance does not merge', () => {
  const { scheduler } = makeScheduler()
  const s = createCaptionStore({ config: CONFIG, scheduler })
  s.ingest({ speakerId: 'A', seq: 1, utteranceId: 1, text: 'first sentence', isFinal: true, identity: id.A })
  s.ingest({ speakerId: 'A', seq: 2, utteranceId: 2, text: 'second', isFinal: false, identity: id.A })
  assert.equal(s.getSnapshot().A.finalText, '') // reset for new utterance
  assert.equal(s.getSnapshot().A.text, 'second')
})

// 3b. multiple finals WITHIN one utterance append (long turn).
test('multiple finals in one utterance append', () => {
  const { scheduler } = makeScheduler()
  const s = createCaptionStore({ config: CONFIG, scheduler })
  s.ingest({ speakerId: 'A', seq: 1, utteranceId: 1, text: 'one', isFinal: true, identity: id.A })
  s.ingest({ speakerId: 'A', seq: 2, utteranceId: 1, text: 'two', isFinal: true, identity: id.A })
  assert.equal(s.getSnapshot().A.finalText, 'one two')
})

// 4. two speakers keep independent streams (overlap, no merge).
test('independent per-speaker streams', () => {
  const { scheduler } = makeScheduler()
  const s = createCaptionStore({ config: CONFIG, scheduler })
  s.ingest({ speakerId: 'A', seq: 1, utteranceId: 1, text: 'alice talks', isFinal: false, identity: id.A })
  s.ingest({ speakerId: 'B', seq: 1, utteranceId: 1, text: 'bob talks', isFinal: false, identity: { name: 'Bob' } })
  assert.equal(s.getSnapshot().A.text, 'alice talks')
  assert.equal(s.getSnapshot().B.text, 'bob talks')
  assert.equal(Object.keys(s.getSnapshot()).length, 2)
})

// 5. disconnect removes immediately.
test('remove on disconnect', () => {
  const { scheduler } = makeScheduler()
  const s = createCaptionStore({ config: CONFIG, scheduler })
  s.ingest({ speakerId: 'A', seq: 1, utteranceId: 1, text: 'bye', isFinal: false, identity: id.A })
  s.remove('A', 'disconnect')
  assert.equal(s.getSnapshot().A, undefined)
})

// 6. silence timeout fades the caption after silenceTimeoutMs.
test('silence timeout expiry', () => {
  const h = makeScheduler()
  const s = createCaptionStore({ config: CONFIG, scheduler: h.scheduler })
  s.ingest({ speakerId: 'A', seq: 1, utteranceId: 1, text: 'lingering', isFinal: true, identity: id.A })
  h.advance(2999)
  assert.ok(s.getSnapshot().A) // still visible just before timeout
  h.advance(2)
  assert.equal(s.getSnapshot().A, undefined) // gone after timeout
})

// 7. rename updates identity in place without dropping the caption.
test('refreshIdentity rename', () => {
  const { scheduler } = makeScheduler()
  const s = createCaptionStore({ config: CONFIG, scheduler })
  s.ingest({ speakerId: 'A', seq: 1, utteranceId: 1, text: 'hi', isFinal: false, identity: id.A })
  s.refreshIdentity('A', { name: 'Alice Cooper' })
  assert.equal(s.getSnapshot().A.name, 'Alice Cooper')
  assert.equal(s.getSnapshot().A.text, 'hi') // transcript untouched
})

// 8. subscribers are notified on change, and only on change.
test('subscribe notifications', () => {
  const { scheduler } = makeScheduler()
  const s = createCaptionStore({ config: CONFIG, scheduler })
  let n = 0
  const unsub = s.subscribe(() => { n++ })
  s.ingest({ speakerId: 'A', seq: 1, utteranceId: 1, text: 'x', isFinal: false, identity: id.A })
  assert.equal(n, 1)
  s.ingest({ speakerId: 'A', seq: 1, utteranceId: 1, text: 'x', isFinal: false, identity: id.A }) // dup → no notify
  assert.equal(n, 1)
  unsub()
  s.ingest({ speakerId: 'A', seq: 2, utteranceId: 1, text: 'y', isFinal: false, identity: id.A })
  assert.equal(n, 1) // unsubscribed
})

// eslint-disable-next-line no-console
console.log(`\ncaptionStore: ${passed} tests passed`)
