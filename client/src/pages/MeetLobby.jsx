import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Calendar, Camera, CameraOff, Check, ChevronDown, Clock, Copy, Info, Link as LinkIcon,
  Loader2, Lock, Mic, MicOff, Monitor, ShieldCheck, User as UserIcon, Video, VideoOff, X,
} from 'lucide-react'
import { api, fetchPublicMeeting, getWsBase } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { cleanDisplayName, validateDisplayName } from '../features/meeting/guestName'
import useMediaDevices from '../hooks/useMediaDevices'
import useAudioLevel from '../hooks/useAudioLevel'
import LobbyLeaves from '../components/LobbyLeaves'
import Logo from '../components/ui/Logo'
import { meetingRoomPath, meetingUrl } from '../lib/meetingUrls.js'

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

// LiveKit is the only media plane now — the legacy WebRTC mesh room has been
// removed. Every meeting (including old rows still flagged 'mesh') routes to
// the SFU room; the server gates joins on the global MEDIA_PROVIDER setting,
// not the per-meeting media_provider column, so old meetings work too.
function pickRoomPath(code) {
  return meetingRoomPath(code)
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

const GUEST_NAME_KEY = 'zoiko_guest_name'

export default function MeetLobby() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading, joinAsGuest } = useAuth()
  // Anonymous (guest) mode: a logged-out visitor on a public meeting link.
  const isGuest = !authLoading && !user

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const wsRef = useRef(null)

  const [meeting, setMeeting] = useState(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [meetingPwd, setMeetingPwd] = useState('')
  const [err, setErr] = useState('')

  // Guest identity (only used when isGuest). Name is remembered across visits
  // via localStorage when the user opts in — no account is ever created.
  const [guestName, setGuestName] = useState(() => {
    try { return localStorage.getItem(GUEST_NAME_KEY) || '' } catch { return '' }
  })
  const [rememberName, setRememberName] = useState(() => {
    try { return !!localStorage.getItem(GUEST_NAME_KEY) } catch { return false }
  })
  const [nameError, setNameError] = useState('')

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

  // Warm the room bundle (LiveKit vendor + room chunk, ~500KB+) while the user
  // is granting camera/mic and reviewing their setup, so clicking "Join" swaps
  // to the room instantly instead of waiting on a cold chunk download.
  useEffect(() => {
    import('../features/meeting/MeetRoomLivekit.jsx').catch(() => {})
  }, [])

  // ── Meeting metadata ────────────────────────────────────────────────
  // Signed-in users hit the authenticated endpoint; anonymous guests hit the
  // public one (no auth) which returns only safe fields for the lobby.
  useEffect(() => {
    if (authLoading) return
    if (user) {
      api(`/api/meetings/${code}`)
        .then((m) => {
          setMeeting(m)
          if (m.password_protected && m.host_id !== user?.id) setNeedsPassword(true)
        })
        .catch((e) => setErr(e.message || 'Meeting not found'))
    } else {
      fetchPublicMeeting(code)
        .then((m) => {
          if (!m.is_active) { setErr('This meeting has ended.'); return }
          if (!m.guests_enabled) {
            setErr('This meeting requires a Zoiko account. Please sign in to join.')
            return
          }
          setMeeting(m)
          if (m.password_protected) setNeedsPassword(true)
        })
        .catch((e) => setErr(e.message || 'Meeting not found'))
    }
  }, [code, user, authLoading])

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
    // Guests: validate + mint an anonymous identity before the normal join.
    if (isGuest) {
      const nameErr = validateDisplayName(guestName)
      if (nameErr) { setNameError(nameErr); return }
      const cleaned = cleanDisplayName(guestName)
      try {
        if (rememberName) localStorage.setItem(GUEST_NAME_KEY, cleaned)
        else localStorage.removeItem(GUEST_NAME_KEY)
      } catch {}
    }
    setJoining(true)
    try {
      // For guests, mint the guest token first (creates the ephemeral identity);
      // the api client then sends it automatically on the calls below.
      let authToken
      if (isGuest) {
        const guestData = await joinAsGuest(code, {
          displayName: cleanDisplayName(guestName),
          password: needsPassword ? meetingPwd : undefined,
        })
        authToken = guestData.access_token
      } else {
        authToken = localStorage.getItem('zoiko_token')
      }

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
        console.info('[WAITING_FOR_ADMISSION]', code)
        const token = authToken
        let wsUrl = `${getWsBase()}/ws/meetings/${code}?token=${encodeURIComponent(token)}`
        if (needsPassword && meetingPwd) wsUrl += `&pwd=${encodeURIComponent(meetingPwd)}`
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws
        ws.onmessage = (e) => {
          let data
          try { data = JSON.parse(e.data) } catch { return }
          if (data.type === 'admitted' || data.type === 'welcome') {
            console.info('[ADMISSION_RECEIVED]', code, '→ [JOINING_ROOM]')
            setWaitingStatus('admitted')
            try { ws.close() } catch {}
            wsRef.current = null
            releasePreview()
            navigate(pickRoomPath(code))
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
        navigate(pickRoomPath(code))
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
      await navigator.clipboard.writeText(meetingUrl(code))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  // Identity for the preview chrome — the signed-in user, or the guest's typed
  // name (falls back to "You" before they type).
  const displayName = isGuest ? (cleanDisplayName(guestName) || 'You') : (user?.name || '')
  const avatarColor = isGuest ? '#b45309' : (user?.avatar_color || '#0F8A5F')
  const initial = (displayName || '?').trim().charAt(0).toUpperCase() || '?'
  const firstName = (user?.name || '').trim().split(/\s+/)[0]
  const showVideo = permState === PERM.granted && videoOn
  const guestNameInvalid = isGuest && !!validateDisplayName(guestName)
  const joinDisabled =
    !meeting || (needsPassword && !meetingPwd) || permState === PERM.pending || joining || guestNameInvalid

  // ─────────────────────────────────────────────────────────────────
  // Meeting-unavailable view — metadata fetch failed before anything loaded
  // (bad/expired code, network). A dedicated screen beats a half-rendered
  // lobby with an inline error.
  // ─────────────────────────────────────────────────────────────────
  if (err && !meeting) {
    return (
      <Shell>
        <div className="zk-glass-card zk-dock-enter w-full max-w-md rounded-[24px] bg-[#111A28]/80 p-8 text-center shadow-[0_24px_70px_-20px_rgba(0,0,0,0.7)] backdrop-blur-2xl">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#F87171]/15 text-[#F87171] ring-1 ring-[#F87171]/25">
            <X className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-[#F1F5F9]">Meeting unavailable</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[#94A3B8]">{err}</p>
          <button
            onClick={() => navigate('/')}
            className="zk-press mt-6 inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#10B981] to-[#059669] px-6 text-[14px] font-semibold text-white shadow-[0_12px_30px_-10px_rgba(16,185,129,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1220]"
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
        <div className="zk-glass-card zk-dock-enter w-full max-w-md rounded-[24px] bg-[#111A28]/80 p-8 text-center shadow-[0_24px_70px_-20px_rgba(0,0,0,0.7)] backdrop-blur-2xl">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#10B981] to-[#059669] text-white shadow-[0_12px_30px_-8px_rgba(16,185,129,0.55)]">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-[#F1F5F9]">Asking to be let in</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[#94A3B8]">
            You'll join automatically once the host lets you in. This usually takes a few seconds.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#10B981]/25 bg-[#10B981]/10 px-3 py-1.5 text-[12px]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#34D399]" />
            <span className="text-[#94A3B8]">Code</span>
            <span className="font-mono font-semibold text-[#F1F5F9]">{code}</span>
          </div>
          <button
            onClick={cancelWaiting}
            className="zk-press mt-6 rounded-full bg-white/[0.05] px-5 py-2 text-sm font-medium text-[#E2E8F0] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] transition hover:bg-white/[0.1] hover:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.4)]"
          >Cancel</button>
        </div>
      </Shell>
    )
  }

  // ─────────────────────────────────────────────────────────────────
  // Main lobby
  // ─────────────────────────────────────────────────────────────────
  const meetingLink = meetingUrl(code)

  return (
    <Shell>
      <div className="zk-dock-enter mx-auto grid w-full max-w-[1240px] grid-cols-1 gap-6 lg:gap-10 lg:grid-cols-[minmax(0,1.86fr)_minmax(0,1fr)] lg:items-stretch">
        {/* ── Left: device preview (65%) ──────────────────────────── */}
        <section className="flex min-w-0 flex-col gap-5">
          <div className="zk-glass-card relative isolate aspect-video w-full overflow-hidden rounded-[20px] bg-[#0A0F18] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)] sm:rounded-[24px]">
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

            {/* Cinematic bottom vignette so overlay chrome always reads */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/55 to-transparent" />

            {/* Fallback layer */}
            {!showVideo && (
              <div role="status" aria-live="polite" className="absolute inset-0 grid place-items-center bg-[radial-gradient(120%_120%_at_50%_0%,#13203099,transparent_70%),linear-gradient(180deg,#0E1521,#080C13)]">
                {permState === PERM.granted && !videoOn && (
                  <div className="flex flex-col items-center gap-4 text-[#F1F5F9]">
                    <div
                      className="grid h-28 w-28 place-items-center rounded-full text-4xl font-semibold text-white shadow-[0_18px_50px_-12px_rgba(0,0,0,0.7)] ring-4 ring-white/10"
                      style={{ backgroundColor: avatarColor }}
                    >{initial}</div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1.5 text-[13px] font-medium text-[#94A3B8] ring-1 ring-white/10 backdrop-blur-md">
                      <CameraOff className="h-4 w-4" /> Camera is off
                    </div>
                  </div>
                )}
                {permState === PERM.pending && (
                  <div className="flex flex-col items-center gap-3 text-[#34D399]">
                    <Loader2 className="h-7 w-7 animate-spin" />
                    <span className="text-[13px] font-medium text-[#94A3B8]">Starting camera…</span>
                  </div>
                )}
                {permState === PERM.denied && (
                  <PermError
                    icon={<CameraOff className="h-7 w-7 text-[#F87171]" />}
                    title="Camera and mic are blocked"
                    detail={permDetail}
                    onRetry={acquire}
                  />
                )}
                {permState === PERM.unavailable && (
                  <PermError
                    icon={<Monitor className="h-7 w-7 text-[#94A3B8]" />}
                    title="Can't reach your camera"
                    detail={permDetail}
                    onRetry={acquire}
                  />
                )}
              </div>
            )}

            {/* Name pill (bottom-left) */}
            {(user || isGuest) && (
              <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-xl bg-black/45 px-3 py-1.5 text-[12.5px] font-medium text-white shadow-sm ring-1 ring-white/10 backdrop-blur-md">
                {displayName}{isGuest && <span className="text-white/55">(Guest)</span>}
              </div>
            )}

            {/* Audio meter (top-right) — decorative, hidden from AT */}
            {permState === PERM.granted && (
              <div aria-hidden="true" className="pointer-events-none absolute top-4 right-4 flex h-8 items-center gap-1.5 rounded-xl bg-black/45 px-2.5 ring-1 ring-white/10 backdrop-blur-md">
                {audioOn ? <Mic className="h-3.5 w-3.5 text-[#34D399]" /> : <MicOff className="h-3.5 w-3.5 text-[#F87171]" />}
                <AudioMeter level={audioOn ? audioLevel : 0} />
              </div>
            )}

            {/* Mic + Camera toggle pill (center bottom) */}
            <div className="absolute inset-x-0 bottom-5 flex justify-center">
              <div className="flex items-center gap-2.5 rounded-full bg-black/55 p-2 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
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
          <p className="hidden items-center justify-center gap-1.5 text-[12px] text-[#7A8AA0] sm:flex">
            <Kbd>Ctrl</Kbd><span className="text-[#4B586B]">/</span><Kbd>⌘</Kbd>
            <span className="ml-0.5">+</span><Kbd>D</Kbd>
            <span className="mx-1 text-[#39465A]">·</span> mic
            <span className="mx-2 text-[#39465A]">|</span>
            <Kbd>Ctrl</Kbd><span className="text-[#4B586B]">/</span><Kbd>⌘</Kbd>
            <span className="ml-0.5">+</span><Kbd>E</Kbd>
            <span className="mx-1 text-[#39465A]">·</span> camera
          </p>
        </section>

        {/* ── Right: meeting info panel (35%) ─────────────────────── */}
        <aside className="zk-glass-card flex min-w-0 flex-col justify-center rounded-[24px] bg-[#111A28]/75 p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)] backdrop-blur-2xl sm:p-8">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#34D399]">
            {isGuest ? 'Joining as guest' : (firstName ? `${timeGreeting()}, ${firstName}` : 'Ready to join')}
          </span>
          {meeting ? (
            <h1
              style={{ color: '#F8FAFC', WebkitTextFillColor: '#F8FAFC' }}
              className="mt-2 text-[26px] font-bold leading-[1.1] tracking-tight sm:text-[40px]"
            >
              {meeting.title || 'Meeting'}
            </h1>
          ) : (
            <div className="skeleton mt-3 h-9 w-3/4 rounded-lg sm:h-11" aria-hidden="true" />
          )}
          {meeting?.description && (
            <p className="mt-3 text-[15px] leading-relaxed text-[#94A3B8]">{meeting.description}</p>
          )}
          {user && (
            <p className="mt-3 text-[14px] text-[#94A3B8]">
              Joining as <span className="font-semibold text-[#E2E8F0]">{user.name}</span>
            </p>
          )}
          {isGuest && meeting?.host_name && (
            <p className="mt-3 text-[14px] text-[#94A3B8]">
              Hosted by <span className="font-semibold text-[#E2E8F0]">{meeting.host_name}</span>
            </p>
          )}

          {/* Guest display-name entry (anonymous join) */}
          {isGuest && (
            <div className="mt-5">
              <label htmlFor="guest-name" className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#8696A7]">
                Your name
              </label>
              <div className="zk-field mt-2 flex items-center gap-2 rounded-2xl px-3 py-2.5">
                <UserIcon className="h-4 w-4 shrink-0 text-[#8696A7]" />
                <input
                  id="guest-name"
                  type="text"
                  inputMode="text"
                  maxLength={60}
                  placeholder="Enter your name"
                  value={guestName}
                  onChange={(e) => { setGuestName(e.target.value); if (nameError) setNameError('') }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !joinDisabled) join() }}
                  autoComplete="name"
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? 'guest-name-error' : undefined}
                  className="min-w-0 flex-1 bg-transparent text-sm text-[#F1F5F9] outline-none placeholder:text-[#5B6878]"
                />
              </div>
              {nameError && (
                <p id="guest-name-error" role="alert" className="mt-1.5 text-[12px] font-medium text-[#F87171]">{nameError}</p>
              )}
              <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[12.5px] text-[#94A3B8]">
                <input
                  type="checkbox"
                  checked={rememberName}
                  onChange={(e) => setRememberName(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-transparent text-[#10B981] focus:ring-[#10B981]/40"
                />
                Remember my name on this device
              </label>
            </div>
          )}

          {meeting?.scheduled_at && (
            <div className="mt-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#10B981]/25 bg-[#10B981]/10 px-3 py-1.5 text-[12.5px] text-[#E2E8F0]">
              <Calendar className="h-3.5 w-3.5 text-[#34D399]" />
              {new Date(meeting.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              {meeting.timezone_name ? ` · ${meeting.timezone_name}` : ''}
            </div>
          )}

          {meeting?.waiting_room_enabled && (isGuest || meeting?.host_id !== user?.id) && (
            <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-[#F59E0B]/25 bg-[#F59E0B]/10 p-3 text-left text-[12.5px] text-[#FCD34D]">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>This meeting uses a waiting room — the host will let you in.</span>
            </div>
          )}

          {needsPassword && (
            <div className="mt-5">
              <div className="zk-field flex items-center gap-2 rounded-2xl px-3 py-2.5">
                <Lock className="h-4 w-4 shrink-0 text-[#8696A7]" />
                <input
                  type="password"
                  placeholder="Enter meeting password"
                  value={meetingPwd}
                  onChange={(e) => setMeetingPwd(e.target.value)}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent text-sm text-[#F1F5F9] outline-none placeholder:text-[#5B6878]"
                />
              </div>
            </div>
          )}

          {err && (
            <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-2xl border border-[#F87171]/25 bg-[#F87171]/10 p-3 text-left text-[12.5px] text-[#FCA5A5]">
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
              className="zk-press zk-sheen inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#4F46E5] via-[#6D28D9] to-[#9333EA] px-6 text-[15px] font-semibold text-white shadow-[0_16px_36px_-12px_rgba(124,58,237,0.7),inset_0_1px_0_rgba(255,255,255,0.22)] transition hover:from-[#6366F1] hover:via-[#7C3AED] hover:to-[#A855F7] hover:shadow-[0_20px_48px_-12px_rgba(124,58,237,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B1220] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {joining
                ? <><Loader2 className="h-[18px] w-[18px] animate-spin" /> Joining…</>
                : <><Video className="h-[18px] w-[18px]" /> Join Meeting</>}
            </button>
            <button
              onClick={() => navigate('/')}
              className="zk-press inline-flex h-14 items-center justify-center rounded-2xl bg-white/[0.05] px-6 text-[15px] font-semibold text-[#CBD5E1] shadow-[0_2px_12px_-6px_rgba(0,0,0,0.6)] transition hover:bg-white/[0.09] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15"
            >Cancel</button>
          </div>

          {/* Share link */}
          <div className="mt-6">
            <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#8696A7]">Meeting link</div>
            <div className="zk-field mt-2 flex items-center gap-2 rounded-2xl py-1.5 pl-3 pr-1.5">
              <LinkIcon className="h-4 w-4 shrink-0 text-[#34D399]" />
              <code className="min-w-0 flex-1 truncate text-left font-mono text-[12.5px] text-[#94A3B8]">
                {meetingLink}
              </code>
              <button
                onClick={copyLink}
                aria-label={copied ? 'Link copied' : 'Copy meeting link'}
                className={
                  'zk-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold transition ' +
                  (copied
                    ? 'bg-[#10B981] text-white shadow-[0_6px_16px_-6px_rgba(16,185,129,0.7)]'
                    : 'bg-white/[0.07] text-[#E2E8F0] hover:bg-white/[0.12] hover:text-white')
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
          <div className="mt-5 flex items-center gap-2 text-[12px] text-[#7A8AA0]">
            <ShieldCheck className="h-4 w-4 shrink-0 text-[#34D399]" />
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
      className="zk-lobby-root relative flex min-h-dvh flex-col overflow-x-hidden text-[#E2E8F0]"
      style={{
        background:
          'radial-gradient(1200px 640px at 85% -12%, rgba(16,185,129,0.16), transparent 60%),' +
          'radial-gradient(960px 560px at -8% 112%, rgba(5,150,105,0.13), transparent 58%),' +
          'linear-gradient(135deg, #070B12 0%, #0B1220 52%, #0A1018 100%)',
      }}
    >
      <LobbyLeaves />
      <header
        className="zk-fade-divider relative z-10 flex h-14 shrink-0 items-center justify-between bg-white/[0.02] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] backdrop-blur-xl sm:px-6"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-2">
          <Logo size={30} withWordmark />
        </div>
        <div className="inline-flex items-center gap-1.5 text-[12.5px] text-[#8696A7]">
          <Clock className="h-3.5 w-3.5" />
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </header>
      <main className="relative z-10 flex flex-1 items-start justify-center py-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:items-center sm:px-8 sm:py-12 lg:px-12">
        {children}
      </main>
    </div>
  )
}

function Kbd({ children }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-white/[0.05] px-1.5 font-sans text-[11px] font-semibold text-[#B7C2D0] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07),inset_0_-1px_0_rgba(0,0,0,0.3)]">
      {children}
    </kbd>
  )
}

// Production-grade media toggles. On = a refined near-black control with a white
// glyph and a faint emerald edge (matches the in-room dock). Off = a solid
// danger fill so a muted mic / stopped camera reads instantly, Google-Meet style.
// Motion lives in the `.zk-media-btn` utility (spring scale + expanding glow
// ring) so the press feels instant and fluid, uiverse-style — the per-state
// glow colour is handed in via the --zk-btn-glow custom property.
function ToggleButton({ on, onClick, disabled, label, iconOn, iconOff }) {
  const onPalette =
    'bg-[#161D29] text-white ring-1 ring-inset ring-white/12 hover:bg-[#1C2533] ' +
    'shadow-[0_8px_22px_-10px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.07)]'
  const offPalette =
    'bg-[#EF4444] text-white ring-1 ring-inset ring-white/15 hover:bg-[#F05252] ' +
    'shadow-[0_10px_26px_-10px_rgba(239,68,68,0.7),inset_0_1px_0_rgba(255,255,255,0.2)]'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={!on}
      style={{ '--zk-btn-glow': on ? 'rgba(16,185,129,0.55)' : 'rgba(239,68,68,0.6)' }}
      className={
        'zk-media-btn grid h-[54px] w-[54px] place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:h-[22px] [&_svg]:w-[22px] [&_svg]:transition-transform [&_svg]:duration-200 active:[&_svg]:scale-90 ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0F18] ' +
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
              (i >= 4 && active ? 'bg-[#F87171]' : 'bg-[#34D399]')
            }
          />
        )
      })}
    </div>
  )
}

function PermError({ icon, title, detail, onRetry }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center text-[#F1F5F9]">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">{icon}</div>
      <div>
        <div className="text-[14.5px] font-semibold">{title}</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-[#94A3B8]">{detail}</div>
      </div>
      <button
        onClick={onRetry}
        className="zk-press rounded-full bg-white/[0.05] px-4 py-2 text-[12.5px] font-semibold text-[#34D399] shadow-[inset_0_0_0_1px_rgba(16,185,129,0.3)] transition hover:bg-white/[0.1] hover:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.55)]"
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
        'zk-field group relative flex h-14 cursor-pointer items-center gap-2.5 rounded-2xl px-4 ' +
        (disabled ? 'pointer-events-none cursor-not-allowed opacity-50' : '')
      }
    >
      <span className="grid h-8 w-8 place-items-center rounded-full bg-[#10B981]/15 text-[#34D399] transition-colors duration-200 group-hover:bg-[#10B981]/25">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#8696A7]">{label}</div>
        <div className="truncate text-[13px] font-medium text-[#E2E8F0]">{display}</div>
      </div>
      <ChevronDown className="zk-chevron h-4 w-4 shrink-0 text-[#8696A7] group-hover:text-[#34D399]" />
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
