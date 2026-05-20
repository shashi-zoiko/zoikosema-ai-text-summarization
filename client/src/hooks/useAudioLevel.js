import { useEffect, useRef, useState } from 'react'

/**
 * Subscribe to a MediaStream's audio track and return a 0..1 normalized
 * RMS level. Used to render the live mic-level meter in the lobby.
 *
 * The level updates on requestAnimationFrame and is throttled in state
 * so React only re-renders ~30fps worth of changes.
 */
export default function useAudioLevel(stream, enabled = true) {
  const [level, setLevel] = useState(0)
  const ctxRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const rafRef = useRef(null)
  const lastUpdateRef = useRef(0)

  useEffect(() => {
    if (!enabled || !stream) {
      setLevel(0)
      return
    }
    const audioTrack = stream.getAudioTracks?.()[0]
    if (!audioTrack) return

    let killed = false
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    ctxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    sourceRef.current = source
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.65
    analyserRef.current = analyser
    source.connect(analyser)

    const buf = new Uint8Array(analyser.fftSize)

    const tick = (t) => {
      if (killed) return
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / buf.length)
      // Light non-linear boost so quiet voice still reads on the meter
      const norm = Math.min(1, Math.pow(rms * 2.4, 0.7))
      if (t - lastUpdateRef.current > 33) {
        setLevel(norm)
        lastUpdateRef.current = t
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      killed = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      try { source.disconnect() } catch {}
      try { ctx.close() } catch {}
      ctxRef.current = null
      analyserRef.current = null
      sourceRef.current = null
      setLevel(0)
    }
  }, [stream, enabled])

  return level
}
