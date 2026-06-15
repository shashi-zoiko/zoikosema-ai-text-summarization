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

  const [audioOn, setAudioOn] = useState(true)
  const [videoOn, setVideoOn] = useState(true)
  const audioOnRef = useRef(true)
  const videoOnRef = useRef(true)
  const [permState, setPermState] = useState(PERM.pending)
  const [permDetail, setPermDetail] = useState('')

  const [stream, setStream] = useState(null)

  const { devices, audioDeviceId, setAudioDeviceId, videoDeviceId, setVideoDeviceId, refresh: refreshDevices } = useMediaDevices()

  const [waitingStatus, setWaitingStatus] = useState(null)
  const [copied, setCopied] = useState(false)

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
    }
  }

  const cancelWaiting = () => {
    if (wsRef.current) {
      try { wsRef.current.send(JSON.stringify({ type: 'leave' })); wsRef.current.close() } catch {}
      wsRef.current = null
    }
    setWaitingStatus(null)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meet/${code}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  const initial = (user?.name || '?').trim().charAt(0).toUpperCase() || '?'
  const showVideo = permState === PERM.granted && videoOn

  // ─────────────────────────────────────────────────────────────────
  // Waiting-room view
  // ─────────────────────────────────────────────────────────────────
  if (waitingStatus === 'pending') {
    return (
      <Shell>
        <div className="zk-glass zk-dock-enter w-full max-w-md rounded-3xl border border-white/60 p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-b from-[#3b8bff] to-[#1a73e8] text-white shadow-[0_10px_24px_-8px_rgba(26,115,232,0.6)]">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-zinc-900">Asking to be let in</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-500">
            You'll join automatically once the host lets you in. This usually takes a few seconds.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[12px]">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-zinc-500">Code</span>
            <span className="font-mono font-semibold text-zinc-900">{code}</span>
          </div>
          <button
            onClick={cancelWaiting}
            className="mt-6 rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
          >Cancel</button>
        </div>
      </Shell>
    )
  }

  // ─────────────────────────────────────────────────────────────────
  // Main lobby
  // ─────────────────────────────────────────────────────────────────
  return (
    <Shell>
      <div className="zk-glass zk-dock-enter mx-auto w-full max-w-[1200px] rounded-[28px] border border-white/60 p-5 sm:p-7">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* ── Preview ───────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <div className="zk-tile zk-tile-spotlight relative isolate aspect-video w-full overflow-hidden rounded-[20px] bg-[#dfe3e8] ring-1 ring-black/[0.05]">
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
              <div className="absolute inset-0 grid place-items-center">
                {permState === PERM.granted && !videoOn && (
                  <div className="flex flex-col items-center gap-3 text-[#202124]">
                    <div
                      className="grid h-28 w-28 place-items-center rounded-full text-3xl font-semibold text-white shadow-sm"
                      style={{ backgroundColor: user?.avatar_color || '#3a6ff3' }}
                    >{initial}</div>
                    <div className="inline-flex items-center gap-2 text-[13px] text-[#5f6368]">
                      <CameraOff className="h-4 w-4" /> Camera is off
                    </div>
                  </div>
                )}
                {permState === PERM.pending && (
                  <div className="flex flex-col items-center gap-3 text-[#5f6368]">
                    <Loader2 className="h-7 w-7 animate-spin" />
                    <span className="text-[13px] font-medium">Starting camera…</span>
                  </div>
                )}
                {permState === PERM.denied && (
                  <PermError
                    icon={<CameraOff className="h-7 w-7 text-[#ea4335]" />}
                    title="Camera and mic are blocked"
                    detail={permDetail}
                    onRetry={acquire}
                  />
                )}
                {permState === PERM.unavailable && (
                  <PermError
                    icon={<Monitor className="h-7 w-7 text-[#5f6368]" />}
                    title="Can't reach your camera"
                    detail={permDetail}
                    onRetry={acquire}
                  />
                )}
              </div>
            )}

            {/* Name pill (bottom-left) */}
            {user && (
              <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-black/45 px-2.5 py-1 text-[12.5px] font-medium text-white shadow-sm ring-1 ring-white/10 backdrop-blur-md">
                {user.name}
              </div>
            )}

            {/* Audio meter (top-right) */}
            {permState === PERM.granted && (
              <div className="pointer-events-none absolute top-3 right-3 flex h-7 items-center gap-1.5 rounded-lg bg-black/45 px-2 ring-1 ring-white/10 backdrop-blur-md">
                {audioOn ? <Mic className="h-3.5 w-3.5 text-emerald-300" /> : <MicOff className="h-3.5 w-3.5 text-red-400" />}
                <AudioMeter level={audioOn ? audioLevel : 0} />
              </div>
            )}

            {/* Mic + Camera toggle dock (center bottom) */}
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
              <div className="zk-dock flex items-center gap-3 rounded-full px-2.5 py-2.5">
                <ToggleButton
                  on={audioOn}
                  tone="mic"
                  onClick={toggleAudio}
                  disabled={permState !== PERM.granted}
                  label={audioOn ? 'Turn off microphone' : 'Turn on microphone'}
                  iconOn={<Mic />}
                  iconOff={<MicOff />}
                />
                <ToggleButton
                  on={videoOn}
                  tone="cam"
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
        </div>

        {/* ── Join panel ───────────────────────────────────────── */}
        <aside className="flex flex-col items-center justify-center text-center">
          <h1 className="text-[28px] font-medium leading-tight tracking-tight text-zinc-900">
            {meeting?.title || 'Ready to join?'}
          </h1>
          {user && (
            <p className="mt-1.5 text-[13.5px] text-zinc-500">
              Joining as <span className="font-medium text-zinc-700">{user.name}</span>
            </p>
          )}

          {meeting?.scheduled_at && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[12.5px] text-zinc-600">
              <Calendar className="h-3.5 w-3.5 text-[#1a73e8]" />
              {new Date(meeting.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              {meeting.timezone_name ? ` · ${meeting.timezone_name}` : ''}
            </div>
          )}

          {meeting?.waiting_room_enabled && meeting?.host_id !== user?.id && (
            <div className="mt-4 flex max-w-md items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-[12.5px] text-amber-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>This meeting uses a waiting room — the host will let you in.</span>
            </div>
          )}

          {needsPassword && (
            <div className="mt-4 w-full max-w-md">
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 focus-within:border-[#1a73e8]">
                <Lock className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  type="password"
                  placeholder="Enter meeting password"
                  value={meetingPwd}
                  onChange={(e) => setMeetingPwd(e.target.value)}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                />
              </div>
            </div>
          )}

          {err && (
            <div className="mt-4 flex max-w-md items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-left text-[12.5px] text-red-700">
              <X className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="font-medium">{err}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-6 flex w-full max-w-md flex-col gap-2">
            <button
              onClick={join}
              disabled={!meeting || (needsPassword && !meetingPwd) || permState === PERM.pending}
              className="zk-press inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#3b8bff] to-[#1a73e8] px-6 text-[15px] font-medium text-white shadow-[0_10px_26px_-8px_rgba(26,115,232,0.65),inset_0_1px_0_rgba(255,255,255,0.25)] hover:from-[#3b8bff] hover:to-[#1765c1] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <Video className="h-4 w-4" /> Join now
            </button>
            <button
              onClick={() => navigate('/')}
              className="inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 bg-white px-6 text-[14px] font-medium text-zinc-800 transition hover:bg-zinc-50"
            >Cancel</button>
          </div>

          {/* Share link */}
          <div className="mt-6 flex w-full max-w-md items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2">
            <LinkIcon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
            <code className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-zinc-500">
              {`${window.location.origin}/meet/${code}`}
            </code>
            <button
              onClick={copyLink}
              className={
                'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium transition ' +
                (copied
                  ? 'bg-emerald-500/15 text-emerald-600'
                  : 'text-zinc-500 hover:bg-zinc-100')
              }
            >
              {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
            </button>
          </div>
        </aside>
      </div>
      </div>
    </Shell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function Shell({ children }) {
  return (
    <div className="zk-room-bg relative flex min-h-screen flex-col text-zinc-900">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/60 bg-white/70 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#1a73e8] text-white">
            <Video className="h-4 w-4" />
          </div>
          <span className="text-[15px] font-medium tracking-tight">Zoiko Meet</span>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-500">
          <Clock className="h-3.5 w-3.5" />
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-6 sm:px-8 sm:py-10">
        {children}
      </main>
    </div>
  )
}

function ToggleButton({ on, tone, onClick, disabled, label, iconOn, iconOff }) {
  const onPalette = tone === 'cam'
    ? 'bg-blue-600/[0.13] text-blue-700 hover:bg-blue-600/[0.2] shadow-[0_0_0_1px_rgba(37,99,235,0.22),0_6px_18px_-8px_rgba(37,99,235,0.5)]'
    : 'bg-emerald-500/[0.14] text-emerald-700 hover:bg-emerald-500/[0.22] shadow-[0_0_0_1px_rgba(16,163,74,0.22),0_6px_18px_-8px_rgba(16,163,74,0.5)]'
  const offPalette = 'bg-[#ea4335]/[0.14] text-[#d93829] hover:bg-[#ea4335]/[0.22] shadow-[0_0_0_1px_rgba(234,67,53,0.24),0_6px_18px_-8px_rgba(234,67,53,0.5)]'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={!on}
      className={
        'zk-press grid h-[52px] w-[52px] place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:h-[22px] [&_svg]:w-[22px] ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white ' +
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
    <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center text-[#202124]">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-black/[0.04] ring-1 ring-black/[0.08]">{icon}</div>
      <div>
        <div className="text-[14.5px] font-medium">{title}</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-[#5f6368]">{detail}</div>
      </div>
      <button
        onClick={onRetry}
        className="rounded-full border border-black/[0.08] bg-white px-4 py-2 text-[12.5px] font-medium text-[#202124] shadow-sm transition hover:bg-[#f1f3f4]"
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
        'relative flex h-12 cursor-pointer items-center gap-2.5 rounded-full border bg-white px-4 transition ' +
        'border-zinc-200 hover:border-zinc-300 ' +
        (disabled ? 'pointer-events-none cursor-not-allowed opacity-50' : '')
      }
    >
      <span className="grid h-7 w-7 place-items-center rounded-full bg-zinc-100 text-zinc-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
        <div className="truncate text-[13px] text-zinc-800">{display}</div>
      </div>
      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
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
