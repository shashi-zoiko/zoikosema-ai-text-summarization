/**
 * Live-captions configuration — the single source of truth for the feature.
 *
 * Language is intentionally centralised here (not hard-coded in the engine or
 * UI) so adding more languages / auto-translation later is a config change, not
 * a refactor. V1 ships English only.
 */
export const CAPTION_CONFIG = {
  // Which capture engine backs the pipeline. 'web-speech' = on-device browser
  // STT (E2EE-safe, $0, default). 'agent' = future server-side per-track STT
  // (breaks E2EE, needs infra) — stubbed behind the CaptionSource interface and
  // NOT enabled. Everything downstream of the source is engine-agnostic.
  source: 'web-speech',

  // BCP-47 tag handed to the browser SpeechRecognition engine (and any future
  // server-side STT). The only place "English" is encoded.
  lang: 'en-US',

  // LiveKit data-channel topics. Captions and the lightweight "who wants
  // captions" presence beacon ride separate topics so they never interleave.
  topic: 'captions',
  presenceTopic: 'captions-presence',

  // Hide a speaker's caption this long after their last word (Google-Meet feel).
  silenceTimeoutMs: 3000,

  // Minimum gap between *interim* broadcasts. Interims fire many times per
  // second from the engine; this caps bandwidth/fan-out. Finals are never
  // throttled. Local echo (your own caption bubble) ignores this entirely —
  // it only governs what remote participants receive over the data channel.
  interimThrottleMs: 70,

  // Hard cap applied to every caption fragment AND to a full merged transcript
  // line (many consecutive fragments stitched together — see CaptionProvider's
  // fragment-merge logic). One shared cap, generous enough that neither a
  // single long continuous utterance nor a multi-fragment merged sentence gets
  // silently truncated before it reaches the captured transcript.
  maxLineChars: 8000,

  // Concurrent speakers shown at once. Meet shows ~1–3; older ones fade as new
  // speakers appear. Each speaker keeps an INDEPENDENT stream — raising this
  // never merges conversations, it just shows more of them.
  maxSpeakers: 4,

  // Speaking gate: only capture/broadcast the local mic while LiveKit reports
  // the local participant as actually speaking, plus this hangover after they
  // stop. Ties captions to real audio activity (same source of truth as the
  // active-speaker hero) and suppresses most echo/bleed misattribution.
  speakingGateEnabled: true,
  speakingHangoverMs: 1200,

  // LiveKit's active-speaker signal is computed server-side from the encoded
  // RTP audio (mic → SFU → analysis → signal push back to us), so it always
  // trails the real audio by at least one network round trip — visible as
  // captions starting noticeably after the first word, especially with only
  // one person talking. To fix that, the gate ALSO opens the instant OUR OWN
  // mic's local audio level crosses this threshold, measured client-side via
  // Web Audio API (useTrackVolume) — zero network hop, ~33ms sampling. Same
  // audio, same "is it really my mic" guarantee, just measured before instead
  // of after the round trip. Whichever signal (local or LiveKit's) says
  // "speaking" first opens the gate; closing still waits speakingHangoverMs
  // either way, so end-of-utterance behaviour is unchanged.
  localVadEnabled: true,
  localVadVolumeThreshold: 0.06,
  localVadFftSize: 256,
  // AnalyserNode's own exponential smoothing (0 = react instantly to the
  // current audio frame, 1 = never change) — lower this to shave the last
  // bit of onset lag off gate-opening. Traded against a slightly higher
  // chance a brief noise spike (not real speech) also crosses the volume
  // threshold; 0.05 keeps that risk low while still being far snappier than
  // the previous 0.15.
  localVadSmoothing: 0.05,

  // Out-of-order guard. A caption frame whose sequence number is older than the
  // newest seen for that speaker by more than this window is dropped as a stale
  // straggler (async-decrypt races, lossy-interim reordering).
  seqWindow: 64,

  // Per-participant CPU guard. When true, participants on phones/tablets still
  // capture their own mic while captions are wanted in the room (so a CC viewer
  // sees them). When false, mobile devices only RENDER captions and never run
  // the recogniser — saves battery/CPU on constrained devices and dodges iOS
  // Safari's flaky Web Speech engine. Desktop is unaffected either way.
  mobileCaptureEnabled: false,

  // Renderer typography scale (accessibility). 1 = default; the overlay reads
  // this so a future "caption size" setting is a one-line change.
  fontScale: 1,

  // Persists the on/off choice for the session (and across meetings on this
  // device — a convenience, not required state).
  storageKey: 'zoiko.captions.enabled',

  // Emit structured pipeline logs to the console when true. Flipped on only in
  // development (see debugLog); production builds are silent.
  debug: false,
}
