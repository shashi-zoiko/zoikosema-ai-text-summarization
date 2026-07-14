/**
 * Synthetic caption throughput bench for the buffer store — the layer that runs
 * on EVERY participant for EVERY inbound caption frame.
 * Run: `node src/features/meeting/captions/captionStore.bench.mjs`
 *
 * This measures the store hot path (ingest + snapshot rebuild + notify) under
 * meeting sizes of 10/25/50/100 concurrent speakers at a realistic interim rate.
 * It does NOT measure the SFU data-channel fan-out or React paint — those need a
 * real multi-client load harness; see the report for how they're reasoned about.
 * What it proves: the per-frame CPU cost is flat and tiny, so the pipeline is
 * bound by the network/paint layers we deliberately throttle, not by the store.
 */
import { createCaptionStore } from './captionStore.js'

const CONFIG = { lang: 'en-US', silenceTimeoutMs: 3000 }
const WORDS = 'the quick brown fox jumps over a lazy dog while everyone talks at once'.split(' ')

function run(nSpeakers, seconds = 5, interimsPerSec = 4) {
  // Subscriber that mimics React reading the snapshot each notify (the real cost
  // the overlay pays). We select+sort like the overlay does.
  const s = createCaptionStore({ config: CONFIG })
  let renders = 0
  s.subscribe(() => {
    const snap = s.getSnapshot()
    // same work the overlay's useMemo does
    Object.values(snap).sort((a, b) => a.ts - b.ts).slice(-3)
    renders++
  })

  const frames = nSpeakers * interimsPerSec * seconds
  const seqBySpeaker = new Array(nSpeakers).fill(0)
  const t0 = process.hrtime.bigint()
  for (let f = 0; f < frames; f++) {
    const spk = f % nSpeakers
    const seq = ++seqBySpeaker[spk]
    const isFinal = seq % 4 === 0
    const text = WORDS.slice(0, 3 + (seq % 8)).join(' ')
    s.ingest({
      speakerId: `u:${spk}`,
      seq,
      utteranceId: Math.floor(seq / 12) + 1,
      text,
      isFinal,
      identity: { name: `Speaker ${spk}`, color: '#10B981', initials: 'S' + spk },
    })
  }
  const t1 = process.hrtime.bigint()
  const ms = Number(t1 - t0) / 1e6
  return { nSpeakers, frames, renders, ms, perFrameUs: (ms * 1000) / frames }
}

// eslint-disable-next-line no-console
console.log('speakers | frames | store-renders |  total ms | per-frame µs')
for (const n of [10, 25, 50, 100]) {
  const r = run(n)
  // eslint-disable-next-line no-console
  console.log(
    `${String(r.nSpeakers).padStart(8)} | ${String(r.frames).padStart(6)} | ${String(r.renders).padStart(13)} | ${r.ms.toFixed(2).padStart(8)} | ${r.perFrameUs.toFixed(2).padStart(11)}`,
  )
}
