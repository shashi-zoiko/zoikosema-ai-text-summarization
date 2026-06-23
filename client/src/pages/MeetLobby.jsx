import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Calendar, Camera, CameraOff, Check, ChevronDown, Clock, Copy, Info, Link as LinkIcon,
  Loader2, Lock, Mic, MicOff, Monitor, ShieldCheck, Video, VideoOff, X,
} from 'lucide-react'
import { api, getWsBase } from '../api/client'
import { useAuth } from '../context/AuthContext'
import useMediaDevices from '../hooks/useMediaDevices'
import useAudioLevel from '../hooks/useAudioLevel'
import LobbyLeaves from '../components/LobbyLeaves'
import Logo from '../components/ui/Logo'

/**
 * Meeting pre-join lobby — Google Meet–style.
 *
 * CRITICAL: the <video> element is ALWAYS mounted so `videoRef.current` is
 * stable. Stream attachment happens in a useEffect keyed on `stream`. The
 * previous "set srcObject inside acquire() before setState" pattern was the
 * root cause of the black-preview bug — the conditional render meant the
 * video element didn't exist yet at the moment of assignment, the ref was
 * null, and the stream was never re-attached after the render mounted it.
 */

const PERM = {
  pending: 'pending',
  granted: 'granted',
  denied: 'denied',
  unavailable: 'unavailable',
}

// Strangler-fig switch — three layers, first match wins:
//   1. Per-meeting flag set on the row (meeting.media_provider === 'livekit')
//   2. URL flag ?lk=1   (override for one-off testing of an old meeting)
//   3. Global env flag VITE_USE_LIVEKIT=1
function pickRoomPath(code, meeting) {
  const fromMeeting = meeting?.media_provider === 'livekit'
  const urlFlag = new URLSearchParams(window.location.search).get('lk') === '1'
  const envFlag = import.meta.env.VITE_USE_LIVEKIT === '1'
  return fromMeeting || urlFlag || envFlag
    ? `/meet/${code}/room-lk`
    : `/meet/${code}/room`
}

// Restore the participant's last mic/cam choice for this meeting so a refresh
// — or a bounce back from the room — doesn't silently reset their setup.
function readJoinPrefs(code) {
  try {
    const p = JSON.parse(sessionStorage.getItem(`zoiko_meet_prefs_${code}`))
    return { audio: p?.audio ?? true, video: p?.video ?? true }
  } catch {
    return { audio: true, video: true }
  }
}

function timeGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function MeetLobby() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const wsRef = useRef(null)

  const [meeting, setMeeting] = useState(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [meetingPwd, setMeetingPwd] = useState('')
  const [err, setErr] = useState('')

  const [audioOn, setAudioOn] = useState(() => readJoinPrefs(code).audio)
  const [videoOn, setVideoOn] = useState(() => readJoinPrefs(code).video)
  const audioOnRef = useRef(audioOn)
  const videoOnRef = useRef(videoOn)
  const [permState, setPermState] = useState(PERM.pending)
  const [permDetail, setPermDetail] = useState('')

  const [stream, setStream] = useState(null)

  const { devices, audioDeviceId, setAudioDeviceId, videoDeviceId, setVideoDeviceId, refresh: refreshDevices } = useMediaDevices()

  const [waitingStatus, setWaitingStatus] = useState(null)
  const [copied, setCopied] = useState(false)
  const [joining, setJoining] = useState(false)

  const audioLevel = useAudioLevel(stream, audioOn && permState === PERM.granted)

  // ── Meeting metadata ────────────────────────────────────────────────
  useEffect(() => {
    api(`/api/meetings/${code}`)
      .then((m) => {
        setMeeting(m)
        if (m.password_protected && m.host_id !== user?.id) setNeedsPassword(true)
      })
      .catch((e) => setErr(e.message || 'Meeting not found'))
  }, [code, user?.id])

  // ── Camera lifecycle ───────────────────────────────────────────────
  // Cancellation-aware. Each acquire run cancels its predecessor so a
  // StrictMode double-mount (or a fast device switch) can't leave two live
  // streams holding the camera. Whichever run finishes last "wins" — the
  // others stop the stream they just acquired and bail before commit.
  const acquireSeqRef = useRef(0)

  const videoConstraints = useCallback(() => ({
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
    ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}),
  }), [videoDeviceId])

  const applyMediaError = useCallback((e) => {
    const name = e?.name || ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      setPermState(PERM.denied)
      setPermDetail('Camera and microphone are blocked. Click the lock icon in your browser address bar to allow them, then click Retry.')
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      setPermState(PERM.unavailable)
      setPermDetail('No camera or microphone detected. Connect one and click Retry.')
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      setPermState(PERM.unavailable)
      setPermDetail('Your camera is in use by another application. Close it (Zoom, Teams, etc.) and click Retry.')
    } else if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      setPermState(PERM.unavailable)
      setPermDetail('The selected camera does not support 720p. Pick a different camera below and click Retry.')
    } else {
      setPermState(PERM.denied)
      setPermDetail(e?.message || 'Could not access camera or microphone.')
    }
  }, [])

  const acquire = useCallback(async () => {
    const seq = ++acquireSeqRef.current
    setPermState((s) => (s === PERM.granted ? s : PERM.pending))

    // Stop any prior stream BEFORE asking for a new one. Some browsers
    // reject getUserMedia with NotReadableError if the same camera is
    // already open in this tab.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { try { t.stop() } catch {} })
      streamRef.current = null
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      if (seq !== acquireSeqRef.current) return
      setPermState(PERM.unavailable)
      setPermDetail('Your browser does not support camera access. Try Chrome, Edge, or Firefox.')
      return
    }

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
      },
      video: videoOnRef.current ? videoConstraints() : false,
    }

    try {
      const next = await navigator.mediaDevices.getUserMedia(constraints)

      // A newer acquire superseded this one while getUserMedia was
      // pending — discard this stream so we don't double-occupy the cam.
      if (seq !== acquireSeqRef.current) {
        next.getTracks().forEach((t) => { try { t.stop() } catch {} })
        return
      }

      streamRef.current = next
      // Apply current toggle state to fresh tracks.
      next.getAudioTracks().forEach((t) => (t.enabled = audioOnRef.current))
      next.getVideoTracks().forEach((t) => (t.enabled = true))
      setStream(next)
      setPermState(PERM.granted)
      setPermDetail('')
      // Labels only become available after the first grant.
      refreshDevices()
    } catch (e) {
      if (seq !== acquireSeqRef.current) return
      applyMediaError(e)
      setStream(null)
    }
  }, [audioDeviceId, applyMediaError, refreshDevices, videoConstraints])

  const acquireVideoOnly = useCallback(async () => {
    const seq = ++acquireSeqRef.current
    setPermState(PERM.pending)

    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() })
      if (seq !== acquireSeqRef.current || !videoOnRef.current) {
        cameraStream.getTracks().forEach((t) => { try { t.stop() } catch {} })
        return
      }

      const current = streamRef.current || new MediaStream()
      current.getVideoTracks().forEach((track) => {
        try { current.removeTrack(track) } catch {}
        try { track.stop() } catch {}
      })
      cameraStream.getVideoTracks().forEach((track) => {
        track.enabled = true
        current.addTrack(track)
      })
      streamRef.current = current
      setStream(new MediaStream(current.getTracks()))
      setPermState(PERM.granted)
      setPermDetail('')
      refreshDevices()
    } catch (e) {
      if (seq !== acquireSeqRef.current) return
      videoOnRef.current = false
      setVideoOn(false)
      applyMediaError(e)
    }
  }, [applyMediaError, refreshDevices, videoConstraints])

  // Acquire on mount, re-acquire when device selection changes.
  useEffect(() => {
    acquire()
    return () => {
      // Mark all in-flight acquires as stale. Writing to the ref here is
      // intentional — eslint flags this because reads of the same ref in
      // cleanup are commonly stale, but we're only writing.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      acquireSeqRef.current++
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => { try { t.stop() } catch {} })
        streamRef.current = null
      }
      setStream(null)
    }
  }, [acquire])

  // ── Stream → <video> attachment ─────────────────────────────────────
  // This is the load-bearing effect: keeps the <video>'s srcObject in sync
  // with whatever stream is currently active. Null first so Chromium tears
  // down the previous decoder before binding the new one (avoids a 1-frame
  // ghost of the previous stream on device switch).
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (el.srcObject !== stream) {
      try { el.srcObject = null } catch {}
      try { el.srcObject = stream } catch {}
    }
  }, [stream])

  // Keep the mic track live when muted, but fully stop camera tracks when
  // video is off so the hardware indicator turns off like Google Meet.
  const toggleAudio = () => {
    const next = !audioOn
    audioOnRef.current = next
    setAudioOn(next)
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next))
  }
  const toggleVideo = () => {
    const next = !videoOn
    videoOnRef.current = next
    setVideoOn(next)
    if (next) {
      acquireVideoOnly()
      return
    }

    acquireSeqRef.current++
    const current = streamRef.current
    if (!current) return
    current.getVideoTracks().forEach((track) => {
      try { current.removeTrack(track) } catch {}
      try { track.stop() } catch {}
    })
    const audioOnly = new MediaStream(current.getAudioTracks())
    streamRef.current = audioOnly
    setStream(audioOnly)
  }

  // Keyboard shortcuts (Google-Meet parity): ⌘/Ctrl+D mic, ⌘/Ctrl+E camera.
  // Only active once devices are granted so the keys can't fire into a dead
  // toggle. Effect re-binds on toggle-state change to capture fresh closures.
  useEffect(() => {
    if (permState !== PERM.granted) return undefined
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'd') { e.preventDefault(); toggleAudio() }
      else if (k === 'e') { e.preventDefault(); toggleVideo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permState, audioOn, videoOn])

  // Close keepalive ws on unmount.
  useEffect(() => () => {
    if (wsRef.current) { try { wsRef.current.close() } catch {}; wsRef.current = null }
  }, [])

  // Release the lobby preview camera before navigating to the room. Without
  // this, the LK room's getUserMedia call races the React unmount cleanup
  // and the camera comes back NotReadableError on the first try.
  const releasePreview = () => {
    acquireSeqRef.current++
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => { try { t.stop() } catch {} })
      streamRef.current = null
    }
    setStream(null)
  }

  // ── Join meeting ───────────────────────────────────────────────────
  const join = async () => {
    setErr('')
    setJoining(true)
    try {
      const joinBody = { code }
      if (needsPassword) joinBody.password = meetingPwd
      const participant = await api(`/api/meetings/${code}/join`, { method: 'POST', body: joinBody })
      sessionStorage.setItem(
        `zoiko_meet_prefs_${code}`,
        JSON.stringify({ audio: audioOn, video: videoOn }),
      )
      if (needsPassword && meetingPwd) {
        sessionStorage.setItem(`zoiko_meet_pwd_${code}`, meetingPwd)
      }
      if (participant.status === 'pending') {
        setWaitingStatus('pending')
        const token = localStorage.getItem('zoiko_token')
        let wsUrl = `${getWsBase()}/ws/meetings/${code}?token=${encodeURIComponent(token)}`
        if (needsPassword && meetingPwd) wsUrl += `&pwd=${encodeURIComponent(meetingPwd)}`
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws
        ws.onmessage = (e) => {
          let data
          try { data = JSON.parse(e.data) } catch { return }
          if (data.type === 'admitted' || data.type === 'welcome') {
            setWaitingStatus('admitted')
            try { ws.close() } catch {}
            wsRef.current = null
            releasePreview()
            navigate(pickRoomPath(code, meeting))
          } else if (data.type === 'denied') {
            setWaitingStatus('denied')
            setErr('The host denied your request to join.')
            try { ws.close() } catch {}
            wsRef.current = null
          }
        }
        const keepalive = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
          else clearInterval(keepalive)
        }, 3000)
      } else {
        navigate(pickRoomPath(code, meeting))
      }
    } catch (e) {
      setErr(e.message || 'Could not join meeting')
      setJoining(false)
    }
  }

  const cancelWaiting = () => {
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: 'leave' })); wsRef.current.close() } catch {}
      wsRef.current = null
    }
    setWaitingStatus(null)
    setJoining(false)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meet/${code}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  const initial = (user?.name || '?').trim().charAt(0).toUpperCase() || '?'
  const firstName = (user?.name || '').trim().split(/\s+/)[0]
  const showVideo = permState === PERM.granted && videoOn
  const joinDisabled = !meeting || (needsPassword && !meetingPwd) || permState === PERM.pending || joining

  // ─────────────────────────────────────────────────────────────────
  // Meeting-unavailable view — metadata fetch failed before anything loaded
  // (bad/expired code, network). A dedicated screen beats a half-rendered
  // lobby with an inline error.
  // ─────────────────────────────────────────────────────────────────
  if (err && !meeting) {
    return (
      <Shell>
        <div className="zk-dock-enter w-full max-w-md rounded-[24px] border border-[#E4ECE7] bg-white/90 p-8 text-center shadow-[0_10px_40px_rgba(15,138,95,0.08)] backdrop-blur-xl">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-500 ring-1 ring-red-100">
            <X className="h-7 w-7" />
          </div>
          <h2 style={{ color: '#0F172A' }} className="mt-5 text-xl font-semibold">Meeting unavailable</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[#64748B]">{err}</p>
          <button
            onClick={() => navigate('/')}
            className="zk-press mt-6 inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0F8A5F] to-[#16A34A] px-6 text-[14px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(15,138,95,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F8A5F]/45 focus-visible:ring-offset-2"
          >Back to home</button>
        </div>
      </Shell>
    )
  }

  // ─────────────────────────────────────────────────────────────────
  // Waiting-room view
  // ─────────────────────────────────────────────────────────────────
  if (waitingStatus === 'pending') {
    return (
      <Shell>
        <div className="zk-dock-enter w-full max-w-md rounded-[24px] border border-[#E4ECE7] bg-white/90 p-8 text-center shadow-[0_10px_40px_rgba(15,138,95,0.08)] backdrop-blur-xl">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#0F8A5F] to-[#16A34A] text-white shadow-[0_10px_24px_-8px_rgba(15,138,95,0.6)]">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
          <h2 style={{ color: '#0F172A' }} className="mt-5 text-xl font-semibold">Asking to be let in</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[#64748B]">
            You'll join automatically once the host lets you in. This usually takes a few seconds.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#E4ECE7] bg-[#EAF8F2] px-3 py-1.5 text-[12px]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#0F8A5F]" />
            <span className="text-[#64748B]">Code</span>
            <span className="font-mono font-semibold text-[#0F172A]">{code}</span>
          </div>
          <button
            onClick={cancelWaiting}
            className="zk-press mt-6 rounded-full border border-[#E4ECE7] bg-white px-5 py-2 text-sm font-medium text-[#0F172A] transition hover:bg-[#F7FAF8]"
          >Cancel</button>
        </div>
      </Shell>
    )
  }

  // ─────────────────────────────────────────────────────────────────
  // Main lobby
  // ─────────────────────────────────────────────────────────────────
  const meetingLink = `${window.location.origin}/meet/${code}`

  return (
    <Shell>
      <div className="zk-dock-enter mx-auto grid w-full max-w-[1240px] gap-6 lg:gap-10 lg:grid-cols-[minmax(0,1.86fr)_minmax(0,1fr)] lg:items-stretch">
        {/* ── Left: device preview (65%) ──────────────────────────── */}
        <section className="flex flex-col gap-5">
          <div className="relative isolate aspect-video w-full overflow-hidden rounded-[24px] border border-[#E4ECE7] bg-[#EEF4F1] shadow-[0_10px_40px_rgba(15,138,95,0.08)] ring-1 ring-[#0F8A5F]/[0.03]">
            {/* Video — ALWAYS mounted so the ref is stable. Visibility is
                controlled with classes, not conditional rendering. */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={
                'absolute inset-0 h-full w-full -scale-x-100 object-cover transition-opacity duration-200 ' +
                (showVideo ? 'opacity-100' : 'opacity-0')
              }
            />

            {/* Fallback layer */}
            {!showVideo && (
              <div role="status" aria-live="polite" className="absolute inset-0 grid place-items-center bg-gradient-to-b from-[#F2FBF6] to-[#E7F4EE]">
                {permState === PERM.granted && !videoOn && (
                  <div className="flex flex-col items-center gap-4 text-[#0F172A]">
                    <div
                      className="grid h-28 w-28 place-items-center rounded-full text-4xl font-semibold text-white shadow-[0_12px_30px_-10px_rgba(15,138,95,0.55)] ring-4 ring-white/70"
                      style={{ backgroundColor: user?.avatar_color || '#0F8A5F' }}
                    >{initial}</div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-[13px] font-medium text-[#64748B] shadow-sm ring-1 ring-[#E4ECE7]">
                      <CameraOff className="h-4 w-4" /> Camera is off
                    </div>
                  </div>
                )}
                {permState === PERM.pending && (
                  <div className="flex flex-col items-center gap-3 text-[#0F8A5F]">
                    <Loader2 className="h-7 w-7 animate-spin" />
                    <span className="text-[13px] font-medium text-[#64748B]">Starting camera…</span>
                  </div>
                )}
                {permState === PERM.denied && (
                  <PermError
                    icon={<CameraOff className="h-7 w-7 text-[#ef4444]" />}
                    title="Camera and mic are blocked"
                    detail={permDetail}
                    onRetry={acquire}
                  />
                )}
                {permState === PERM.unavailable && (
                  <PermError
                    icon={<Monitor className="h-7 w-7 text-[#64748B]" />}
                    title="Can't reach your camera"
                    detail={permDetail}
                    onRetry={acquire}
                  />
                )}
              </div>
            )}

            {/* Name pill (bottom-left) */}
            {user && (
              <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-xl bg-[#0F172A]/55 px-3 py-1.5 text-[12.5px] font-medium text-white shadow-sm ring-1 ring-white/10 backdrop-blur-md">
                {user.name}
              </div>
            )}

            {/* Audio meter (top-right) — decorative, hidden from AT */}
            {permState === PERM.granted && (
              <div aria-hidden="true" className="pointer-events-none absolute top-4 right-4 flex h-8 items-center gap-1.5 rounded-xl bg-[#0F172A]/55 px-2.5 ring-1 ring-white/10 backdrop-blur-md">
                {audioOn ? <Mic className="h-3.5 w-3.5 text-[#34d399]" /> : <MicOff className="h-3.5 w-3.5 text-red-400" />}
                <AudioMeter level={audioOn ? audioLevel : 0} />
              </div>
            )}

            {/* Mic + Camera toggle pill (center bottom) */}
            <div className="absolute inset-x-0 bottom-5 flex justify-center">
              <div className="flex items-center gap-3 rounded-full border border-[#E4ECE7] bg-white/95 px-3 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.08)] backdrop-blur-md">
                <ToggleButton
                  on={audioOn}
                  onClick={toggleAudio}
                  disabled={permState !== PERM.granted}
                  label={audioOn ? 'Turn off microphone' : 'Turn on microphone'}
                  iconOn={<Mic />}
                  iconOff={<MicOff />}
                />
                <ToggleButton
                  on={videoOn}
                  onClick={toggleVideo}
                  disabled={permState !== PERM.granted}
                  label={videoOn ? 'Turn off camera' : 'Turn on camera'}
                  iconOn={<Video />}
                  iconOff={<VideoOff />}
                />
              </div>
            </div>
          </div>

          {/* Device pickers (below preview) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DevicePicker
              label="Microphone"
              icon={<Mic className="h-4 w-4" />}
              devices={devices.audio}
              value={audioDeviceId}
              onChange={setAudioDeviceId}
              disabled={permState !== PERM.granted}
              fallbackLabel="Default microphone"
            />
            <DevicePicker
              label="Camera"
              icon={<Camera className="h-4 w-4" />}
              devices={devices.video}
              value={videoDeviceId}
              onChange={setVideoDeviceId}
              disabled={permState !== PERM.granted}
              fallbackLabel="Default camera"
            />
          </div>

          {/* Keyboard hint — desktop only (touch devices have no modifier keys) */}
          <p className="hidden items-center justify-center gap-1.5 text-[12px] text-[#64748B] sm:flex">
            <Kbd>Ctrl</Kbd><span className="text-[#94a3b8]">/</span><Kbd>⌘</Kbd>
            <span className="ml-0.5">+</span><Kbd>D</Kbd>
            <span className="mx-1 text-[#cbd5e1]">·</span> mic
            <span className="mx-2 text-[#cbd5e1]">|</span>
            <Kbd>Ctrl</Kbd><span className="text-[#94a3b8]">/</span><Kbd>⌘</Kbd>
            <span className="ml-0.5">+</span><Kbd>E</Kbd>
            <span className="mx-1 text-[#cbd5e1]">·</span> camera
          </p>
        </section>

        {/* ── Right: meeting info panel (35%) ─────────────────────── */}
        <aside className="flex flex-col justify-center rounded-[24px] border border-[#E4ECE7] bg-white/85 p-6 shadow-[0_10px_40px_rgba(15,138,95,0.08)] backdrop-blur-xl sm:p-8">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#0F8A5F]">
            {firstName ? `${timeGreeting()}, ${firstName}` : 'Ready to join'}
          </span>
          {meeting ? (
            <h1 style={{ color: '#0F172A' }} className="mt-2 text-[32px] font-bold leading-[1.1] tracking-tight sm:text-[40px]">
              {meeting.title || 'Meeting'}
            </h1>
          ) : (
            <div className="skeleton mt-3 h-9 w-3/4 rounded-lg sm:h-11" aria-hidden="true" />
          )}
          {meeting?.description && (
            <p className="mt-3 text-[15px] leading-relaxed text-[#64748B]">{meeting.description}</p>
          )}
          {user && (
            <p className="mt-3 text-[14px] text-[#64748B]">
              Joining as <span className="font-semibold text-[#0F172A]">{user.name}</span>
            </p>
          )}

          {meeting?.scheduled_at && (
            <div className="mt-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#E4ECE7] bg-[#EAF8F2] px-3 py-1.5 text-[12.5px] text-[#0F172A]">
              <Calendar className="h-3.5 w-3.5 text-[#0F8A5F]" />
              {new Date(meeting.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              {meeting.timezone_name ? ` · ${meeting.timezone_name}` : ''}
            </div>
          )}

          {meeting?.waiting_room_enabled && meeting?.host_id !== user?.id && (
            <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left text-[12.5px] text-amber-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>This meeting uses a waiting room — the host will let you in.</span>
            </div>
          )}

          {needsPassword && (
            <div className="mt-5">
              <div className="flex items-center gap-2 rounded-2xl border border-[#E4ECE7] bg-white px-3 py-2.5 transition focus-within:border-[#0F8A5F] focus-within:ring-2 focus-within:ring-[#0F8A5F]/15">
                <Lock className="h-4 w-4 shrink-0 text-[#64748B]" />
                <input
                  type="password"
                  placeholder="Enter meeting password"
                  value={meetingPwd}
                  onChange={(e) => setMeetingPwd(e.target.value)}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent text-sm text-[#0F172A] outline-none placeholder:text-[#94a3b8]"
                />
              </div>
            </div>
          )}

          {err && (
            <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 p-3 text-left text-[12.5px] text-red-700">
              <X className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="font-medium">{err}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={join}
              disabled={joinDisabled}
              aria-busy={joining}
              className="zk-press inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#0F8A5F] to-[#16A34A] px-6 text-[15px] font-semibold text-white shadow-[0_12px_28px_-10px_rgba(15,138,95,0.7),inset_0_1px_0_rgba(255,255,255,0.25)] transition hover:from-[#0C744F] hover:to-[#0F8A5F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F8A5F]/45 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {joining
                ? <><Loader2 className="h-[18px] w-[18px] animate-spin" /> Joining…</>
                : <><Video className="h-[18px] w-[18px]" /> Join Meeting</>}
            </button>
            <button
              onClick={() => navigate('/')}
              className="zk-press inline-flex h-14 items-center justify-center rounded-2xl border border-[#E4ECE7] bg-white px-6 text-[15px] font-semibold text-[#0F172A] transition hover:bg-[#F7FAF8] hover:border-[#cfe0d8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F8A5F]/25"
            >Cancel</button>
          </div>

          {/* Share link */}
          <div className="mt-6">
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#64748B]">Meeting link</div>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-[#E4ECE7] bg-[#F7FAF8] py-1.5 pl-3 pr-1.5">
              <LinkIcon className="h-4 w-4 shrink-0 text-[#0F8A5F]" />
              <code className="min-w-0 flex-1 truncate text-left font-mono text-[12.5px] text-[#64748B]">
                {meetingLink}
              </code>
              <button
                onClick={copyLink}
                aria-label={copied ? 'Link copied' : 'Copy meeting link'}
                className={
                  'zk-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold transition ' +
                  (copied
                    ? 'bg-[#16A34A] text-white shadow-[0_6px_16px_-6px_rgba(22,163,74,0.7)]'
                    : 'border border-[#E4ECE7] bg-white text-[#0F172A] hover:border-[#0F8A5F] hover:text-[#0F8A5F]')
                }
              >
                {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
              </button>
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {copied ? 'Meeting link copied to clipboard' : ''}
            </span>
          </div>

          {/* Trust signal */}
          <div className="mt-5 flex items-center gap-2 text-[12px] text-[#64748B]">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#0F8A5F]" />
            <span>Secured by Zoiko · your camera and mic stay private until you join.</span>
          </div>
        </aside>
      </div>
    </Shell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function Shell({ children }) {
  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden text-[#0F172A]"
      style={{
        background:
          'radial-gradient(1100px 600px at 85% -10%, rgba(15,138,95,0.10), transparent 60%),' +
          'radial-gradient(900px 520px at -5% 110%, rgba(22,163,74,0.08), transparent 58%),' +
          'linear-gradient(135deg, #F7FAF8 0%, #F2FBF6 50%, #EDF9F3 100%)',
      }}
    >
      <LobbyLeaves />
      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-[#E4ECE7] bg-white/70 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Logo size={30} withWordmark />
        </div>
        <div className="inline-flex items-center gap-1.5 text-[12.5px] text-[#64748B]">
          <Clock className="h-3.5 w-3.5" />
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-6 sm:px-12 sm:py-12">
        {children}
      </main>
    </div>
  )
}

function Kbd({ children }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md border border-[#E4ECE7] bg-white px-1.5 font-sans text-[11px] font-semibold text-[#475569] shadow-[0_1px_0_#E4ECE7]">
      {children}
    </kbd>
  )
}

function ToggleButton({ on, onClick, disabled, label, iconOn, iconOff }) {
  const onPalette = 'bg-[#EAF8F2] text-[#0F8A5F] hover:bg-[#dbf2e7] shadow-[0_0_0_1px_rgba(15,138,95,0.22),0_6px_18px_-8px_rgba(15,138,95,0.5)]'
  const offPalette = 'bg-[#fdecec] text-[#dc2626] hover:bg-[#fbdddd] shadow-[0_0_0_1px_rgba(220,38,38,0.22),0_6px_18px_-8px_rgba(220,38,38,0.5)]'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={!on}
      className={
        'zk-press grid h-[52px] w-[52px] place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:h-[22px] [&_svg]:w-[22px] ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F8A5F]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white ' +
        (on ? onPalette : offPalette)
      }
    >{on ? iconOn : iconOff}</button>
  )
}

function AudioMeter({ level }) {
  return (
    <div className="flex h-3 items-end gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => {
        const threshold = (i + 1) / 5
        const active = level >= threshold * 0.9
        const h = 4 + i * 1.5
        return (
          <span
            key={i}
            style={{ height: `${h}px`, opacity: active ? 1 : 0.3 }}
            className={
              'w-0.5 rounded-full transition-opacity ' +
              (i >= 4 && active ? 'bg-red-400' : 'bg-white')
            }
          />
        )
      })}
    </div>
  )
}

function PermError({ icon, title, detail, onRetry }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center text-[#0F172A]">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/80 shadow-sm ring-1 ring-[#E4ECE7]">{icon}</div>
      <div>
        <div className="text-[14.5px] font-semibold">{title}</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-[#64748B]">{detail}</div>
      </div>
      <button
        onClick={onRetry}
        className="zk-press rounded-full border border-[#E4ECE7] bg-white px-4 py-2 text-[12.5px] font-semibold text-[#0F8A5F] shadow-sm transition hover:bg-[#EAF8F2]"
      >Retry</button>
    </div>
  )
}

function DevicePicker({ label, icon, devices, value, onChange, disabled, fallbackLabel }) {
  const current = devices.find((d) => d.deviceId === value)
  const display = current?.label || devices[0]?.label || fallbackLabel
  return (
    <label
      className={
        'relative flex h-14 cursor-pointer items-center gap-2.5 rounded-2xl border bg-white px-4 transition ' +
        'border-[#E4ECE7] hover:border-[#0F8A5F] focus-within:border-[#0F8A5F] focus-within:ring-2 focus-within:ring-[#0F8A5F]/15 ' +
        (disabled ? 'pointer-events-none cursor-not-allowed opacity-50' : '')
      }
    >
      <span className="grid h-8 w-8 place-items-center rounded-full bg-[#EAF8F2] text-[#0F8A5F]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#64748B]">{label}</div>
        <div className="truncate text-[13px] font-medium text-[#0F172A]">{display}</div>
      </div>
      <ChevronDown className="h-4 w-4 shrink-0 text-[#64748B]" />
      <select
        disabled={disabled}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={label}
      >
        {devices.length === 0 && <option value="">{fallbackLabel}</option>}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${d.deviceId.slice(0, 6)}`}
          </option>
        ))}
      </select>
    </label>
  )
}
