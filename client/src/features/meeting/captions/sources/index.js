import { CAPTION_CONFIG } from '../config'
import useWebSpeechSource, { supported as webSpeechSupported } from './webSpeechSource'

/**
 * CaptionSource selection.
 *
 * A source is a hook that drives LOCAL caption capture and calls
 * `onResult({ text, isFinal, confidence, seq, utteranceId })`. Everything
 * downstream (transport, buffer, renderer) is source-agnostic, so switching
 * engines is a change confined to this folder.
 *
 *  - 'web-speech' — on-device browser STT. E2EE-safe, $0, works on
 *    Chrome/Edge/Safari. The default and only engine wired today.
 *  - 'agent' — future server-side per-track STT (LiveKit Agent + streaming STT
 *    vendor). Definitive identity/overlap and all-browser support, but requires
 *    DECRYPTED audio (incompatible with the current all-meetings-E2EE guarantee)
 *    and per-minute cost + infra. Reserved here so it can be enabled per-meeting
 *    later without touching the buffer/UI layers. Not implemented.
 *
 * @returns {{ useSource: Function, supported: boolean, kind: string }}
 */
export function getCaptionSource(kind = CAPTION_CONFIG.source) {
  switch (kind) {
    case 'web-speech':
      return { useSource: useWebSpeechSource, supported: webSpeechSupported, kind }
    case 'agent':
      // Intentionally not wired — the seam exists so a server engine is a
      // drop-in here, but enabling it is a deliberate infra + E2EE decision.
      return { useSource: () => {}, supported: false, kind }
    default:
      return { useSource: useWebSpeechSource, supported: webSpeechSupported, kind: 'web-speech' }
  }
}
