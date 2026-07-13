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
// bubble per speaker — old text is replaced here. The full-meeting log lives
// separately in `transcript` state (see CaptionProvider), appended to on
// every final result rather than replaced.
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

// Hard cap on accumulated transcript lines — a many-hour meeting shouldn't
// grow this array unboundedly in memory. Oldest lines drop off the front.
const MAX_TRANSCRIPT_LINES = 4000

// Consecutive finals from the same speaker within this gap are one
// continuous thought (a mid-sentence recognizer pause), not a new line.
const FRAGMENT_MERGE_GAP_MS = 2000

/**
 * Owns the entire caption lifecycle and exposes it through two contexts.
 * Must render inside <LiveKitRoom> (uses LiveKit hooks for the local
 * participant and the data channel).
 *
 * Flow: local mic → SpeechRecognition → throttle/sanitize → broadcast over the
 * LiveKit data channel + echo locally → per-speaker state with a silence timer.
 *
 * There are TWO independent reasons speech recognition might be running,
 * and they must stay independent:
 *   - `enabled` — the visible "CC" toggle (toolbar button, C/Shift+C
 *     shortcut, persisted to localStorage). Drives the on-screen caption
 *     bubble overlay (CaptionOverlay gates on this directly).
 *   - `summarizerCapturing` — toggled on/off from the Meet Summarizer panel,
 *     via `capturing`/`setCapturing` on the control context (both
 *     MeetingHeader and MeetSummaryPanel render inside this provider, so
 *     they read/drive it directly — no prop drilling needed). Feeds the
 *     Conversations transcript. Never touches `enabled`, never persisted,
 *     and never makes the bubble overlay appear — that stays keyed to
 *     `enabled` alone.
 * Recognition itself runs whenever EITHER is true (one shared mic tap), but
 * only `enabled` decides what's shown on screen.
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
  // Independent of `enabled` — see the class doc comment above. Toggled
  // on/off from the Meet Summarizer panel, not persisted.
  const [summarizerCapturing, setSummarizerCapturing] = useState(false)
  const [micError, setMicError] = useState(false)
  const [bySpeaker, dispatch] = useReducer(reducer, {})
  // Full-meeting transcript — every FINAL caption, in order, across all
  // speakers. Interims never land here (they're corrections-in-progress);
  // only `bySpeaker` shows those, live. Consumed by the Conversations panel.
  const [transcript, setTranscript] = useState([])

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
      if (isFinal) {
        setTranscript((lines) => {
          const now = Date.now()
          const prev = lines[lines.length - 1]
          // Chrome's recognizer finalizes continuous speech into many short
          // fragments, often mid-sentence on a barely-there pause. Stitching
          // consecutive finals from the SAME speaker back into one line (when
          // they land close together) turns "shredded" fragments back into
          // readable sentences instead of one choppy line per fragment.
          const merge = prev && prev.speakerId === speakerId && now - prev.ts < FRAGMENT_MERGE_GAP_MS
          const next = merge
            ? [...lines.slice(0, -1), { ...prev, text: sanitize(`${prev.text} ${clean}`), ts: now }]
            : [...lines, { speakerId, name: name || 'Guest', text: clean, ts: now }]
          return next.length > MAX_TRANSCRIPT_LINES ? next.slice(next.length - MAX_TRANSCRIPT_LINES) : next
        })
      }
    },
    [armExpiry],
  )

  const { publish } = useCaptionTransport({ onCaption: ingest })

  // Local recognition result → echo locally at full engine speed, broadcast
  // interims throttled (finals always go out immediately either way).
  const handleResult = useCallback(
    ({ text, isFinal }) => {
      // Hard guard: never emit while muted. Catches the trailing final result
      // some browsers fire immediately after the engine is stopped on mute.
      if (!isMicrophoneEnabled) return
      const clean = sanitize(text)
      if (!clean) return
      const id = localParticipant?.identity || 'me'
      // Local echo is our own state update, not network traffic — showing it
      // the instant the engine emits it (rather than capped to the broadcast
      // throttle) is what makes your own caption bubble feel responsive.
      ingest({ speakerId: id, name: localParticipant?.name || 'You', text: clean, isFinal })

      if (!isFinal) {
        const now = Date.now()
        if (now - lastInterimRef.current < CAPTION_CONFIG.interimThrottleMs) return
        lastInterimRef.current = now
      }
      publish({ text: clean, isFinal })
    },
    [ingest, publish, localParticipant, isMicrophoneEnabled],
  )

  // Capture runs if EITHER the visible CC toggle OR the summarizer wants it
  // (see the class doc comment) — one shared mic tap, two independent
  // reasons to use it — as long as the API is supported, the mic wasn't
  // denied, AND the participant's meeting mic is live. Muting in the meeting
  // stops recognition immediately — no captions are generated or broadcast
  // while muted.
  useSpeechRecognition((enabled || summarizerCapturing) && supported && !micError && isMicrophoneEnabled, {
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

  // On/off switch for Meet Summarizer capture — deliberately does NOT touch
  // `enabled`/localStorage, so the visible CC toggle and bubble overlay are
  // completely unaffected by this. Turning it on clears a stale
  // mic-permission error, same as `toggle` would. Called directly from the
  // Meet Summarizer panel's toggle button (via context, see class doc
  // comment).
  const setCapturing = useCallback((value) => {
    if (!supported) return
    if (value) setMicError(false)
    setSummarizerCapturing(value)
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
    () => ({ enabled, supported, micError, toggle, capturing: summarizerCapturing, setCapturing }),
    [enabled, supported, micError, toggle, summarizerCapturing, setCapturing],
  )
  // Live value: changes per frame, consumed only by the overlay + the
  // Conversations panel.
  const live = useMemo(() => ({ bySpeaker, transcript }), [bySpeaker, transcript])

  return (
    <CaptionsControlContext.Provider value={control}>
      <CaptionsLiveContext.Provider value={live}>{children}</CaptionsLiveContext.Provider>
    </CaptionsControlContext.Provider>
  )
}
