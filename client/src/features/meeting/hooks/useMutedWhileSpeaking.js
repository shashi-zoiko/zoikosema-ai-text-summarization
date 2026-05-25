import { useEffect, useState } from 'react'
import { useLocalParticipant } from '@livekit/components-react'

/**
 * Detect when the local user is talking while muted and surface a transient
 * "You're muted" toast. Approach: sample mic input via Web Audio while the
 * mic track exists, even when published-track is muted. We re-acquire the
 * stream only when mic is OFF — because when mic is ON, LiveKit owns the
 * track and the speaking-state hook already shows the user as active.
 */
export default function useMutedWhileSpeaking() {
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant()
  const [shouldShowToast, setShouldShowToast] = useState(false)

  useEffect(() => {
    if (!localParticipant) return
    if (isMicrophoneEnabled) {
      setShouldShowToast(false)
      return
    }

    let cancelled = false
    let stream = null
    let ctx = null
    let raf = 0
    let aboveSince = null
    let toastTimer = null

    const stop = () => {
      cancelled = true
      if (raf) cancelAnimationFrame(raf)
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
      if (ctx) { ctx.close().catch(() => {}) ; ctx = null }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop())
        stream = null
      }
    }

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        if (cancelled) { stop(); return }
        ctx = new (window.AudioContext || window.webkitAudioContext)()
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        src.connect(analyser)
        const buf = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          if (cancelled) return
          analyser.getByteFrequencyData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i]
          const avg = sum / buf.length
          // 14 picks up voice without being triggered by AC hum / keyboard.
          // Tune empirically; Google Meet uses ~12-15 on a similar setup.
          if (avg > 14) {
            if (!aboveSince) aboveSince = performance.now()
            else if (performance.now() - aboveSince > 600 && !toastTimer) {
              setShouldShowToast(true)
              toastTimer = setTimeout(() => {
                setShouldShowToast(false)
                toastTimer = null
              }, 2500)
            }
          } else {
            aboveSince = null
          }
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch (e) {
        // No mic / permission denied — just skip the feature, don't error.
      }
    })()

    return stop
  }, [localParticipant, isMicrophoneEnabled])

  return shouldShowToast
}
