import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight, Calendar, Camera, CameraOff, Check, ChevronDown, Circle, Copy,
  HelpCircle, Info, Loader2, Lock, Mic, MicOff, Monitor, MoreHorizontal,
  MoreVertical, Settings, ShieldCheck, Sparkles, Triangle, User as UserIcon, Users,
  Video, VideoOff, X,
} from 'lucide-react'
import { api, fetchPublicMeeting, getWsBase } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { cleanDisplayName, validateDisplayName } from '../features/meeting/guestName'
import useMediaDevices from '../hooks/useMediaDevices'
import useAudioLevel from '../hooks/useAudioLevel'
import { BackgroundProcessor, backgroundEffectsSupported } from '../features/meeting/backgroundEngine.js'
import { BLUR_PRESETS, FILTER_PRESETS, IMAGE_PRESETS, NONE_EFFECT, getPreset } from '../features/meeting/backgroundPresets.js'
import Avatar from '../components/ui/Avatar'
import Logo from '../components/ui/Logo'
import ThemeToggle from '../components/ui/ThemeToggle'
import { cn } from '../lib/cn'
import { meetingRoomPath, meetingShareText } from '../lib/meetingUrls.js'

/**
 * Meeting pre-join lobby — enterprise "managed workspace" layout.
 *
 * CRITICAL: the <video> element is ALWAYS mounted so `videoRef.current` is
 * stable. Stream attachment happens in a useEffect keyed on `stream`. The
 * previous "set srcObject inside acquire() before setState" pattern was the
 * root cause of the black-preview bug — the conditional render meant the
 * video element didn't exist yet at the moment of assignment, the ref was
 * null, and the stream was never re-attached after the render mounted it.
 *
 * ponytail: the "managed workspace" chrome — Confidential Mode copy, policy
 * banners, stat-tile values, connection quality, host waiting count — is
 * static presentation matching the approved design, not backend-driven. Wire
 * to real fields when those features ship server-side.
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

// "01:23:45" / "04:18" countdown string from a positive millisecond delta.
function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

const GUEST_NAME_KEY = 'zoiko_guest_name'
// Same key the meeting reads on mount (MeetRoomLivekit) — persisting the lobby
// pick here is what carries the chosen background into the call.
const BG_EFFECT_KEY = 'zoiko_bg_effect'

export default function MeetLobby() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading, joinAsGuest, resumeGuest, clearGuest } = useAuth()
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
  const [devicesOpen, setDevicesOpen] = useState(false)
  // In-preview control popovers. `barPanel` is which one is open ('effects' |
  // 'more' | null).
  const [barPanel, setBarPanel] = useState(null)
  // Virtual background chosen before joining. Uses the SAME MediaPipe engine +
  // presets + localStorage key ('zoiko_bg_effect') as the in-call effect, so
  // the pick previews live here and the meeting restores it on join with no
  // extra plumbing. `displayStream` is what the preview <video> shows — the raw
  // camera when no effect, else the processed (segmented) output track.
  const [bgEffectId, setBgEffectId] = useState(() => {
    try { return localStorage.getItem(BG_EFFECT_KEY) || 'none' } catch { return 'none' }
  })
  const [displayStream, setDisplayStream] = useState(null)
  const bgProcRef = useRef(null)
  const bgSupported = backgroundEffectsSupported()
  const bgEffect = getPreset(bgEffectId)
  // Live clock — only ticks while there's a future start time to count down to.
  const [nowTs, setNowTs] = useState(() => Date.now())

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

  // ── Live waiting-room count ─────────────────────────────────────────
  // The pre-join lobby has no control WS, so refresh the real pending count on a
  // gentle interval (visibility-gated) and patch ONLY waiting_count — never the
  // gating fields — so people joining the waiting room show up while the host
  // sits on this screen. Backend computes it on demand (meetings.py).
  useEffect(() => {
    if (authLoading || !meeting?.is_active) return undefined
    let alive = true
    const tick = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const m = user ? await api(`/api/meetings/${code}`) : await fetchPublicMeeting(code)
        if (alive && typeof m?.waiting_count === 'number') {
          setMeeting((prev) => (prev ? { ...prev, waiting_count: m.waiting_count } : prev))
        }
      } catch { /* transient — keep the last known count */ }
    }
    const id = setInterval(tick, 5000)
    return () => { alive = false; clearInterval(id) }
  }, [code, user, authLoading, meeting?.is_active])

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
    const s = displayStream || stream
    if (el.srcObject !== s) {
      try { el.srcObject = null } catch {}
      try { el.srcObject = s } catch {}
    }
  }, [displayStream, stream])

  // ── Virtual background preview ──────────────────────────────────────
  // Runs the shared MediaPipe processor on the raw camera track and feeds the
  // segmented output to the preview. Shows the raw camera (never a freeze) when
  // there's no effect, no camera, or the browser can't run the engine.
  const changeBg = useCallback((id) => {
    setBgEffectId(id)
    try { localStorage.setItem(BG_EFFECT_KEY, id) } catch { /* private mode */ }
    setBarPanel(null)
  }, [])

  useEffect(() => {
    const rawTrack = stream?.getVideoTracks?.()[0]
    const off = !rawTrack || !videoOn || permState !== PERM.granted || bgEffect.type === 'none' || !bgSupported
    if (off) {
      bgProcRef.current?.stop()
      setDisplayStream(null) // fall back to raw stream in the attach effect
      return undefined
    }
    let cancelled = false
    const proc = bgProcRef.current || (bgProcRef.current = new BackgroundProcessor())
    proc.setEffect(bgEffect)
    proc.start(rawTrack)
      .then((outTrack) => { if (!cancelled && outTrack) setDisplayStream(new MediaStream([outTrack])) })
      .catch(() => { if (!cancelled) setDisplayStream(null) })
    return () => { cancelled = true }
  }, [stream, videoOn, permState, bgEffectId, bgEffect, bgSupported])

  // Full teardown of the processor (and its segmenter) on unmount.
  useEffect(() => () => { bgProcRef.current?.dispose() }, [])

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
      // For guests: reuse the durable identity already admitted to THIS meeting
      // if we have one — that's what lets an admitted guest rejoin after a
      // refresh / disconnect / leave WITHOUT the host re-admitting. Only mint a
      // brand-new identity (→ waiting room) when there's no prior session.
      let authToken
      if (isGuest) {
        const resumed = resumeGuest(code)
        if (resumed?.token) {
          authToken = resumed.token
        } else {
          const guestData = await joinAsGuest(code, {
            displayName: cleanDisplayName(guestName),
            password: needsPassword ? meetingPwd : undefined,
          })
          authToken = guestData.access_token
        }
      } else {
        authToken = localStorage.getItem('zoiko_token')
      }

      const joinBody = { code }
      if (needsPassword) joinBody.password = meetingPwd
      let participant
      try {
        participant = await api(`/api/meetings/${code}/join`, { method: 'POST', body: joinBody })
      } catch (e) {
        // A resumed guest token can be stale (6h expiry, or the meeting ended
        // and the guest row was purged). Mint a fresh identity ONCE and retry —
        // this correctly requires host approval again, since the old identity
        // no longer exists. Never re-mint on 403 (removed/denied/wrong password).
        const credErr = isGuest && /401|unauthor|credential/i.test(e?.message || '')
        if (!credErr) throw e
        clearGuest(code)
        const guestData = await joinAsGuest(code, {
          displayName: cleanDisplayName(guestName),
          password: needsPassword ? meetingPwd : undefined,
        })
        authToken = guestData.access_token
        participant = await api(`/api/meetings/${code}/join`, { method: 'POST', body: joinBody })
      }
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
      await navigator.clipboard.writeText(meetingShareText(code))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  // Identity for the preview chrome — the signed-in user, or the guest's typed
  // name (falls back to "You" before they type).
  const displayName = isGuest ? (cleanDisplayName(guestName) || 'You') : (user?.name || '')
  const hostName = meeting?.host_name || (isHostSafe(user, meeting) ? user?.name : null) || 'Host'
  const waitingCount = meeting?.waiting_count || 0
  const showVideo = permState === PERM.granted && videoOn

  // ── Scheduled-start countdown gate (Google-Meet parity) ──────────────
  // Non-hosts can join from 5 min before the scheduled start; the host may
  // always open the room early. Until then we show a live countdown and keep
  // the Join button disabled. Guests never see this (the public meeting payload
  // omits scheduled_at), so their flow is unchanged.
  const JOIN_LEAD_MS = 5 * 60 * 1000
  const scheduledMs = meeting?.scheduled_at ? new Date(meeting.scheduled_at).getTime() : null
  const isHost = !!(user && meeting && meeting.host_id === user.id)
  const msToStart = scheduledMs != null ? scheduledMs - nowTs : null
  const showCountdown = msToStart != null && msToStart > 0
  const notYetOpen = scheduledMs != null && !isHost && msToStart > JOIN_LEAD_MS

  // Tick once a second only while counting down to a future start.
  useEffect(() => {
    if (scheduledMs == null || nowTs >= scheduledMs) return undefined
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [scheduledMs, nowTs])

  const guestNameInvalid = isGuest && !!validateDisplayName(guestName)
  const joinDisabled =
    !meeting || (needsPassword && !meetingPwd) || permState === PERM.pending || joining || guestNameInvalid || notYetOpen

  // ─────────────────────────────────────────────────────────────────
  // Meeting-unavailable view
  // ─────────────────────────────────────────────────────────────────
  if (err && !meeting) {
    return (
      <Shell user={user} meeting={null}>
        <div className="zk-themed mx-auto mt-8 w-full max-w-md rounded-3xl border border-[var(--c-line)] bg-[var(--c-surface)] p-8 text-center shadow-[0_24px_60px_-30px_rgba(15,23,42,0.35)]">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--c-danger-soft)] text-[var(--c-danger)]">
            <X className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-[var(--c-fg)]">Meeting unavailable</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--c-fg-muted)]">{err}</p>
          <button
            onClick={() => navigate('/')}
            className="zk-press mt-6 inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-[#6D28D9] to-[#7C3AED] px-6 text-[14px] font-semibold text-white shadow-[0_12px_30px_-10px_rgba(124,58,237,0.6)]"
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
      <Shell user={user} meeting={meeting}>
        <div className="zk-themed mx-auto mt-8 w-full max-w-md rounded-3xl border border-[var(--c-line)] bg-[var(--c-surface)] p-8 text-center shadow-[0_24px_60px_-30px_rgba(15,23,42,0.35)]">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#6D28D9] to-[#7C3AED] text-white shadow-[0_12px_30px_-8px_rgba(124,58,237,0.5)]">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-[var(--c-fg)]">Asking to be let in</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--c-fg-muted)]">
            You'll join automatically once the host lets you in. This usually takes a few seconds.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--lobby-accent-line)] bg-[var(--lobby-accent-tint)] px-3 py-1.5 text-[12px]">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--lobby-accent-fg)]" />
            <span className="text-[var(--c-fg-muted)]">Code</span>
            <span className="font-mono font-semibold text-[var(--c-fg)]">{code}</span>
          </div>
          <div>
            <button
              onClick={cancelWaiting}
              className="zk-press mt-6 rounded-full border border-[var(--c-line)] bg-[var(--c-surface)] px-5 py-2 text-sm font-medium text-[var(--c-fg-dim)] transition hover:bg-[var(--c-bg-3)]"
            >Cancel</button>
          </div>
        </div>
      </Shell>
    )
  }

  // ─────────────────────────────────────────────────────────────────
  // Main lobby
  // ─────────────────────────────────────────────────────────────────
  return (
    <Shell user={user} meeting={meeting}>
      <div className="zk-dock-enter mx-auto w-full max-w-[1320px]">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
          {/* ── Left: device preview ──────────────────────────────── */}
          <section className="min-w-0">
            {/* min-h floor: every child is absolutely positioned, so the card's
                height comes only from aspect-ratio — which resolves to 0 in this
                grid cell and collapses the whole preview. The min-height guarantees
                the panel is always visible; aspect-ratio still shapes it when taller. */}
            <div className="relative isolate aspect-[4/3] min-h-[420px] w-full overflow-hidden rounded-[24px] bg-[#0A0F1A] shadow-[0_24px_60px_-28px_rgba(15,23,42,0.5)] ring-1 ring-black/5 sm:aspect-[3/2] sm:min-h-[480px]">
              {/* Video — ALWAYS mounted so the ref is stable. */}
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

              {/* Dark room ambience when the camera is off */}
              {!showVideo && (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-[radial-gradient(130%_120%_at_50%_-10%,#1b2740,transparent_62%),linear-gradient(180deg,#0d1526,#070b13)]"
                />
              )}
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/60 to-transparent" />

              {/* Top-left workspace chip */}
              <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-xl bg-black/45 px-3 py-1.5 text-[13px] font-medium text-white ring-1 ring-white/10 backdrop-blur-md">
                <span className="grid h-5 w-5 place-items-center rounded-md bg-[#10B981]">
                  <Triangle className="h-3 w-3 text-white" fill="currentColor" />
                </span>
                Zoiko Group
              </div>

              {/* Top-right overflow */}
              <button
                type="button"
                aria-label="More options"
                className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/10 backdrop-blur-md transition hover:bg-black/60"
              >
                <MoreVertical className="h-4 w-4" />
              </button>

              {/* Center state (camera off / starting / errors) */}
              {!showVideo && (
                <div role="status" aria-live="polite" className="absolute inset-x-0 top-0 bottom-36 grid place-items-center px-4 sm:bottom-40">
                  {permState === PERM.granted && !videoOn && (
                    <div className="flex flex-col items-center text-center">
                      <div className="grid h-24 w-24 place-items-center rounded-full ring-2 ring-[#7C3AED]/70">
                        <VideoOff className="h-9 w-9 text-[#A78BFA]" />
                      </div>
                      <div className="mt-4 text-[22px] font-semibold text-white">Camera off</div>
                      <div className="mt-1 text-[13.5px] text-white/60">Your camera will stay off when you enter.</div>
                      <button
                        type="button"
                        onClick={toggleVideo}
                        className="zk-press mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[13.5px] font-semibold text-[#C4B5FD] ring-1 ring-white/15 backdrop-blur transition hover:bg-white/15"
                      >
                        <Video className="h-4 w-4" /> Turn on camera
                      </button>
                    </div>
                  )}
                  {permState === PERM.pending && (
                    <div className="flex flex-col items-center gap-3 text-[#A78BFA]">
                      <Loader2 className="h-7 w-7 animate-spin" />
                      <span className="text-[13px] font-medium text-white/60">Starting camera…</span>
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
                      icon={<Monitor className="h-7 w-7 text-white/70" />}
                      title="Can't reach your camera"
                      detail={permDetail}
                      onRetry={acquire}
                    />
                  )}
                </div>
              )}

              {/* Name pill (bottom-left) while previewing video */}
              {showVideo && (user || isGuest) && (
                <div className="pointer-events-none absolute bottom-24 left-4 flex items-center gap-1.5 rounded-xl bg-black/45 px-3 py-1.5 text-[12.5px] font-medium text-white ring-1 ring-white/10 backdrop-blur-md">
                  {displayName}{isGuest && <span className="text-white/55">(Guest)</span>}
                </div>
              )}

              {/* Bottom overlay: control bar + connection quality */}
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2.5 p-3 sm:p-4">
                <div className="relative flex w-fit items-center gap-0.5 rounded-2xl bg-black/55 p-1.5 ring-1 ring-white/10 backdrop-blur-xl">
                  {/* Click-away backdrop for the popovers */}
                  {barPanel && (
                    <button
                      type="button"
                      aria-label="Close menu"
                      className="fixed inset-0 z-0 cursor-default border-0 bg-transparent shadow-none"
                      onClick={() => setBarPanel(null)}
                    />
                  )}

                  {barPanel === 'effects' && (
                    <BackgroundPopover
                      activeId={bgEffectId}
                      onSelect={changeBg}
                      supported={bgSupported}
                    />
                  )}

                  {barPanel === 'more' && (
                    <BarPopover>
                      <MenuItem onClick={() => { copyLink(); setBarPanel(null) }}>
                        <Copy className="h-4 w-4" /> {copied ? 'Link copied' : 'Copy invite link'}
                      </MenuItem>
                      <div className="my-1 h-px bg-white/10" />
                      <PopoverHeading>Keyboard shortcuts</PopoverHeading>
                      <ShortcutRow keys="Ctrl / ⌘ + D" label="Toggle mic" />
                      <ShortcutRow keys="Ctrl / ⌘ + E" label="Toggle camera" />
                    </BarPopover>
                  )}

                  <ControlItem
                    icon={audioOn ? <Mic /> : <MicOff />}
                    label="Mic"
                    value={audioOn ? 'On' : 'Off'}
                    valueClass={audioOn ? undefined : 'text-[#FCA5A5]'}
                    active={audioOn}
                    danger={!audioOn}
                    onClick={toggleAudio}
                    disabled={permState !== PERM.granted}
                    extra={audioOn && permState === PERM.granted ? <AudioMeter level={audioLevel} /> : null}
                  />
                  <ControlItem
                    icon={videoOn ? <Video /> : <CameraOff />}
                    label="Camera"
                    value={videoOn ? 'On' : 'Off'}
                    valueClass={videoOn ? undefined : 'text-[#FCA5A5]'}
                    active={videoOn}
                    danger={!videoOn}
                    onClick={toggleVideo}
                    disabled={permState !== PERM.granted}
                  />
                  <span className="mx-1 h-8 w-px bg-white/10" />
                  <ControlItem
                    icon={<Monitor />}
                    label="Devices"
                    value="All good"
                    valueClass="text-[#34D399]"
                    onClick={() => { setBarPanel(null); setDevicesOpen((v) => !v) }}
                  />
                  <ControlItem
                    icon={<Sparkles />}
                    label="Effects"
                    value={bgEffect.type === 'none' ? 'None' : bgEffect.name}
                    active={bgEffect.type !== 'none'}
                    onClick={() => setBarPanel((p) => (p === 'effects' ? null : 'effects'))}
                  />
                  <ControlItem
                    icon={<MoreHorizontal />}
                    label="More"
                    hasChevron={false}
                    onClick={() => setBarPanel((p) => (p === 'more' ? null : 'more'))}
                  />
                </div>

                <div className="flex items-center gap-2.5 rounded-2xl bg-white/95 px-3.5 py-2 text-[12.5px] shadow-[0_10px_30px_-14px_rgba(0,0,0,0.5)] backdrop-blur">
                  <SignalBars />
                  <span className="font-semibold text-[#111827]">Strong connection</span>
                  <span className="font-medium text-[#059669]">HD available</span>
                  <span className="ml-auto hidden text-[#6B7280] sm:inline">Your network supports high quality video.</span>
                  <Info className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" />
                </div>
              </div>
            </div>
          </section>

          {/* ── Right: meeting info card ───────────────────────────── */}
          <aside className="zk-themed min-w-0 rounded-[24px] border border-[var(--c-line)] bg-[var(--c-surface)] p-5 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.3)] sm:p-6">
            {meeting ? (
              <h1 className="text-[24px] font-bold leading-tight tracking-tight text-[var(--c-fg)] sm:text-[26px]">
                {meeting.title || 'Meeting'}
              </h1>
            ) : (
              <div className="skeleton h-8 w-3/4 rounded-lg" aria-hidden="true" />
            )}

            {/* Host + live waiting-room count (polled; real pending count) */}
            <div className="mt-4 flex items-center gap-3">
              <Avatar name={hostName} src={meeting?.host_avatar_url} size="md" />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-[var(--c-fg)]">Host: {hostName}</div>
                <div className="mt-0.5 inline-flex items-center gap-1.5 text-[12.5px] text-[var(--c-fg-muted)]">
                  <Users className="h-3.5 w-3.5" />
                  {waitingCount > 0
                    ? `${waitingCount} ${waitingCount === 1 ? 'person' : 'people'} waiting`
                    : 'No one waiting yet'}
                </div>
              </div>
            </div>

            {meeting?.description && (
              <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--c-fg-muted)]">{meeting.description}</p>
            )}

            <div className="my-4 h-px bg-[var(--c-line)]" />

            {/* Confidential Mode */}
            <div className="relative rounded-2xl bg-[var(--lobby-accent-tint)] p-4 ring-1 ring-[var(--lobby-accent-line)]">
              <Info className="absolute right-3 top-3 h-4 w-4 text-[var(--lobby-accent-fg)]" />
              <div className="flex items-start gap-2.5">
                <Lock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--lobby-accent-fg)]" />
                <div className="pr-5">
                  <div className="text-[14px] font-bold text-[var(--lobby-accent-fg)]">Confidential Mode</div>
                  <div className="mt-1 text-[12.5px] leading-relaxed text-[var(--c-fg-dim)]">
                    End-to-end encrypted. AI notes, cloud recording, and phone dial-in are disabled.
                  </div>
                </div>
              </div>
            </div>

            {meeting?.scheduled_at && (
              <div className="mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3 py-1.5 text-[12.5px] text-[var(--c-fg-dim)]">
                <Calendar className="h-3.5 w-3.5 text-[var(--lobby-accent-fg)]" />
                {new Date(meeting.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                {meeting.timezone_name ? ` · ${meeting.timezone_name}` : ''}
              </div>
            )}

            {/* Scheduled-start countdown */}
            {showCountdown && (
              <div className="mt-4 rounded-2xl border border-[var(--lobby-accent-line)] bg-[var(--lobby-accent-tint)] p-4 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--lobby-accent-fg)]">Meeting starts in</div>
                <div className="mt-1.5 font-mono text-[30px] font-bold leading-none tabular-nums text-[var(--c-fg)]">
                  {formatCountdown(msToStart)}
                </div>
                <div className="mt-1.5 text-[12px] text-[var(--c-fg-muted)]">
                  {notYetOpen
                    ? 'You can join from 5 minutes before the start time.'
                    : isHost
                      ? 'You can open the room now — attendees can join too.'
                      : 'Join is open — come on in.'}
                </div>
              </div>
            )}

            {/* Guest display-name entry */}
            {isGuest && (
              <div className="mt-4">
                <label htmlFor="guest-name" className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[var(--c-fg-muted)]">
                  Your name
                </label>
                <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-1)] px-3 py-2.5 focus-within:border-[var(--lobby-accent)] focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--lobby-accent)_35%,transparent)]">
                  <UserIcon className="h-4 w-4 shrink-0 text-[var(--c-fg-muted)]" />
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
                    className="min-w-0 flex-1 bg-transparent text-sm text-[var(--c-fg)] outline-none placeholder:text-[var(--c-fg-muted)]"
                  />
                </div>
                {nameError && (
                  <p id="guest-name-error" role="alert" className="mt-1.5 text-[12px] font-medium text-[var(--c-danger)]">{nameError}</p>
                )}
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--c-fg-muted)]">
                  <input
                    type="checkbox"
                    checked={rememberName}
                    onChange={(e) => setRememberName(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--c-line-strong)] text-[var(--lobby-accent)] focus:ring-[color-mix(in_srgb,var(--lobby-accent)_45%,transparent)]"
                  />
                  Remember my name on this device
                </label>
              </div>
            )}

            {needsPassword && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-1)] px-3 py-2.5 focus-within:border-[var(--lobby-accent)] focus-within:ring-2 focus-within:ring-[color-mix(in_srgb,var(--lobby-accent)_35%,transparent)]">
                <Lock className="h-4 w-4 shrink-0 text-[var(--c-fg-muted)]" />
                <input
                  type="password"
                  placeholder="Enter meeting password"
                  value={meetingPwd}
                  onChange={(e) => setMeetingPwd(e.target.value)}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent text-sm text-[var(--c-fg)] outline-none placeholder:text-[var(--c-fg-muted)]"
                />
              </div>
            )}

            {meeting?.waiting_room_enabled && (isGuest || meeting?.host_id !== user?.id) && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[var(--lobby-warn-line)] bg-[var(--lobby-warn-tint)] p-3 text-[12.5px] text-[var(--c-fg-dim)]">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lobby-warn-fg)]" />
                <span>This meeting uses a waiting room — the host will let you in.</span>
              </div>
            )}

            {err && (
              <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--c-danger)_40%,transparent)] bg-[var(--c-danger-soft)] p-3 text-[12.5px] text-[var(--c-fg-dim)]">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-danger)]" />
                <span className="font-medium">{err}</span>
              </div>
            )}

            {/* Join */}
            <button
              onClick={join}
              disabled={joinDisabled}
              aria-busy={joining}
              className="zk-press zk-sheen mt-4 flex h-14 w-full items-center justify-between rounded-2xl bg-gradient-to-r from-[#6D28D9] to-[#7C3AED] px-6 text-[15px] font-semibold text-white shadow-[0_16px_36px_-14px_rgba(124,58,237,0.7)] transition hover:from-[#5B21B6] hover:to-[#6D28D9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--c-surface)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <span className="flex items-center gap-2">
                {joining && <Loader2 className="h-[18px] w-[18px] animate-spin" />}
                {joining ? 'Joining…' : 'Join meeting'}
              </span>
              {!joining && <ArrowRight className="h-5 w-5" />}
            </button>

            {/* Options */}
            <button
              type="button"
              onClick={() => setDevicesOpen((v) => !v)}
              aria-expanded={devicesOpen}
              className="zk-press mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[var(--c-line)] bg-[var(--c-surface)] text-[14px] font-semibold text-[var(--c-fg-dim)] transition hover:bg-[var(--c-bg-3)]"
            >
              <Settings className="h-4 w-4" /> Options
              <ChevronDown className={'h-4 w-4 transition-transform ' + (devicesOpen ? 'rotate-180' : '')} />
            </button>

            {devicesOpen && (
              <div className="mt-3 space-y-2.5 rounded-2xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3">
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
            )}

            <div className="mt-2 text-center text-[12px] text-[var(--c-fg-muted)]">audio only · present · dial in</div>

            {/* Stat tiles */}
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-line)] sm:grid-cols-4">
              <StatTile icon={<Sparkles />} iconClass="text-[var(--lobby-accent-fg)]" label="AI notes" value="Off · E2EE" />
              <StatTile icon={<Circle />} iconClass="text-[var(--lobby-success-fg)]" label="Recording" value="Off" />
              <StatTile icon={<Users />} iconClass="text-[var(--lobby-warn-fg)]" label="Guests" value="1 external" />
              <StatTile icon={<ShieldCheck />} iconClass="text-[var(--lobby-success-fg)]" label="Admission" value="Not required" />
            </div>

            <button
              type="button"
              onClick={copyLink}
              className="zk-press mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-transparent bg-transparent text-[12.5px] font-medium text-[var(--c-fg-muted)] shadow-none transition hover:bg-[var(--c-bg-3)] hover:text-[var(--lobby-accent-fg)]"
            >
              {copied ? <><Check className="h-3.5 w-3.5" /> Link copied</> : <><Copy className="h-3.5 w-3.5" /> Copy invite link</>}
            </button>
            <span className="sr-only" role="status" aria-live="polite">{copied ? 'Meeting link copied to clipboard' : ''}</span>
          </aside>
        </div>

      </div>
    </Shell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

// Guard used in a field initializer above where `isHost` isn't computed yet.
function isHostSafe(user, meeting) {
  return !!(user && meeting && meeting.host_id === user.id)
}

function Shell({ user, meeting, children }) {
  return (
    <div className="zk-lobby relative flex min-h-dvh flex-col bg-[var(--c-bg)] text-[var(--c-fg)]">
      <header
        className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-[var(--c-line)] bg-[color-mix(in_srgb,var(--c-surface)_88%,transparent)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] backdrop-blur-xl sm:px-6"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <Logo size={32} withWordmark />
          {meeting && (
            <div className="hidden min-w-0 border-l border-[var(--c-line)] pl-3 sm:block sm:pl-5">
              <div className="truncate text-[15px] font-bold text-[var(--c-fg)]">{meeting.title || 'Meeting'}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[var(--c-fg-muted)]">
                <span className="inline-flex items-center gap-1">
                  Zoiko Tech Workspace <ShieldCheck className="h-3.5 w-3.5 text-[var(--lobby-success-fg)]" />
                </span>
                <span className="rounded-md bg-[var(--lobby-accent-tint)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--lobby-accent-fg)]">Managed by Zoiko Group</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2.5 sm:gap-4">
          <ThemeToggle />
          <button type="button" className="hidden h-9 items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3.5 text-[13px] font-medium text-[var(--c-fg-dim)] shadow-none transition hover:border-[var(--c-line-strong)] hover:text-[var(--c-fg)] sm:inline-flex">
            <HelpCircle className="h-4 w-4" /> Help
          </button>
          {user && (
            <div className="flex items-center gap-2">
              <Avatar name={user.name} src={user.avatar_url} color={user.avatar_color} size="sm" />
              <div className="hidden leading-tight sm:block">
                <div className="text-[13px] font-semibold text-[var(--c-fg)]">{user.name}</div>
                <div className="text-[11.5px] text-[var(--c-fg-muted)]">{user.email}</div>
              </div>
              <ChevronDown className="hidden h-4 w-4 text-[var(--c-fg-muted)] sm:block" />
            </div>
          )}
        </div>
      </header>
      <main className="relative flex flex-1 flex-col items-center px-3 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}

// One control in the in-preview bar: circular glyph + label/value stack. On
// mobile the label collapses to just the glyph. `active` = white fill (like
// image 2's "Mic On"); otherwise a translucent dark chip.
function ControlItem({ icon, label, value, valueClass, active, danger, onClick, disabled, hasChevron = true, extra }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // bg-transparent/border-0/shadow-none override the global `button{}` base
      // (background: var(--c-bg-1)) which otherwise paints these white in light mode.
      className="group flex items-center gap-2 rounded-xl border-0 bg-transparent px-2 py-1.5 text-left shadow-none transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-full [&_svg]:h-[18px] [&_svg]:w-[18px]',
        active ? 'bg-white text-[#0A0F1A]'
          : danger ? 'bg-[#EF4444] text-white'
          : 'bg-white/15 text-white ring-1 ring-inset ring-white/15',
      )}>{icon}</span>
      <span className="hidden leading-tight sm:block">
        <span className="block text-[12.5px] font-semibold text-white">{label}</span>
        {(value || extra) && (
          <span className={cn('flex items-center gap-1 text-[11px]', valueClass || 'text-white/55')}>
            {extra}{value}{hasChevron && value && <ChevronDown className="h-3 w-3" />}
          </span>
        )}
      </span>
    </button>
  )
}

// Tiny live input meter shown inside the Mic control while unmuted.
function AudioMeter({ level }) {
  return (
    <span aria-hidden="true" className="flex h-3 items-end gap-0.5">
      {Array.from({ length: 4 }).map((_, i) => {
        const active = level >= ((i + 1) / 4) * 0.9
        return (
          <span
            key={i}
            style={{ height: `${4 + i * 2}px`, opacity: active ? 1 : 0.3 }}
            className="w-0.5 rounded-full bg-[#34D399]"
          />
        )
      })}
    </span>
  )
}

// Dark popover anchored above the in-preview control bar (Effects / More).
function BarPopover({ children }) {
  return (
    <div className="absolute bottom-[calc(100%+10px)] left-0 z-10 w-56 rounded-2xl bg-[#111827] p-1.5 text-white shadow-[0_20px_50px_-16px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
      {children}
    </div>
  )
}

function PopoverHeading({ children }) {
  return <div className="px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/40">{children}</div>
}

// Google-Meet-style background picker anchored above the control bar. Reuses
// the shared presets so the pre-join choice matches exactly what the call
// applies. Thumbnails are the same generated SVG scenes — zero extra assets.
function BackgroundPopover({ activeId, onSelect, supported }) {
  if (!supported) {
    return (
      <BarPopover>
        <PopoverHeading>Backgrounds</PopoverHeading>
        <div className="px-2.5 pb-2 pt-1 text-[12px] leading-snug text-white/60">
          Background effects aren’t supported on this browser. Try Chrome, Edge, or Safari.
        </div>
      </BarPopover>
    )
  }
  return (
    <div className="absolute bottom-[calc(100%+10px)] left-0 z-10 max-h-[min(70vh,360px)] w-[300px] overflow-y-auto rounded-2xl bg-[#111827] p-3 text-white shadow-[0_20px_50px_-16px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
      <PopoverHeading>Blur</PopoverHeading>
      <div className="grid grid-cols-3 gap-2">
        <BgTile preset={NONE_EFFECT} active={activeId === 'none'} onSelect={onSelect} />
        {BLUR_PRESETS.map((p) => (
          <BgTile key={p.id} preset={p} active={activeId === p.id} onSelect={onSelect} />
        ))}
      </div>

      <PopoverHeading>Backgrounds</PopoverHeading>
      <div className="grid grid-cols-3 gap-2">
        {IMAGE_PRESETS.map((p) => (
          <BgTile key={p.id} preset={p} active={activeId === p.id} onSelect={onSelect} />
        ))}
      </div>

      <PopoverHeading>Filters</PopoverHeading>
      <div className="grid grid-cols-3 gap-2">
        {FILTER_PRESETS.map((p) => (
          <BgTile key={p.id} preset={p} active={activeId === p.id} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function BgTile({ preset, active, onSelect }) {
  const isImage = preset.type === 'image'
  return (
    <button
      type="button"
      onClick={() => onSelect(preset.id)}
      aria-label={preset.name}
      aria-pressed={active}
      title={preset.name}
      className={cn(
        'group relative aspect-square overflow-hidden rounded-lg border-0 bg-white/10 p-0 shadow-none ring-1 ring-inset transition',
        active ? 'ring-2 ring-[#8B5CF6]' : 'ring-white/10 hover:ring-white/30',
      )}
      style={isImage ? { backgroundImage: `url("${preset.src}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      {preset.type === 'none' && (
        <span className="grid h-full w-full place-items-center text-[10px] font-semibold text-white/70">None</span>
      )}
      {preset.type === 'blur' && (
        <span className="grid h-full w-full place-items-center bg-[radial-gradient(120%_120%_at_30%_20%,#3b4763,#1b2740)] text-[9.5px] font-semibold text-white/80 backdrop-blur">
          {preset.name}
        </span>
      )}
      {preset.type === 'filter' && (
        <span className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,#6D28D9,#7C3AED)] px-1 text-center text-[9.5px] font-semibold leading-tight text-white">
          {preset.name}
        </span>
      )}
      {active && (
        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-[#8B5CF6] text-white ring-2 ring-[#111827]">
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  )
}

function MenuItem({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xl border-0 bg-transparent px-2.5 py-2 text-left text-[13px] font-medium text-white/90 shadow-none transition hover:bg-white/10"
    >
      <span className="flex flex-1 items-center gap-2">{children}</span>
      {active && <Check className="h-4 w-4 text-[#34D399]" />}
    </button>
  )
}

function ShortcutRow({ keys, label }) {
  return (
    <div className="flex items-center justify-between px-2.5 py-1.5 text-[12px] text-white/70">
      <span>{label}</span>
      <span className="font-mono text-[11px] text-white/45">{keys}</span>
    </div>
  )
}

function SignalBars() {
  return (
    <span aria-hidden="true" className="flex items-end gap-0.5">
      {[6, 9, 12, 15].map((h, i) => (
        <span key={i} style={{ height: `${h}px` }} className="w-1 rounded-sm bg-[#10B981]" />
      ))}
    </span>
  )
}

function StatTile({ icon, iconClass, label, value }) {
  return (
    <div className="bg-[var(--c-surface)] px-3 py-3 text-center">
      <div className={cn('mx-auto grid h-6 w-6 place-items-center [&_svg]:h-4 [&_svg]:w-4', iconClass)}>{icon}</div>
      <div className="mt-1.5 text-[12px] font-semibold text-[var(--c-fg-dim)]">{label}</div>
      <div className="text-[11px] text-[var(--c-fg-muted)]">{value}</div>
    </div>
  )
}

function PermError({ icon, title, detail, onRetry }) {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center text-white">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.08] ring-1 ring-white/10">{icon}</div>
      <div>
        <div className="text-[14.5px] font-semibold">{title}</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-white/60">{detail}</div>
      </div>
      <button
        onClick={onRetry}
        className="zk-press rounded-full bg-white/10 px-4 py-2 text-[12.5px] font-semibold text-[#C4B5FD] ring-1 ring-white/15 transition hover:bg-white/15"
      >Retry</button>
    </div>
  )
}

function DevicePicker({ label, icon, devices, value, onChange, disabled, fallbackLabel }) {
  const current = devices.find((d) => d.deviceId === value)
  const display = current?.label || devices[0]?.label || fallbackLabel
  return (
    <label
      className={cn(
        'group relative flex h-12 cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface)] px-3',
        disabled && 'pointer-events-none cursor-not-allowed opacity-50',
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--lobby-accent-tint)] text-[var(--lobby-accent-fg)]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--c-fg-muted)]">{label}</div>
        <div className="truncate text-[13px] font-medium text-[var(--c-fg-dim)]">{display}</div>
      </div>
      <ChevronDown className="h-4 w-4 shrink-0 text-[var(--c-fg-muted)]" />
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
