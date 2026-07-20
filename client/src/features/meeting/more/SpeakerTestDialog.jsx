import { useCallback, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { Play, Square, Volume2 } from 'lucide-react'
import Modal from '../../../components/ui/Modal.jsx'
import { useDisposable } from './useDisposable.js'

/**
 * Speaker test (ZS-MTG-IMP-03 §9.2). Plays a bounded, synthesized non-speech
 * chime to the SELECTED output device and stops on Stop / close / 10s.
 *
 * Media-safe: no getUserMedia, no device enumeration, no tracks. Output routing
 * reads the room's already-active audiooutput (no enumeration) and the tone is
 * generated locally (Web Audio) — it never touches the microphone capture path,
 * so it cannot leak into the outgoing audio track.
 */

const DURATION_MS = 10000
const NOTES = [523.25, 659.25, 783.99] // C5 · E5 · G5 — pleasant, non-speech

export default function SpeakerTestDialog({ onClose }) {
  const room = useRoomContext()
  const audioRef = useRef(null)
  const engine = useRef({ ctx: null, osc: null, gain: null, dest: null, chime: null, end: null, tick: null })
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  // Deterministic teardown for every exit path (Stop, 10s timeout, close, repeated
  // cycles): clear timers/intervals, disconnect + stop every Web Audio node/stream,
  // close the context, and release the audio-element reference. Idempotent.
  const stop = useCallback(() => {
    const e = engine.current
    clearInterval(e.tick); clearTimeout(e.end); clearInterval(e.chime)
    try { e.osc?.stop() } catch { /* already stopped */ }
    try { e.osc?.disconnect() } catch { /* not connected */ }
    try { e.gain?.disconnect() } catch { /* not connected */ }
    try { e.dest?.stream?.getTracks?.().forEach((t) => t.stop()) } catch { /* no stream */ }
    try { e.ctx?.close() } catch { /* already closed */ }
    if (audioRef.current) audioRef.current.srcObject = null
    engine.current = { ctx: null, osc: null, gain: null, dest: null, chime: null, end: null, tick: null }
    setPlaying(false)
    setProgress(0)
  }, [])

  const start = useCallback(async () => {
    stop()
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const dest = ctx.createMediaStreamDestination()
    const gain = ctx.createGain(); gain.gain.value = 0.0001; gain.connect(dest)
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.connect(gain); osc.start()

    const el = audioRef.current
    if (el) {
      el.srcObject = dest.stream
      const outId = room?.getActiveDevice?.('audiooutput')
      if (outId && outId !== 'default' && el.setSinkId) {
        try { await el.setSinkId(outId) } catch { /* routing not controllable — default output */ }
      }
      try { await el.play() } catch { /* blocked — the tone still routes to dest */ }
    }

    let i = 0
    const chime = () => {
      const now = ctx.currentTime
      osc.frequency.setValueAtTime(NOTES[i % NOTES.length], now)
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.16, now + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55)
      i += 1
    }
    chime()

    const startedAt = performance.now()
    engine.current = {
      ctx, osc, gain, dest,
      chime: setInterval(chime, 800),
      tick: setInterval(() => setProgress(Math.min(1, (performance.now() - startedAt) / DURATION_MS)), 100),
      end: setTimeout(stop, DURATION_MS),
    }
    setPlaying(true)
  }, [room, stop])

  // Stop and release everything when the dialog closes (shared lifecycle contract).
  useDisposable(useCallback(() => stop, [stop]))

  return (
    <Modal open onClose={onClose} title="Speaker test" description="Play a test sound on your selected speaker." size="sm">
      {/* Hidden sink for the routed tone. */}
      <audio ref={audioRef} className="hidden" />
      <div className="flex flex-col items-center gap-4 py-2">
        <div className={'grid h-16 w-16 place-items-center rounded-full ' + (playing ? 'bg-[#10B981]/15 text-[#10B981]' : 'bg-[var(--c-bg-2)] text-[var(--c-fg-muted)]')}>
          <Volume2 className="h-7 w-7" />
        </div>
        {/* Visual playback indicator — never rely on hearing alone (§20). */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--c-bg-2)]" role="progressbar" aria-label="Test sound progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="h-full rounded-full bg-[#10B981] transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="text-center text-[13px] text-[var(--c-fg-muted)]" aria-live="polite">
          {playing ? 'Playing a test sound…' : 'You should hear a short chime on your speaker.'}
        </p>
        <button
          type="button"
          onClick={playing ? stop : start}
          className="inline-flex items-center gap-2 rounded-lg bg-[#10B981] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#059669]"
        >
          {playing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {playing ? 'Stop' : 'Play test sound'}
        </button>
      </div>
    </Modal>
  )
}
