/**
 * Structured, development-only caption logging.
 *
 * Every stage of the pipeline emits a typed event through `clog(kind, data)`.
 * Gated on Vite's `import.meta.env.DEV` AND the config flag, so production
 * bundles tree-shake/no-op these calls — nothing is logged for real users.
 *
 * Event kinds (the taxonomy asked for in the spec):
 *   speaker-detected | speaker-changed | transcript-started |
 *   transcript-partial | transcript-final | caption-rendered |
 *   participant-mapped | caption-timeout | identity-mismatch |
 *   audio-track-mismatch | presence | source
 */
import { CAPTION_CONFIG } from './config'

const DEV =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.DEV === true

export function clog(kind, data) {
  if (!DEV && !CAPTION_CONFIG.debug) return
  // Single grouped line, cheap to scan and trivially greppable ("[cc]").
  console.debug(`[cc] ${kind}`, data ?? '')
}

export const captionDebugEnabled = DEV || CAPTION_CONFIG.debug

/* ──────────────────────────────────────────────────────────────────────────
 * TEMPORARY packet-level tracer (root-cause instrumentation).
 *
 * Unlike `clog`, this is RUNTIME-toggleable so it works on a PRODUCTION build
 * (the deployed meet.zoikosema.com), not only in `vite dev`. It traces the full
 * 10-stage caption lifecycle end-to-end so we can prove exactly where a caption
 * stops.
 *
 * Enable (either works, no rebuild needed):
 *   localStorage.setItem('zoiko.captions.debug', '1'); location.reload()
 *   — or, live in the console —  window.__zoikoCaptions.enable()
 *
 * Read the trace back:
 *   window.__zoikoCaptions.text()   // copy/paste-able text dump
 *   window.__zoikoCaptions.dump()   // structured array
 *   window.__zoikoCaptions.clear()  // reset the ring buffer
 *
 * Remove this whole block (and the ctrace() call sites) once the root cause is
 * fixed — it is diagnostic scaffolding, not a shipping feature.
 * ────────────────────────────────────────────────────────────────────────── */

const RING_MAX = 2000

function readInitialEnabled() {
  if (DEV || CAPTION_CONFIG.debug) return true
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('zoiko.captions.debug') === '1') return true
  } catch { /* storage blocked */ }
  try {
    if (typeof window !== 'undefined' && window.__zoikoCaptionDebug === true) return true
  } catch { /* no window */ }
  return false
}

let TRACE_ENABLED = readInitialEnabled()
const ring = []

export function traceEnabled() {
  return TRACE_ENABLED
}

// Short, readable time-of-day with millis (packet traces care about ms gaps).
function stamp() {
  const d = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/**
 * Emit one packet-trace line. `stage` is the numbered lifecycle stage
 * ("1-speech", "4-publishData-OK", "8-decrypt-FAIL", …). `fields` carries the
 * correlation keys asked for: seq, uid (utterance), from/to identity, topic,
 * bytes, final, plus any stage-specific extras.
 */
export function ctrace(stage, fields = {}) {
  if (!TRACE_ENABLED) return
  const rec = { t: stamp(), ms: Date.now(), stage, ...fields }
  ring.push(rec)
  if (ring.length > RING_MAX) ring.shift()

  // Build a compact, greppable one-liner. Order the common correlation keys
  // first so a scan reads left-to-right; dump the rest after.
  const known = ['seq', 'uid', 'final', 'from', 'to', 'self', 'topic', 'bytes', 'ok', 'reason', 'err']
  const parts = []
  for (const k of known) {
    if (fields[k] !== undefined && fields[k] !== null && fields[k] !== '') parts.push(`${k}=${fields[k]}`)
  }
  for (const k of Object.keys(fields)) {
    if (!known.includes(k) && fields[k] !== undefined) parts.push(`${k}=${fields[k]}`)
  }
  console.log(`%c[Caption] %c${stage}`, 'color:#10B981;font-weight:bold', 'color:#38BDF8', parts.join('  '))
}

// Expose the control + export handle on window so it's usable from any build.
if (typeof window !== 'undefined') {
  window.__zoikoCaptions = {
    enable() { TRACE_ENABLED = true; try { localStorage.setItem('zoiko.captions.debug', '1') } catch { /* ignore */ } return 'caption trace ON' },
    disable() { TRACE_ENABLED = false; try { localStorage.removeItem('zoiko.captions.debug') } catch { /* ignore */ } return 'caption trace OFF' },
    enabled: () => TRACE_ENABLED,
    dump: () => ring.slice(),
    clear: () => { ring.length = 0; return 'cleared' },
    text: () => ring.map((r) => {
      const { t, ms, stage, ...rest } = r
      const kv = Object.entries(rest).map(([k, v]) => `${k}=${v}`).join('  ')
      return `${t}  ${stage}  ${kv}`
    }).join('\n'),
    // Unified timeline (LiveKit + caption + speech), oldest→newest, with the
    // ms-delta from the previous event — matches the requested two-column shape.
    timeline: () => {
      let prev = null
      const out = ring.map((r) => {
        const { t, ms, stage, ...rest } = r
        const delta = prev == null ? 0 : ms - prev
        prev = ms
        const kv = Object.entries(rest).map(([k, v]) => `${k}=${v}`).join('  ')
        return `${t}  (+${delta}ms)\n    ${stage}${kv ? '   ' + kv : ''}`
      }).join('\n')
      console.log(out)
      return out
    },
    // Self-analyzing root-cause report: from THIS participant's ring buffer,
    // print the send-side (stages 1–4) and receive-side (stages 6–10) timelines
    // with inter-stage timestamp deltas, then answer the six root-cause
    // questions and name the first failing stage. Run on BOTH participants.
    report: () => {
      const lines = []
      const p = (s) => { lines.push(s) }
      const has = (prefix) => ring.some((r) => r.stage.startsWith(prefix))
      const all = (prefix) => ring.filter((r) => r.stage.startsWith(prefix))
      const last = (prefix) => { const a = all(prefix); return a[a.length - 1] }
      const fmtFields = (r) => {
        if (!r) return ''
        const { t, ms, stage, ...rest } = r
        return Object.entries(rest).map(([k, v]) => `${k}=${v}`).join('  ')
      }

      p('══════════ ZOIKO CAPTION PACKET REPORT ══════════')
      const info = last('info-connect') || last('info-')
      if (info) {
        p('CONNECTION / IDENTITY / GRANTS:')
        p('  ' + fmtFields(info))
      } else {
        p('CONNECTION: (no info-connect record — did you enable BEFORE joining?)')
      }

      // Group by role: this browser is both a sender (its own speech) and a
      // receiver (the peer's speech).
      const sendStages = ['1-speech', '2-provider', '3-publish-called', '4-publishData']
      const recvStages = ['6-remote-received', '7-', '8-', '9-', '10-overlay-render']

      p('')
      p('── SEND SIDE (this participant speaking) ──')
      for (const st of sendStages) {
        const a = all(st)
        p(`  ${st.padEnd(20)} × ${a.length}${a.length ? '   last: ' + fmtFields(a[a.length - 1]) : '   ⟵ NONE'}`)
      }
      p('')
      p('── RECEIVE SIDE (peer speaking, arriving here) ──')
      for (const st of recvStages) {
        const a = all(st)
        p(`  ${st.padEnd(20)} × ${a.length}${a.length ? '   last: ' + fmtFields(a[a.length - 1]) : '   ⟵ NONE'}`)
      }

      // Inter-stage deltas for the last received caption (stages 6→8→9→10).
      const dOf = (pre) => { const r = last(pre); return r ? r.ms : null }
      const t6 = dOf('6-remote-received'); const t8 = dOf('8-decrypt-OK'); const t9 = dOf('9-store-ACCEPTED'); const t10 = dOf('10-overlay-render')
      p('')
      p('── RECEIVE-PATH LATENCY (last caption, ms deltas) ──')
      p(`  6→8 decrypt: ${t6 != null && t8 != null ? (t8 - t6) + 'ms' : 'n/a'}   8→9 store: ${t8 != null && t9 != null ? (t9 - t8) + 'ms' : 'n/a'}   9→10 render: ${t9 != null && t10 != null ? (t10 - t9) + 'ms' : 'n/a'}`)

      p('')
      p('══════════ ROOT-CAUSE VERDICT ══════════')
      const publishOK = has('4-publishData-OK')
      const publishFAIL = has('4-publishData-FAIL')
      const received = has('6-remote-received') || all('7-raw-any-topic').some((r) => r.match === true || r.match === 'true')
      const decryptOK = has('8-decrypt-OK') || has('8-plaintext-legacy')
      const decryptFAIL = has('8-decrypt-FAIL') || has('8-decrypt-THROW')
      const storeOK = has('9-store-ACCEPTED')
      const storeDrop = has('9-store-DROPPED')
      const overlayOK = all('10-overlay-render').some((r) => r.willRender === true || r.willRender === 'true')

      p(`1. Does publishData() succeed? ......... ${publishOK ? 'YES' : publishFAIL ? 'NO — see 4-publishData-FAIL' : 'NO EVIDENCE (nothing published)'}`)
      p(`2. Does remote DataReceived fire? ...... ${received ? 'YES' : 'NO'}`)
      p(`3. Does the payload decrypt? ........... ${decryptOK ? 'YES' : decryptFAIL ? 'NO — decrypt failed' : 'NO EVIDENCE'}`)
      p(`4. Store accept or reject? ............. ${storeOK ? 'ACCEPT' : storeDrop ? 'REJECT (seq/dedup)' : 'NO EVIDENCE'}`)
      p(`5. Overlay receive valid state? ........ ${overlayOK ? 'YES' : 'NO (willRender never true)'}`)

      // First failing stage: walk the receive path in order; the earliest
      // expected-but-absent stage is where captions disappear. (Send-side is
      // evaluated separately because it lives on the OTHER participant's buffer.)
      let failing = 'none — receive path complete on this participant'
      if (!received) failing = 'Stage 6 (no packet arrives here at all)'
      else if (!decryptOK && !decryptFAIL) failing = 'Stage 8 (received but no decrypt attempt — no c/text field?)'
      else if (decryptFAIL && !decryptOK) failing = 'Stage 8 (decrypt fails — key mismatch)'
      else if (!storeOK && storeDrop) failing = 'Stage 9 (store rejects via seq/dedup guard)'
      else if (!storeOK) failing = 'Stage 9 (ingest never accepted)'
      else if (!overlayOK) failing = 'Stage 10 (accepted but overlay gate/visible blocks render)'
      p('')
      p(`6. FAILING STAGE (receive path): ${failing}`)
      if (!has('6-remote-received')) {
        p('   ↳ NOTE: also check the SENDER\'s report — if their "4-publishData-OK" fired')
        p('     but nothing arrived here, the packet is lost between SFU and this client.')
      }
      p('═══════════════════════════════════════')

      const out = lines.join('\n')
      console.log(out)
      return out
    },
  }
}
