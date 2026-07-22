import { useCallback, useEffect, useState } from 'react'

/**
 * Enumerate available audio-input / video-input / audio-output devices and
 * provide selection state. Returns
 * { devices:{audio,video,speaker}, audioDeviceId, videoDeviceId, speakerDeviceId,
 *   setAudioDeviceId, setVideoDeviceId, setSpeakerDeviceId, refresh }.
 *
 * Speaker (audiooutput) enumeration is additive — older callers that only read
 * audio/video keep working unchanged. Output-device labels/ids are only exposed
 * by browsers that support HTMLMediaElement.setSinkId; elsewhere the list is
 * simply empty and callers fall back to the system default.
 */
export default function useMediaDevices() {
  const [devices, setDevices] = useState({ audio: [], video: [], speaker: [] })
  const [audioDeviceId, setAudioDeviceId] = useState('')
  const [videoDeviceId, setVideoDeviceId] = useState('')
  const [speakerDeviceId, setSpeakerDeviceId] = useState('')

  const enumerate = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const audio = all.filter((d) => d.kind === 'audioinput' && d.deviceId)
      const video = all.filter((d) => d.kind === 'videoinput' && d.deviceId)
      const speaker = all.filter((d) => d.kind === 'audiooutput' && d.deviceId)
      const next = { audio, video, speaker }
      setDevices(next)
      return next
    } catch {
      return { audio: [], video: [], speaker: [] }
    }
  }, [])

  const refresh = useCallback(() => enumerate(), [enumerate])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const next = await enumerate()
      if (cancelled) return
      setDevices(next)
    }
    run()
    navigator.mediaDevices?.addEventListener('devicechange', run)
    return () => {
      cancelled = true
      navigator.mediaDevices?.removeEventListener('devicechange', run)
    }
  }, [enumerate])

  return {
    devices,
    audioDeviceId,
    setAudioDeviceId,
    videoDeviceId,
    setVideoDeviceId,
    speakerDeviceId,
    setSpeakerDeviceId,
    refresh,
  }
}
