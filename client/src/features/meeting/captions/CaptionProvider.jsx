import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { CAPTION_CONFIG } from './config'
import { speakerColor } from './speakerColor'
import useSpeechRecognition, { speechRecognitionSupported } from './useSpeechRecognition'
import useCaptionTransport from './captionTransport'
import { CaptionsControlContext, CaptionsLiveContext } from './useCaptions'

// Sanitise a caption: replace control characters with spaces (defence against
// malformed/hostile payloads) and cap the length. Done as a codepoint scan to
// keep the source ASCII-clean. React escapes the text on render too, so this is
// belt-and-braces against injection.
function sanitize(text) {
  const s = String(text || '')
  let out = ''
  for (let i = 0; i < s.length && out.length < CAPTION_CONFIG.maxChars; i++) {
    const code = s.charCodeAt(i)
    out += code < 32 || code === 127 ? ' ' : s[i]
  }
  return out.replace(/^\s+/, '')
}

// Flat map: speakerId -> { name, color, text, isFinal, ts }. One live caption
// per speaker (we never accumulate a transcript — old text is replaced).
function reducer(state, action) {
  switch (action.type) {
    case 'upsert': {
      const { speakerId, name, color, text, isFinal, ts } = action
      return { ...state, [speakerId]: { name, color, text, isFinal, ts } }
    }
    case 'expire': {
      if (!state[action.speakerId]) return state
      const next = { ...state }
      delete next[action.speakerId]
      return next
    }
    default:
      return state
  }
}

/**
 * Owns the entire caption lifecycle and exposes it through two contexts.
 * Must render inside <LiveKitRoom> (uses LiveKit hooks for the local
 * participant and the data channel).
 *
 * Flow: local mic → SpeechRecognition → throttle/sanitize → broadcast over the
 * LiveKit data channel + echo locally → per-speaker state with a silence timer.
 */
export default function CaptionProvider({ children }) {
  // `isMicrophoneEnabled` is reactive — it flips the instant the participant
  // mutes/unmutes in the meeting. We gate capture on it so a muted mic never
  // produces captions (the Web Speech engine taps the system mic on its own,
  // independent of LiveKit, so without this it would keep transcribing — and
  // broadcasting — while muted).
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()
  const supported = speechRecognitionSupported

  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(CAPTION_CONFIG.storageKey) === '1'
    } catch {
      return false
    }
  })
  const [micError, setMicError] = useState(false)
  const [bySpeaker, dispatch] = useReducer(reducer, {})

  const timersRef = useRef({}) // speakerId -> silence timeout
  const lastInterimRef = useRef(0)

  // (Re)arm a speaker's silence expiry so stale captions fade after a pause.
  const armExpiry = useCallback((speakerId) => {
    clearTimeout(timersRef.current[speakerId])
    timersRef.current[speakerId] = setTimeout(() => {
      dispatch({ type: 'expire', speakerId })
      delete timersRef.current[speakerId]
    }, CAPTION_CONFIG.silenceTimeoutMs)
  }, [])

  // Single ingest path for both local echo and remote captions.
  const ingest = useCallback(
    ({ speakerId, name, text, isFinal }) => {
      const clean = sanitize(text)
      if (!clean || !speakerId) return
      // Drop meaningless STT artifacts — fragments with no letter in any script
      // (e.g. "1.00", ".", "- -"). Real speech always has letters; these are
      // recogniser noise that otherwise flashes on screen as a stray caption.
      if (!/\p{L}/u.test(clean)) return
      dispatch({
        type: 'upsert',
        speakerId,
        name: name || 'Guest',
        color: speakerColor(speakerId),
        text: clean,
        isFinal,
        ts: Date.now(),
      })
      armExpiry(speakerId)
    },
    [armExpiry],
  )

  const { publish } = useCaptionTransport({ onCaption: ingest })

  // Local recognition result → throttle interims, broadcast, echo locally.
  const handleResult = useCallback(
    ({ text, isFinal }) => {
      // Hard guard: never emit while muted. Catches the trailing final result
      // some browsers fire immediately after the engine is stopped on mute.
      if (!isMicrophoneEnabled) return
      const now = Date.now()
      if (!isFinal && now - lastInterimRef.current < CAPTION_CONFIG.interimThrottleMs) return
      lastInterimRef.current = now
      const clean = sanitize(text)
      if (!clean) return
      const id = localParticipant?.identity || 'me'
      ingest({ speakerId: id, name: localParticipant?.name || 'You', text: clean, isFinal })
      publish({ text: clean, isFinal })
    },
    [ingest, publish, localParticipant, isMicrophoneEnabled],
  )

  // Capture runs only while CC is on, the API is supported, the mic wasn't
  // denied, AND the participant's meeting mic is live. Muting in the meeting
  // stops recognition immediately — no captions are generated or broadcast
  // while muted.
  useSpeechRecognition(enabled && supported && !micError && isMicrophoneEnabled, {
    lang: CAPTION_CONFIG.lang,
    onResult: handleResult,
    onError: () => setMicError(true),
  })

  const toggle = useCallback(() => {
    if (!supported) return
    setMicError(false)
    setEnabled((v) => {
      const next = !v
      try {
        localStorage.setItem(CAPTION_CONFIG.storageKey, next ? '1' : '0')
      } catch { /* storage blocked — in-memory state still works */ }
      return next
    })
  }, [supported])

  // Keyboard shortcut: C / Shift+C. Ignored while typing in any field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key !== 'c' && e.key !== 'C') return
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  // Clear all silence timers on unmount.
  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout)
    timersRef.current = {}
  }, [])

  // Control value: stable except on rare toggles → consumers barely re-render.
  const control = useMemo(
    () => ({ enabled, supported, micError, toggle }),
    [enabled, supported, micError, toggle],
  )
  // Live value: changes per frame, consumed only by the overlay.
  const live = useMemo(() => ({ bySpeaker }), [bySpeaker])

  return (
    <CaptionsControlContext.Provider value={control}>
      <CaptionsLiveContext.Provider value={live}>{children}</CaptionsLiveContext.Provider>
    </CaptionsControlContext.Provider>
  )
}
