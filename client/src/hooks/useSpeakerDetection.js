import { useCallback, useEffect, useRef } from 'react'

/**
 * Active speaker detection via AudioContext analyser.
 * Calls `onSpeaking(peerId, isSpeaking)` when a peer crosses the threshold.
 *
 * Usage:
 *   const { attachStream, detachStream } = useSpeakerDetection(onSpeaking)
 *   attachStream('self', localStream)       // local
 *   attachStream(peerId, remoteStream)      // remote
 */
export default function useSpeakerDetection(onSpeaking, threshold = 0.015) {
  const ctxRef = useRef(null)
  const trackedRef = useRef({}) // peerId -> { source, analyser, rafId, speaking }

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      ctxRef.current = ctx
      // Autoplay policy starts AudioContext in 'suspended' state when the
      // page hasn't received a user gesture (typical deep-link join). The
      // analyser silently reports zero level while suspended — speaker
      // detection breaks, "who's talking" indicator never lights up. Arm a
      // one-shot gesture listener to resume.
      if (ctx.state === 'suspended') {
        const resume = () => {
          ctx.resume().catch(() => {})
          window.removeEventListener('pointerdown', resume, true)
          window.removeEventListener('keydown', resume, true)
          window.removeEventListener('touchstart', resume, true)
        }
        window.addEventListener('pointerdown', resume, true)
        window.addEventListener('keydown', resume, true)
        window.addEventListener('touchstart', resume, true)
      }
    }
    return ctxRef.current
  }, [])

  const attachStream = useCallback(
    (peerId, stream) => {
      if (!stream) return
      // Detach previous if exists
      const prev = trackedRef.current[peerId]
      if (prev) {
        if (prev.intervalId) clearInterval(prev.intervalId)
        try { prev.source.disconnect() } catch {}
        delete trackedRef.current[peerId]
      }

      // createMediaStreamSource throws "MediaStream has no audio track" if
      // the stream only carries video (e.g. the user joined with mic off, or
      // the audio track was stopped/replaced). Skip silently — when an audio
      // track later appears, the caller re-attaches.
      const audioTrack = stream.getAudioTracks?.()[0]
      if (!audioTrack || audioTrack.readyState === 'ended') return

      const ctx = getCtx()
      let source
      try {
        source = ctx.createMediaStreamSource(stream)
      } catch {
        // Track was live at the check above but vanished before the Web Audio
        // node bound to it — race on mic recovery / device switch. Bail.
        return
      }
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.5
      source.connect(analyser)
      // Don't connect to destination — we don't want to hear ourselves doubled

      const dataArray = new Float32Array(analyser.fftSize)
      let speaking = false
      let silentTicks = 0

      // Throttled poll. rAF used to fire at display refresh (60–144 Hz)
      // per peer; with 6 peers on a 144 Hz screen that's ~864 RMS computes
      // per second across the call. 30 Hz is more than fast enough for
      // speaker detection (33 ms latency, imperceptible) and roughly 4–5x
      // cheaper. setInterval keeps running when the tab is hidden — that's
      // intentional here since we want the speaking indicator state to be
      // correct when the tab is restored without a fresh stream attach.
      function poll() {
        analyser.getFloatTimeDomainData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i]
        }
        const rms = Math.sqrt(sum / dataArray.length)
        const nowSpeaking = rms > threshold

        if (nowSpeaking) {
          silentTicks = 0
          if (!speaking) {
            speaking = true
            onSpeaking(peerId, true)
          }
        } else {
          silentTicks++
          // Debounce: ~10 ticks at 30 Hz ≈ 330 ms of silence before flipping.
          if (speaking && silentTicks > 10) {
            speaking = false
            onSpeaking(peerId, false)
          }
        }
      }

      const intervalId = setInterval(poll, 33)
      trackedRef.current[peerId] = { source, analyser, intervalId, speaking }
    },
    [getCtx, onSpeaking, threshold]
  )

  const detachStream = useCallback((peerId) => {
    const entry = trackedRef.current[peerId]
    if (entry) {
      if (entry.intervalId) clearInterval(entry.intervalId)
      try { entry.source.disconnect() } catch {}
      delete trackedRef.current[peerId]
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const peerId of Object.keys(trackedRef.current)) {
        const entry = trackedRef.current[peerId]
        if (entry.intervalId) clearInterval(entry.intervalId)
        try { entry.source.disconnect() } catch {}
      }
      trackedRef.current = {}
      if (ctxRef.current) {
        try { ctxRef.current.close() } catch {}
        ctxRef.current = null
      }
    }
  }, [])

  return { attachStream, detachStream }
}
