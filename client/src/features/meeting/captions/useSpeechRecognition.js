import { useEffect, useRef } from 'react'

// Feature-detect the Web Speech API once. Chrome/Edge expose
// webkitSpeechRecognition; Safari has it prefixed too; Firefox has neither →
// captions degrade gracefully (the CC button is disabled with a tooltip).
const SpeechRecognitionImpl =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null

export const speechRecognitionSupported = !!SpeechRecognitionImpl

/**
 * Drives on-device speech recognition for the LOCAL participant's microphone.
 *
 * The engine taps the system mic itself — we never read or stream the raw audio
 * track, only the resulting text. `onResult({ text, isFinal })` fires as the
 * user speaks; interim results stream live, finals land when a phrase settles.
 *
 * @param {boolean} active  start while true, stop while false
 * @param {{ lang?: string, onResult?: Function, onError?: Function }} opts
 */
export default function useSpeechRecognition(active, { lang, onResult, onError } = {}) {
  // Keep callbacks + the active flag in refs so the recognition instance isn't
  // torn down and rebuilt every render when the parent passes fresh closures.
  // Synced in an effect (not during render) so the engine's long-lived handlers
  // always read the latest values.
  const cbRef = useRef({ onResult, onError })
  const activeRef = useRef(active)
  useEffect(() => {
    cbRef.current = { onResult, onError }
    activeRef.current = active
  })

  useEffect(() => {
    if (!active || !SpeechRecognitionImpl) return

    let terminated = false
    // The engine's current best guess for the in-progress (not yet finalized)
    // phrase. Tracked so `onend` can flush it as a best-effort final instead
    // of silently losing it — see the onend comment below for why that
    // matters. Cleared whenever a real final arrives for the same phrase.
    let pendingInterim = ''
    // Retry bookkeeping for restart(): a bare `rec.start()` throws if the
    // engine hasn't fully released the previous session yet (a real race on
    // rapid onend→start, tab wake from sleep, etc.). Swallowing that
    // silently — the old behaviour — left recognition dead until something
    // else (e.g. a mic re-toggle) happened to remount the hook, so every word
    // spoken in that gap was simply never transcribed. Retrying with a short
    // backoff instead keeps actual STT coverage close to continuous.
    let retryTimer = null
    let retryAttempt = 0
    const MAX_RETRY_MS = 2000
    // Some engine versions can go quiet mid-session — no result, no error, no
    // onend — after a device sleep/wake, Bluetooth headset switch, or OS audio
    // hiccup. Nothing above would ever notice, since everything hinges on an
    // event that never comes. A liveness watchdog forces a hard reset if too
    // long has passed without ANY engine event while we expect to be listening.
    let lastEventAt = Date.now()
    const WATCHDOG_CHECK_MS = 4000
    const WATCHDOG_STALL_MS = 15000

    const rec = new SpeechRecognitionImpl()
    rec.lang = lang || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    const clearRetry = () => {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    }

    const restart = () => {
      if (terminated || !activeRef.current) return
      try {
        rec.start()
        retryAttempt = 0
      } catch {
        // Already starting/running, or the browser hasn't released the mic
        // yet — back off and try again rather than giving up permanently.
        // A little jitter keeps many participants recovering from the same
        // blip (e.g. a shared network hiccup) from all retrying in lockstep.
        const delay = Math.min(300 * 2 ** retryAttempt, MAX_RETRY_MS) + Math.random() * 100
        retryAttempt += 1
        clearRetry()
        retryTimer = setTimeout(restart, delay)
      }
    }

    const watchdog = setInterval(() => {
      if (terminated || !activeRef.current) return
      if (Date.now() - lastEventAt > WATCHDOG_STALL_MS) {
        lastEventAt = Date.now() // avoid re-firing every tick while it recovers
        try { rec.abort() } catch { /* onend (if it ever fires) will restart us */ }
      }
    }, WATCHDOG_CHECK_MS)

    rec.onstart = () => { lastEventAt = Date.now() }

    rec.onresult = (e) => {
      lastEventAt = Date.now()
      retryAttempt = 0
      let interim = ''
      let final = ''
      let conf = 0
      let confN = 0
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const piece = r[0].transcript
        // A single event can carry more than one result piece (e.g. two
        // distinct finals batched together); concatenating without a
        // separator glued them into one run-on word instead of two.
        if (r.isFinal) {
          final += (final ? ' ' : '') + piece
          // Only finals carry a meaningful confidence; average across them.
          if (typeof r[0].confidence === 'number') { conf += r[0].confidence; confN++ }
        } else {
          interim += (interim ? ' ' : '') + piece
        }
      }
      const confidence = confN ? conf / confN : 0
      if (final) {
        pendingInterim = ''
        cbRef.current.onResult?.({ text: final.trim(), isFinal: true, confidence })
      } else if (interim) {
        pendingInterim = interim
        cbRef.current.onResult?.({ text: interim.trim(), isFinal: false, confidence: 0 })
      }
    }

    rec.onerror = (e) => {
      lastEventAt = Date.now()
      // 'no-speech'/'aborted'/'network' are transient and self-heal on restart.
      // Permission errors are terminal — surface them so the UI can fall back.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        terminated = true
        clearRetry()
        cbRef.current.onError?.(e.error)
      }
    }

    rec.onend = () => {
      lastEventAt = Date.now()
      // Chrome stops the engine after a pause; restart while still active to
      // keep one continuous transcript. Skip if the mic was denied or we're
      // tearing down.
      if (!terminated && activeRef.current) {
        // A fresh recognition session has no memory of the outgoing one's
        // in-progress phrase — if the speaker was mid-sentence when the
        // engine stopped, whatever was only interim-so-far (never finalized)
        // would otherwise vanish silently right here. Flush it as a
        // best-effort final so it still reaches the transcript.
        if (pendingInterim) {
          const flushed = pendingInterim
          pendingInterim = ''
          cbRef.current.onResult?.({ text: flushed.trim(), isFinal: true })
        }
        restart()
      }
    }

    restart()

    return () => {
      terminated = true
      clearRetry()
      clearInterval(watchdog)
      // Same loss the onend handler guards against (see above), but on a
      // MANUAL stop (mic muted, captions turned off, leaving the meeting) —
      // onend is about to be nulled specifically so it won't restart us, which
      // would otherwise also silence this exact flush. Do it here directly so
      // an in-progress phrase still reaches the transcript even when the
      // session ends deliberately rather than via the engine's own timeout.
      if (pendingInterim) {
        const flushed = pendingInterim
        pendingInterim = ''
        cbRef.current.onResult?.({ text: flushed.trim(), isFinal: true })
      }
      try {
        rec.onend = null // prevent the auto-restart firing during teardown
        rec.stop()
      } catch { /* ignore */ }
    }
  }, [active, lang])
}
