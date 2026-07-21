import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocalParticipant, useSpeakingParticipants, useTrackVolume } from '@livekit/components-react'
import useSpeechRecognition, { speechRecognitionSupported } from '../useSpeechRecognition'
import { CAPTION_CONFIG } from '../config'
import { clog } from '../captionDebug'

export const supported = speechRecognitionSupported

/**
 * On-device caption source (default engine). Wraps the browser SpeechRecognition
 * engine with two things the raw engine lacks:
 *
 *  1. A SPEAKING GATE — results are only forwarded while the local participant
 *     is actually speaking (+ a short hangover). This ties captions to real
 *     audio activity and suppresses echo/bleed: your engine may hear other
 *     people through your speakers, but we don't attribute that text to you
 *     unless YOUR audio level is up. Two independent signals feed the gate —
 *     LiveKit's server-confirmed active-speaker state, and a local, zero
 *     round-trip Web Audio volume check on our own mic track — so the gate
 *     opens the instant EITHER says we're speaking (see localVad below).
 *
 *  2. UTTERANCE SEGMENTATION + SEQUENCING — each continuous speaking turn gets a
 *     fresh `utteranceId` (so a new turn starts a new caption line instead of
 *     appending to the last one), and every emitted frame carries a strictly
 *     increasing `seq` so the buffer can order/de-dup across the lossy channel.
 *
 * Emits enriched frames to `onResult({ text, isFinal, confidence, seq, utteranceId })`.
 *
 * @param {{ active: boolean, onResult: Function, onError?: Function }} opts
 */
export default function useWebSpeechSource({ active, onResult, onError }) {
  const { localParticipant, microphoneTrack } = useLocalParticipant()
  // Derive local speaking state from the room-wide active-speaker list (the same
  // audio-activity signal that drives the hero) rather than passing a possibly
  // -undefined participant to useIsSpeaking.
  const speakers = useSpeakingParticipants()
  const localId = localParticipant?.identity
  const liveKitSpeaking = useMemo(
    () => !!localId && speakers.some((p) => p.identity === localId),
    [speakers, localId],
  )

  // Fast path: sample OUR OWN mic's audio level directly in the browser
  // (no SFU round trip) so the gate doesn't have to wait on the server signal
  // above, which is measuring the exact same audio just after it's been
  // encoded, sent, analysed, and pushed back to us. useTrackVolume no-ops
  // safely while the mic track isn't published yet (returns 0).
  const localVolume = useTrackVolume(microphoneTrack?.track, {
    fftSize: CAPTION_CONFIG.localVadFftSize,
    smoothingTimeConstant: CAPTION_CONFIG.localVadSmoothing,
  })
  const localVadSpeaking = CAPTION_CONFIG.localVadEnabled && localVolume > CAPTION_CONFIG.localVadVolumeThreshold
  const isSpeakingNow = liveKitSpeaking || localVadSpeaking

  const seqRef = useRef(0)
  const utteranceRef = useRef(0)
  const gateOpenRef = useRef(false)
  const hangoverRef = useRef(null)
  const lastEmitRef = useRef(0)
  const onResultRef = useRef(onResult)
  useEffect(() => { onResultRef.current = onResult })

  // Last INTERIM forwarded while the gate was open, not yet superseded by a
  // final. Every word a viewer sees on screen came through here first — if
  // the browser's own "final" for that phrase never arrives (or arrives after
  // the gate has already closed and gets dropped below), this is the only
  // record of it. Cleared the moment a real final lands.
  const pendingRef = useRef(null)

  // Whether we've seen ANY result (interim or final) yet for the CURRENT
  // utteranceId. Reset every time a new utterance begins (see beginUtterance).
  // The engine always surfaces at least one interim before finalizing a
  // phrase — it can't finalize speech it hasn't shown us — so a `final`
  // arriving as the very FIRST thing for a fresh utterance is never
  // legitimate. It's a straggler: the engine finishing its finalization of
  // the PREVIOUS phrase late, after our (now much faster) gate has already
  // moved on to the next one. Without this check that straggler gets tagged
  // with the new utteranceId and its text ends up prepended onto the new
  // sentence — see the "previous sentence's last words" bug.
  const seenResultRef = useRef(false)

  const beginUtterance = useCallback(() => {
    utteranceRef.current += 1
    seenResultRef.current = false
  }, [])

  const emit = useCallback((text, isFinal, confidence) => {
    seqRef.current += 1
    onResultRef.current?.({
      text,
      isFinal,
      confidence,
      seq: seqRef.current,
      utteranceId: utteranceRef.current,
    })
  }, [])

  const flushPending = useCallback(() => {
    if (!pendingRef.current) return
    const { text, confidence } = pendingRef.current
    pendingRef.current = null
    emit(text, true, confidence)
  }, [emit])

  // Drive the speaking gate off the combined audio-activity signal (local VAD
  // OR LiveKit's server-confirmed state — see isSpeakingNow above). Opening the
  // gate from closed begins a new utterance. Closing is delayed by the hangover
  // so a brief inter-word dip doesn't split one sentence into two lines.
  useEffect(() => {
    if (!CAPTION_CONFIG.speakingGateEnabled) { gateOpenRef.current = true; return undefined }
    if (isSpeakingNow) {
      if (hangoverRef.current) { clearTimeout(hangoverRef.current); hangoverRef.current = null }
      if (!gateOpenRef.current) {
        gateOpenRef.current = true
        beginUtterance()
        clog('speaker-detected', { utteranceId: utteranceRef.current })
      }
    } else if (gateOpenRef.current && !hangoverRef.current) {
      hangoverRef.current = setTimeout(() => {
        gateOpenRef.current = false
        hangoverRef.current = null
        // The engine's real "final" for this phrase may be slow to land, or
        // may land after the gate is already shut (and get dropped by the
        // check in handle() below) — either way, whatever was last shown on
        // screen for this utterance must still reach the saved transcript.
        flushPending()
      }, CAPTION_CONFIG.speakingHangoverMs)
    }
    return undefined
  }, [isSpeakingNow, flushPending, beginUtterance])

  useEffect(() => () => {
    if (hangoverRef.current) clearTimeout(hangoverRef.current)
    // Leaving the meeting / turning captions off mid-sentence — same rule as
    // above: don't drop whatever was already visible just because the gate
    // never got a chance to close normally.
    flushPending()
  }, [flushPending])

  const handle = useCallback(({ text, isFinal, confidence }) => {
    // Gate: drop anything captured while we're not the one speaking.
    if (CAPTION_CONFIG.speakingGateEnabled && !gateOpenRef.current) return

    // With the gate off, fall back to gap-based segmentation so a new sentence
    // after a pause still starts a fresh line.
    if (!CAPTION_CONFIG.speakingGateEnabled) {
      const now = Date.now()
      if (now - lastEmitRef.current > CAPTION_CONFIG.speakingHangoverMs) beginUtterance()
      lastEmitRef.current = now
    }

    // See seenResultRef's doc comment: a final can't legitimately be the
    // first thing heard for a brand new utterance — drop the straggler
    // instead of prepending the previous sentence's tail onto this one.
    if (isFinal && !seenResultRef.current) return
    seenResultRef.current = true

    pendingRef.current = isFinal ? null : { text, confidence }
    emit(text, isFinal, confidence)
  }, [emit, beginUtterance])

  useSpeechRecognition(active, {
    lang: CAPTION_CONFIG.lang,
    onResult: handle,
    onError,
  })
}
