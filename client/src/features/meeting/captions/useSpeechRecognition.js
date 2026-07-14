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
    const rec = new SpeechRecognitionImpl()
    rec.lang = lang || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (e) => {
      let interim = ''
      let final = ''
      let conf = 0
      let confN = 0
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          final += r[0].transcript
          // Only finals carry a meaningful confidence; average across them.
          if (typeof r[0].confidence === 'number') { conf += r[0].confidence; confN++ }
        } else {
          interim += r[0].transcript
        }
      }
      const confidence = confN ? conf / confN : 0
      if (final) cbRef.current.onResult?.({ text: final.trim(), isFinal: true, confidence })
      else if (interim) cbRef.current.onResult?.({ text: interim.trim(), isFinal: false, confidence: 0 })
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
