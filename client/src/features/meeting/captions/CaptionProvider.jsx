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
// malformed/hostile payloads) and cap the length. React escapes on render too,
// so this is belt-and-braces against injection.
function sanitize(text) {
  const s = String(text || '')
  let out = ''
  for (let i = 0; i < s.length && out.length < CAPTION_CONFIG.maxChars; i++) {
    const code = s.charCodeAt(i)
    out += code < 32 || code === 127 ? ' ' : s[i]
  }
  return out.replace(/^\s+/, '')
}

/**
 * Owns the caption lifecycle and exposes it through two contexts. Must render
 * inside <LiveKitRoom> (uses LiveKit hooks + the data channel).
 *
 * Pipeline (each stage isolated, see the caption folder):
 *   CaptionSource → speaking gate → sanitize → transport (E2EE) →
 *   per-speaker buffer (captionStore) → renderer.
 *
 * Capture is DECOUPLED from the local CC toggle: as long as captions are wanted
 * anywhere in the room (presence) and the mic is live, this client transcribes
 * its OWN mic and broadcasts — so whoever turns CC on sees every speaker. The
 * local toggle only controls whether captions are RENDERED here.
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
  const [micError, setMicError] = useState(false)

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

  const roomWantsCaptions = useCaptionPresence({ enabled, remoteIdentities })

  // Single ingest path for local echo AND remote captions: sanitize, drop STT
  // noise (fragments with no letter in any script), then hand to the buffer.
  const ingest = useCallback(
    (frame) => {
      const clean = sanitize(frame.text)
      if (!clean || !frame.speakerId) return
      if (!/\p{L}/u.test(clean)) return
      store.ingest({ ...frame, text: clean })
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

  // Capture runs while captions are wanted in the room, the engine is supported,
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
    () => ({ enabled, supported, micError, toggle }),
    [enabled, supported, micError, toggle],
  )
  // Live value: the store handle (stable). The overlay subscribes to it directly
  // via useSyncExternalStore, so caption frames never re-render this provider.
  const live = useMemo(() => ({ store }), [store])

  return (
    <CaptionsControlContext.Provider value={control}>
      <CaptionsLiveContext.Provider value={live}>{children}</CaptionsLiveContext.Provider>
    </CaptionsControlContext.Provider>
  )
}
