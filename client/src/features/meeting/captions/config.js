/**
 * Live-captions configuration — the single source of truth for the feature.
 *
 * Language is intentionally centralised here (not hard-coded in the engine or
 * UI) so adding more languages / auto-translation later is a config change, not
 * a refactor. V1 ships English only.
 */
export const CAPTION_CONFIG = {
  // BCP-47 tag handed to the browser SpeechRecognition engine (and any future
  // server-side STT). The only place "English" is encoded.
  lang: 'en-US',

  // LiveKit data-channel topic captions ride on. Keeps caption traffic isolated
  // from any other publishData usage.
  topic: 'captions',

  // Hide a speaker's caption this long after their last word (Google-Meet feel).
  silenceTimeoutMs: 3000,

  // Minimum gap between *interim* broadcasts. Interims fire many times per
  // second from the engine; this caps bandwidth/fan-out. Finals are never
  // throttled.
  interimThrottleMs: 250,

  // Hard cap on a single caption payload (matches the server's existing cap).
  maxChars: 300,

  // Concurrent speakers shown at once. Meet shows ~1–2; older ones fade as new
  // speakers appear.
  maxSpeakers: 2,

  // Persists the on/off choice for the session (and across meetings on this
  // device — a convenience, not required state).
  storageKey: 'zoiko.captions.enabled',
}
