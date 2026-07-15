import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocalParticipant, useSpeakingParticipants } from '@livekit/components-react'
import useSpeechRecognition, { speechRecognitionSupported } from '../useSpeechRecognition'
import { CAPTION_CONFIG } from '../config'
import { clog } from '../captionDebug'

export const supported = speechRecognitionSupported

/**
 * On-device caption source (default engine). Wraps the browser SpeechRecognition
 * engine with two things the raw engine lacks:
 *
 *  1. A SPEAKING GATE — results are only forwarded while LiveKit reports the
 *     local participant as actually speaking (+ a short hangover). This ties
 *     captions to real audio activity (the same signal that drives the
 *     active-speaker hero) and suppresses echo/bleed: your engine may hear
 *     other people through your speakers, but we don't attribute that text to
 *     you unless YOUR audio level is up.
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
  const { localParticipant } = useLocalParticipant()
  // Derive local speaking state from the room-wide active-speaker list (the same
  // audio-activity signal that drives the hero) rather than passing a possibly
  // -undefined participant to useIsSpeaking.
  const speakers = useSpeakingParticipants()
  const localId = localParticipant?.identity
  const liveKitSpeaking = useMemo(
    () => !!localId && speakers.some((p) => p.identity === localId),
    [speakers, localId],
  )

  const seqRef = useRef(0)
  const utteranceRef = useRef(0)
  const gateOpenRef = useRef(false)
  const hangoverRef = useRef(null)
  const lastEmitRef = useRef(0)
  const onResultRef = useRef(onResult)
  useEffect(() => { onResultRef.current = onResult })

  // Drive the speaking gate off LiveKit's audio-activity signal. Opening the
  // gate from closed begins a new utterance. Closing is delayed by the hangover
  // so a brief inter-word dip doesn't split one sentence into two lines.
  useEffect(() => {
    if (!CAPTION_CONFIG.speakingGateEnabled) { gateOpenRef.current = true; return undefined }
    if (liveKitSpeaking) {
      if (hangoverRef.current) { clearTimeout(hangoverRef.current); hangoverRef.current = null }
      if (!gateOpenRef.current) {
        gateOpenRef.current = true
        utteranceRef.current += 1
        clog('speaker-detected', { utteranceId: utteranceRef.current })
      }
    } else if (gateOpenRef.current && !hangoverRef.current) {
      hangoverRef.current = setTimeout(() => {
        gateOpenRef.current = false
        hangoverRef.current = null
      }, CAPTION_CONFIG.speakingHangoverMs)
    }
    return undefined
  }, [liveKitSpeaking])

  useEffect(() => () => { if (hangoverRef.current) clearTimeout(hangoverRef.current) }, [])

  const handle = useCallback(({ text, isFinal, confidence }) => {
    // Gate: drop anything captured while we're not the one speaking.
    if (CAPTION_CONFIG.speakingGateEnabled && !gateOpenRef.current) return

    // With the gate off, fall back to gap-based segmentation so a new sentence
    // after a pause still starts a fresh line.
    if (!CAPTION_CONFIG.speakingGateEnabled) {
      const now = Date.now()
      if (now - lastEmitRef.current > CAPTION_CONFIG.speakingHangoverMs) utteranceRef.current += 1
      lastEmitRef.current = now
    }

    seqRef.current += 1
    onResultRef.current?.({
      text,
      isFinal,
      confidence,
      seq: seqRef.current,
      utteranceId: utteranceRef.current,
    })
  }, [])

  useSpeechRecognition(active, {
    lang: CAPTION_CONFIG.lang,
    onResult: handle,
    onError,
  })
}
