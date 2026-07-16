import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalParticipant, useRemoteParticipants, useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { CAPTION_CONFIG } from './config'
import { createCaptionStore } from './captionStore'
import { resolveIdentity } from './captionIdentity'
import { getCaptionSource } from './sources'
import useCaptionPresence from './captionPresence'
import useCaptionTransport from './captionTransport'
import { clog } from './captionDebug'
import { CaptionsControlContext, CaptionsLiveContext } from './useCaptions'

// Constrained devices (phones/tablets) only RENDER captions by default; they
// don't run the recogniser unless explicitly enabled, to save battery/CPU and
// avoid iOS Safari's flaky Web Speech engine. Desktop always captures.
const IS_MOBILE =
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
const MOBILE_CAPTURE_OK = !IS_MOBILE || CAPTION_CONFIG.mobileCaptureEnabled

// Sanitise a caption: replace control characters with spaces (defence against
// malformed/hostile payloads) and cap the length. Done as a codepoint scan to
// keep the source ASCII-clean. React escapes the text on render too, so this is
// belt-and-braces against injection.
//
// Takes an explicit `maxLen` (defaulting to `maxLineChars`) because `ingest`
// below re-sanitizes a MERGED line — a single fragment and the merged line it
// becomes part of are each within the cap individually, but concatenated they
// could exceed it, so the same cap gets re-applied to the combined text.
function sanitize(text, maxLen = CAPTION_CONFIG.maxLineChars) {
  const s = String(text || '')
  let out = ''
  for (let i = 0; i < s.length && out.length < maxLen; i++) {
    const code = s.charCodeAt(i)
    out += code < 32 || code === 127 ? ' ' : s[i]
  }
  return out.replace(/^\s+/, '')
}

// The Web Speech API returns fragments lowercase-first ("hello, how are
// you") — capitalize so transcript lines read as proper sentences.
function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

// Hard cap on accumulated transcript lines — a many-hour meeting shouldn't
// grow this array unboundedly in memory. Oldest lines drop off the front.
const MAX_TRANSCRIPT_LINES = 4000

/**
 * Owns the caption lifecycle and exposes it through two contexts. Must render
 * inside <LiveKitRoom> (uses LiveKit hooks + the data channel).
 *
 * Pipeline (each stage isolated, see the caption folder):
 *   CaptionSource → speaking gate → sanitize → transport (E2EE) →
 *   per-speaker buffer (captionStore) → renderer.
 * A second, independent tap on the same sanitized frames accumulates
 * `transcript` — the finals-only, full-meeting log — never rendered
 * in-meeting; only sent to the backend at host-leave to generate the AI
 * summary and the post-meeting raw conversation log.
 *
 * Capture is DECOUPLED from the local CC toggle: as long as captions are
 * wanted anywhere in the room — either a participant's own CC toggle
 * (`enabled`) OR Meet Summarizer being on (`summarizerCapturing`, toggled via
 * the Meet Summarizer popover, never persisted) — every unmuted participant's
 * client transcribes its own mic and broadcasts, via the same presence gossip
 * (see captionPresence.js — both flags feed the same "wants captions" signal).
 * The local `enabled` toggle only controls whether captions are RENDERED
 * here; `summarizerCapturing` never touches `enabled`/localStorage, and never
 * makes the bubble overlay appear on its own.
 */
export default function CaptionProvider({ children }) {
  const room = useRoomContext()
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()
  const remotes = useRemoteParticipants()

  const { useSource, supported } = getCaptionSource()

  // Local CC on/off (render toggle), persisted per-device.
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(CAPTION_CONFIG.storageKey) === '1' } catch { return false }
  })
  // Independent of `enabled` — see the class doc comment above. Toggled
  // on/off from the Meet Summarizer panel, not persisted.
  const [summarizerCapturing, setSummarizerCapturing] = useState(false)
  const [micError, setMicError] = useState(false)
  // Full-meeting transcript — every FINAL caption, in order, across all
  // speakers. Interims never land here (they're corrections-in-progress);
  // only the live buffer store shows those. Captured silently — never
  // rendered in-meeting — and read via transcriptRef in MeetRoomLivekit at
  // host-leave.
  const [transcript, setTranscript] = useState([])

  // One buffer store for the whole meeting. Frame-rate updates live here, NOT in
  // React state, so only the overlay (via useSyncExternalStore) re-renders.
  const storeRef = useRef(null)
  if (!storeRef.current) {
    storeRef.current = createCaptionStore({ config: CAPTION_CONFIG, onEvent: clog })
  }
  const store = storeRef.current

  // Stable list of remote identities (only changes on join/leave).
  const remoteIdKey = useMemo(
    () => remotes.map((p) => p.identity).sort().join(','),
    [remotes],
  )
  const remoteIdentities = useMemo(
    () => (remoteIdKey ? remoteIdKey.split(',') : []),
    [remoteIdKey],
  )

  // Meet Summarizer demand feeds the SAME "wants captions" presence signal as
  // the personal CC toggle — so starting it makes every participant's client
  // start transcribing too, not just whoever clicked the button.
  const roomWantsCaptions = useCaptionPresence({ enabled: enabled || summarizerCapturing, remoteIdentities })

  // Single ingest path for local echo AND remote captions: sanitize, drop STT
  // noise, hand to the live buffer, and — for finals — append to the
  // accumulated transcript used for the post-meeting AI summary.
  const ingest = useCallback(
    (frame) => {
      const clean = sanitize(frame.text)
      if (!clean || !frame.speakerId) return
      // Drop meaningless STT artifacts — fragments with no letter OR digit in
      // any script (e.g. ".", "- -", pure punctuation noise). Real speech —
      // including spoken numbers the recognizer transcribed as digits, e.g.
      // "50" for "fifty" — always has letters or digits; only punctuation-only
      // noise has neither. Requiring letters alone silently dropped every
      // number-only fragment a speaker said, which reads as missing words.
      if (!/[\p{L}\p{N}]/u.test(clean)) return
      store.ingest({ ...frame, text: clean })
      if (frame.isFinal) {
        setTranscript((lines) => {
          const prev = lines[lines.length - 1]
          // Same-utterance finals — per the source's own segmentation, a new
          // speaking turn gets a fresh utteranceId — are one continuous
          // thought; stitch them into one line instead of one choppy line
          // per fragment. Re-sanitize the merged result since the cap
          // applies per LINE, not per fragment.
          const merge = prev && prev.speakerId === frame.speakerId && prev.utteranceId === frame.utteranceId
          const next = merge
            ? [...lines.slice(0, -1), { ...prev, text: sanitize(`${prev.text} ${clean}`, CAPTION_CONFIG.maxLineChars), ts: Date.now() }]
            : [...lines, {
                speakerId: frame.speakerId,
                utteranceId: frame.utteranceId,
                name: frame.identity?.name || 'Guest',
                text: capitalize(clean),
                ts: Date.now(),
              }]
          return next.length > MAX_TRANSCRIPT_LINES ? next.slice(next.length - MAX_TRANSCRIPT_LINES) : next
        })
      }
    },
    [store],
  )

  const { publish } = useCaptionTransport({ onCaption: ingest })

  // Local recognition result → throttle interims, echo locally, broadcast.
  const lastInterimRef = useRef(0)
  const onLocalResult = useCallback(
    ({ text, isFinal, confidence, seq, utteranceId }) => {
      if (!isMicrophoneEnabled) return // hard guard: never emit while muted
      const now = Date.now()
      if (!isFinal && now - lastInterimRef.current < CAPTION_CONFIG.interimThrottleMs) return
      lastInterimRef.current = now
      const identity = resolveIdentity(localParticipant)
      ingest({ speakerId: identity.speakerId, identity, text, isFinal, confidence, seq, utteranceId, lang: CAPTION_CONFIG.lang })
      publish({ text, isFinal, seq, utteranceId, confidence })
    },
    [ingest, publish, localParticipant, isMicrophoneEnabled],
  )

  // Capture runs while captions are wanted in the room (personal toggle OR
  // Meet Summarizer — see roomWantsCaptions above), the engine is supported,
  // the mic wasn't denied, this device is allowed to capture, and the mic is
  // live. Note: NOT gated on the local `enabled` — that's a render choice.
  const captureActive =
    supported && !micError && isMicrophoneEnabled && roomWantsCaptions && MOBILE_CAPTURE_OK
  useSource({ active: captureActive, onResult: onLocalResult, onError: () => setMicError(true) })

  // ── LiveKit participant-event sync ──────────────────────────────────────────
  // Keep the buffer in lockstep with room membership/identity so captions never
  // linger on a departed speaker or show a stale name after a rename.
  useEffect(() => {
    if (!room) return undefined
    const onLeft = (p) => { store.remove(p.identity, 'disconnect') }
    const onIdentity = (_prevOrMeta, p) => {
      const participant = p || _prevOrMeta
      if (participant?.identity) store.refreshIdentity(participant.identity, resolveIdentity(participant))
    }
    room.on(RoomEvent.ParticipantDisconnected, onLeft)
    room.on(RoomEvent.ParticipantNameChanged, onIdentity)
    room.on(RoomEvent.ParticipantMetadataChanged, onIdentity)
    return () => {
      room.off(RoomEvent.ParticipantDisconnected, onLeft)
      room.off(RoomEvent.ParticipantNameChanged, onIdentity)
      room.off(RoomEvent.ParticipantMetadataChanged, onIdentity)
    }
  }, [room, store])

  const toggle = useCallback(() => {
    if (!supported) return
    setMicError(false)
    setEnabled((v) => {
      const next = !v
      try { localStorage.setItem(CAPTION_CONFIG.storageKey, next ? '1' : '0') } catch { /* storage blocked */ }
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

  // Tear the buffer down on unmount (leaving the meeting).
  useEffect(() => () => store.purgeAll(), [store])

  // Control value: stable except on rare toggles → consumers barely re-render.
  const control = useMemo(
    () => ({ enabled, supported, micError, toggle, capturing: summarizerCapturing, setCapturing }),
    [enabled, supported, micError, toggle, summarizerCapturing, setCapturing],
  )
  // Live value: the store handle (stable) + transcript (changes once per
  // finalized line). The overlay subscribes to the store directly via
  // useSyncExternalStore, so per-frame caption updates never re-render this
  // provider — only a new finalized transcript line does.
  const live = useMemo(() => ({ store, transcript }), [store, transcript])

  return (
    <CaptionsControlContext.Provider value={control}>
      <CaptionsLiveContext.Provider value={live}>{children}</CaptionsLiveContext.Provider>
    </CaptionsControlContext.Provider>
  )
}
