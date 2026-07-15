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
    const rec = new SpeechRecognitionImpl()
    rec.lang = lang || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (e) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const piece = r[0].transcript
        // A single event can carry more than one result piece (e.g. two
        // distinct finals batched together); concatenating without a
        // separator glued them into one run-on word instead of two.
        if (r.isFinal) final += (final ? ' ' : '') + piece
        else interim += (interim ? ' ' : '') + piece
      }
      if (final) {
        pendingInterim = ''
        cbRef.current.onResult?.({ text: final.trim(), isFinal: true })
      } else if (interim) {
        pendingInterim = interim
        cbRef.current.onResult?.({ text: interim.trim(), isFinal: false })
      }
    }

    rec.onerror = (e) => {
      // 'no-speech'/'aborted'/'network' are transient and self-heal on restart.
      // Permission errors are terminal — surface them so the UI can fall back.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        terminated = true
        cbRef.current.onError?.(e.error)
      }
    }

    rec.onend = () => {
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
        try { rec.start() } catch { /* already (re)starting */ }
      }
    }

    try {
      rec.start()
    } catch {
      /* start() throws if called while already running — safe to ignore */
    }

    return () => {
      terminated = true
      try {
        rec.onend = null // prevent the auto-restart firing during teardown
        rec.stop()
      } catch { /* ignore */ }
    }
  }, [active, lang])
}
