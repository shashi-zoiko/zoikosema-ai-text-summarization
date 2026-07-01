/**
 * NotificationSoundManager — soft, enterprise-grade notification tones.
 *
 * IMPORTANT — playback path: tones are synthesised to raw PCM in plain JS, encoded
 * as a WAV data-URI, and played through an HTMLAudioElement (`new Audio(url)`).
 * We deliberately do NOT use the realtime Web Audio API (AudioContext →
 * destination). On Windows, while a WebRTC call holds the microphone, Chrome
 * routes AudioContext output to the system "Default Communications Device", which
 * is frequently a different / muted / disconnected output than the speakers the
 * user actually hears — so realtime Web Audio went silent in-call even though
 * media elements (e.g. YouTube, the LiveKit <audio> tags) played fine. HTMLAudio
 * uses that same reliable media path, so notification sounds are now audible
 * regardless of the user's communications-device setting.
 *
 * Each notification "voice" is a short sequence of sine/triangle blips with a
 * gentle attack/decay envelope, so nothing is harsh or alarming. Voices are
 * tuned to be *distinct* from one another (Meet-style): chat is the softest,
 * the lobby request is the most attention-grabbing.
 *
 * Preferences (mute + master volume) persist in localStorage and are shared by
 * every meeting tab. Per-kind throttling prevents a burst of events (e.g. a
 * flurry of chat messages) from machine-gunning the speakers.
 */

const MUTE_KEY = 'zoiko_meet_notif_muted'
const VOL_KEY = 'zoiko_meet_notif_volume'

const SAMPLE_RATE = 44100
const HEADROOM = 0.6 // global ceiling so summed notes never clip

// note → frequency (Hz), a small palette of pleasant intervals.
const N = {
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99,
  A5: 880.0, B5: 987.77, C6: 1046.5, E6: 1318.5, G4: 392.0, A4: 440.0,
}

/**
 * Voice = ordered notes. Each note: { f, t, d, type, gain }
 *   f    frequency (Hz)
 *   t    start offset from trigger (s)
 *   d    duration (s)
 *   type oscillator type (sine | triangle)
 *   gain peak gain for this note (0..1), relative — master volume is applied at
 *        playback time via the <audio> element, not baked into the buffer.
 */
const VOICES = {
  // Softest — two quick rising notes, very short. Plays most often.
  chat: [
    { f: N.E5, t: 0, d: 0.12, type: 'sine', gain: 0.5 },
    { f: N.A5, t: 0.09, d: 0.16, type: 'sine', gain: 0.5 },
  ],
  // Most prominent — a clear three-note ascending motif, louder + brighter.
  // This is the "someone is waiting" cue, intentionally hard to miss.
  lobby: [
    { f: N.C5, t: 0, d: 0.14, type: 'triangle', gain: 0.85 },
    { f: N.E5, t: 0.13, d: 0.14, type: 'triangle', gain: 0.85 },
    { f: N.G5, t: 0.26, d: 0.26, type: 'triangle', gain: 0.95 },
  ],
  // Gentle upward blip — someone arrived.
  join: [
    { f: N.G5, t: 0, d: 0.1, type: 'sine', gain: 0.45 },
    { f: N.C6, t: 0.08, d: 0.16, type: 'sine', gain: 0.45 },
  ],
  // Gentle downward blip — someone left.
  leave: [
    { f: N.C6, t: 0, d: 0.1, type: 'sine', gain: 0.4 },
    { f: N.G5, t: 0.08, d: 0.16, type: 'sine', gain: 0.4 },
  ],
  // Call ended — a soft, warm three-note descending hang-up tone (Google-Meet
  // style). Plays for YOU when you leave the call or when the meeting is ended
  // for everyone. Slower + rounder than the "someone left" blip so it reads as
  // a deliberate goodbye rather than a passing roster change.
  'call-end': [
    { f: N.G5, t: 0, d: 0.16, type: 'sine', gain: 0.55 },
    { f: N.E5, t: 0.14, d: 0.18, type: 'sine', gain: 0.55 },
    { f: N.C5, t: 0.3, d: 0.34, type: 'sine', gain: 0.6 },
  ],
  // Light double tap — a hand went up.
  hand: [
    { f: N.A5, t: 0, d: 0.09, type: 'triangle', gain: 0.55 },
    { f: N.A5, t: 0.14, d: 0.12, type: 'triangle', gain: 0.55 },
  ],
  // Neutral two-tone — presentation started/stopped.
  screenshare: [
    { f: N.D5, t: 0, d: 0.12, type: 'sine', gain: 0.5 },
    { f: N.A5, t: 0.1, d: 0.18, type: 'sine', gain: 0.5 },
  ],
  // Recording — a calm low→high pair.
  recording: [
    { f: N.G4, t: 0, d: 0.14, type: 'sine', gain: 0.5 },
    { f: N.C6, t: 0.13, d: 0.2, type: 'sine', gain: 0.5 },
  ],
  // Host transfer — a small confirming flourish.
  'host-transfer': [
    { f: N.E5, t: 0, d: 0.1, type: 'triangle', gain: 0.6 },
    { f: N.G5, t: 0.09, d: 0.1, type: 'triangle', gain: 0.6 },
    { f: N.C6, t: 0.18, d: 0.2, type: 'triangle', gain: 0.6 },
  ],
  // Generic fallback.
  notification: [
    { f: N.E5, t: 0, d: 0.12, type: 'sine', gain: 0.5 },
    { f: N.G5, t: 0.1, d: 0.18, type: 'sine', gain: 0.5 },
  ],
}

// Minimum gap between two plays of the SAME voice (ms). Chat is the chattiest,
// so it gets the firmest throttle, per the spec (max once / 2 s).
const THROTTLE = {
  chat: 2000,
  join: 1200,
  leave: 1200,
  'call-end': 0,
  hand: 800,
  screenshare: 1000,
  recording: 0,
  lobby: 600,
  'host-transfer': 0,
  notification: 600,
}

/* ── Synthesis: voice → WAV data-URI (pure JS, no Web Audio) ─────────────────── */

function oscillator(type, phase) {
  // phase in radians. sine is exact; triangle is a smooth band-limited-ish shape
  // via asin(sin) — soft, no harsh edges.
  if (type === 'triangle') return (2 / Math.PI) * Math.asin(Math.sin(phase))
  return Math.sin(phase)
}

// Quick linear attack, smooth exponential release — no clicks, no harshness.
function envelope(localT, dur) {
  if (localT < 0) return 0
  const attack = 0.012
  if (localT < attack) return localT / attack
  const decayDur = Math.max(dur - attack, 0.01)
  return Math.exp((-3.5 * (localT - attack)) / decayDur)
}

function synthVoice(voice) {
  const end = voice.reduce((m, n) => Math.max(m, n.t + n.d), 0) + 0.06 // release tail
  const frames = Math.ceil(end * SAMPLE_RATE)
  const out = new Float32Array(frames)
  for (const note of voice) {
    const startFrame = Math.floor(note.t * SAMPLE_RATE)
    const endFrame = Math.min(frames, Math.ceil((note.t + note.d + 0.04) * SAMPLE_RATE))
    const w = 2 * Math.PI * note.f
    for (let i = startFrame; i < endFrame; i++) {
      const localT = (i - startFrame) / SAMPLE_RATE
      const amp = HEADROOM * note.gain * envelope(localT, note.d)
      out[i] += amp * oscillator(note.type || 'sine', w * localT)
    }
  }
  // Hard-clip just in case overlapping notes sum past unity.
  for (let i = 0; i < frames; i++) out[i] = Math.max(-1, Math.min(1, out[i]))
  return out
}

function wavDataUri(samples) {
  const frames = samples.length
  const buffer = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(buffer)
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)        // PCM chunk size
  view.setUint16(20, 1, true)         // format = PCM
  view.setUint16(22, 1, true)         // channels = mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true) // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true)         // block align
  view.setUint16(34, 16, true)        // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, frames * 2, true)
  let off = 44
  for (let i = 0; i < frames; i++) {
    const s = samples[i]
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return 'data:audio/wav;base64,' + base64FromBuffer(buffer)
}

function base64FromBuffer(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000 // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

class SoundManager {
  constructor() {
    this._lastPlayed = Object.create(null) // kind → epoch ms
    this._urls = Object.create(null)       // kind → WAV data-URI (lazily built, cached)
    this._live = new Set()                 // in-flight <audio> elements (GC guard)
    this._muted = readBool(MUTE_KEY, false)
    this._volume = readNumber(VOL_KEY, 0.6) // master 0..1
  }

  get muted() { return this._muted }
  get volume() { return this._volume }

  setMuted(v) {
    this._muted = !!v
    try { localStorage.setItem(MUTE_KEY, this._muted ? '1' : '0') } catch { /* private mode */ }
  }

  setVolume(v) {
    this._volume = clamp01(v)
    try { localStorage.setItem(VOL_KEY, String(this._volume)) } catch { /* private mode */ }
  }

  /**
   * Browsers gate audio until the user has interacted with the page. Calling
   * this from the first gesture primes a silent element so later, event-driven
   * plays are allowed. Cheap and idempotent.
   */
  unlock() {
    if (this._unlocked) return
    this._unlocked = true
    try {
      const a = new Audio(this._urlFor('notification'))
      a.volume = 0
      a.play().then(() => a.pause()).catch(() => {})
    } catch { /* no Audio support — nothing to do */ }
  }

  _urlFor(kind) {
    if (this._urls[kind]) return this._urls[kind]
    const voice = VOICES[kind] || VOICES.notification
    return (this._urls[kind] = wavDataUri(synthVoice(voice)))
  }

  /**
   * Play a notification voice.
   * @param {string} kind  one of VOICES keys
   * @param {object} [opts] { force } — bypass throttle + mute/volume (previews)
   */
  play(kind, opts = {}) {
    if (this._muted && !opts.force) return
    if (this._volume <= 0 && !opts.force) return

    if (!opts.force) {
      const gap = THROTTLE[kind] ?? 600
      const now = Date.now()
      if (gap > 0 && this._lastPlayed[kind] && now - this._lastPlayed[kind] < gap) return
      this._lastPlayed[kind] = now
    }

    let url
    try { url = this._urlFor(kind) } catch { return }
    if (!url) return

    try {
      const a = new Audio(url)
      // Previews force full volume so they're clearly audible even while muted.
      a.volume = clamp01(opts.force ? Math.max(this._volume, 0.6) : this._volume)
      this._live.add(a)
      const done = () => this._live.delete(a)
      a.addEventListener('ended', done, { once: true })
      a.addEventListener('error', done, { once: true })
      a.play().catch(done)
    } catch { /* element construction/playback failed — stay silent */ }
  }
}

function clamp01(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
function readBool(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1' } catch { return fallback }
}
function readNumber(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : clamp01(parseFloat(v)) } catch { return fallback }
}

// One shared instance across the app (preferences + throttle are global).
export const soundManager = new SoundManager()
export const SOUND_KINDS = Object.keys(VOICES)
