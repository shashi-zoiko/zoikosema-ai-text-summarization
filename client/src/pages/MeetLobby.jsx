import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Calendar, Camera, CameraOff, Check, ChevronDown, Clock, Copy, FlipHorizontal,
  Image as ImageIcon, Info, Link as LinkIcon, Loader2, Lock, Mic, MicOff,
  Monitor, ShieldCheck, Sparkles, Sun, Video, Waves, X,
} from 'lucide-react'
import { api, getWsBase } from '../api/client'
import { useAuth } from '../context/AuthContext'
import useMediaDevices from '../hooks/useMediaDevices'
import useAudioLevel from '../hooks/useAudioLevel'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import IconButton from '../components/ui/IconButton'
import Badge from '../components/ui/Badge'
import Logo from '../components/ui/Logo'
import Avatar from '../components/ui/Avatar'
import Spinner from '../components/ui/Spinner'
import ThemeToggle from '../components/ui/ThemeToggle'
import { useToast } from '../components/ui/Toast'
import { cn } from '../lib/cn'
import { fadeUp } from '../lib/motion'

const PERM = {
  pending: 'pending',
  granted: 'granted',
  denied: 'denied',
  unavailable: 'unavailable',
}

export default function MeetLobby() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()

  // ── Refs ────────────────────────────────────────────────────────────
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const wsRef = useRef(null)

  // ── Meeting metadata ───────────────────────────────────────────────
  const [meeting, setMeeting] = useState(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [meetingPwd, setMeetingPwd] = useState('')
  const [err, setErr] = useState('')

  // ── Camera state ───────────────────────────────────────────────────
  const [audioOn, setAudioOn] = useState(true)
  const [videoOn, setVideoOn] = useState(true)
  const [permState, setPermState] = useState(PERM.pending)
  const [permDetail, setPermDetail] = useState('')
  const [hd, setHd] = useState(true)
  const [mirror, setMirror] = useState(true)
  const [bgMode, setBgMode] = useState('none') // 'none' | 'blur-light' | 'blur-heavy'

  const [stream, setStream] = useState(null)

  // ── Devices ────────────────────────────────────────────────────────
  const { devices, audioDeviceId, setAudioDeviceId, videoDeviceId, setVideoDeviceId, refresh: refreshDevices } = useMediaDevices()
  const [showDeviceMenu, setShowDeviceMenu] = useState(null) // 'audio' | 'video' | null

  // ── Waiting room / join ────────────────────────────────────────────
  const [waitingStatus, setWaitingStatus] = useState(null)
  const [copied, setCopied] = useState(false)

  // ── Audio level (live mic meter) ───────────────────────────────────
  const audioLevel = useAudioLevel(stream, audioOn && permState === PERM.granted)

  // ── Fetch meeting metadata ─────────────────────────────────────────
  useEffect(() => {
    api(`/api/meetings/${code}`)
      .then((m) => {
        setMeeting(m)
        if (m.password_protected && m.host_id !== user?.id) setNeedsPassword(true)
      })
      .catch((e) => setErr(e.message || 'Meeting not found'))
  }, [code, user?.id])

  // ── Camera lifecycle ───────────────────────────────────────────────
  // Re-acquired whenever the user toggles HD or switches devices.
  const acquire = useCallback(async () => {
    setPermState((s) => (s === PERM.granted ? s : PERM.pending))

    // Stop any existing tracks first to avoid "device busy" errors.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
      },
      video: {
        ...(hd
          ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
          : { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } }),
        ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}),
      },
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermState(PERM.unavailable)
        setPermDetail('Your browser does not support camera access. Try Chrome, Edge, or Firefox.')
        return
      }
      const next = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = next
      // Apply current enabled flags from React state
      next.getAudioTracks().forEach((t) => (t.enabled = audioOn))
      next.getVideoTracks().forEach((t) => (t.enabled = videoOn))
      if (videoRef.current) videoRef.current.srcObject = next
      setStream(next)
      setPermState(PERM.granted)
      setPermDetail('')
      // Once granted, labels become available — refresh device list.
      refreshDevices()
    } catch (e) {
      const name = e?.name || ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setPermState(PERM.denied)
        setPermDetail('Camera & microphone access were blocked. Click the lock icon in your browser address bar to allow them.')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setPermState(PERM.unavailable)
        setPermDetail('No camera or microphone detected. Plug one in and click Retry.')
      } else if (name === 'NotReadableError') {
        setPermState(PERM.unavailable)
        setPermDetail('Your camera is in use by another application. Close it and click Retry.')
      } else {
        setPermState(PERM.denied)
        setPermDetail(e?.message || 'Could not access camera or microphone.')
      }
      setStream(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hd, audioDeviceId, videoDeviceId, refreshDevices])

  // Initial acquire on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => { if (!cancelled) await acquire() })()
    return () => {
      cancelled = true
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      setStream(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hd, audioDeviceId, videoDeviceId])

  useEffect(() => () => {
    if (wsRef.current) { try { wsRef.current.close() } catch {}; wsRef.current = null }
  }, [])

  // ── Toggle controls ────────────────────────────────────────────────
  const toggleAudio = () => {
    if (!streamRef.current) return
    const next = !audioOn
    streamRef.current.getAudioTracks().forEach((t) => (t.enabled = next))
    setAudioOn(next)
  }
  const toggleVideo = () => {
    if (!streamRef.current) return
    const next = !videoOn
    streamRef.current.getVideoTracks().forEach((t) => (t.enabled = next))
    setVideoOn(next)
  }

  // ── Join meeting ───────────────────────────────────────────────────
  const join = async () => {
    try {
      const joinBody = { code }
      if (needsPassword) joinBody.password = meetingPwd
      const participant = await api(`/api/meetings/${code}/join`, { method: 'POST', body: joinBody })
      sessionStorage.setItem(
        `zoiko_meet_prefs_${code}`,
        JSON.stringify({ audio: audioOn, video: videoOn, hd, mirror, bgMode })
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
            navigate(`/meet/${code}/room`)
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
        navigate(`/meet/${code}/room`)
      }
    } catch (e) {
      toast({ variant: 'error', title: 'Could not join', description: e.message })
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
      setTimeout(() => setCopied(false), 1800)
    } catch {}
  }

  const blurClassName = useMemo(() => {
    if (bgMode === 'blur-light') return 'blur-[8px] saturate-110'
    if (bgMode === 'blur-heavy') return 'blur-[16px] saturate-125'
    return ''
  }, [bgMode])

  // ─────────────────────────────────────────────────────────────────
  // Waiting room view
  // ─────────────────────────────────────────────────────────────────
  if (waitingStatus === 'pending') {
    return (
      <LobbyChrome>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto w-full max-w-md rounded-3xl border border-[var(--c-line-strong)] bg-[color-mix(in_srgb,var(--c-surface)_88%,transparent)] p-8 text-center backdrop-blur-xl shadow-[0_40px_80px_-20px_rgba(0,0,0,0.45)]"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl gradient-accent shadow-[0_10px_30px_-10px_var(--c-accent-ring)]">
            <Loader2 className="h-7 w-7 animate-spin text-white" />
          </div>
          <h2 className="mt-5 text-[20px] font-bold tracking-tight">Waiting for the host</h2>
          <p className="mt-2 text-[13px] text-[var(--c-fg-muted)] leading-relaxed">
            You'll join automatically once they let you in. Stick around — this usually takes a few seconds.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3 py-1.5 text-[11.5px]">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--c-success)]" />
            <span className="text-[var(--c-fg-muted)]">Code</span>
            <span className="mono font-semibold">{code}</span>
          </div>
          <div className="mt-6">
            <Button variant="outline" size="lg" onClick={cancelWaiting}>Cancel</Button>
          </div>
        </motion.div>
      </LobbyChrome>
    )
  }

  // ─────────────────────────────────────────────────────────────────
  // Main lobby
  // ─────────────────────────────────────────────────────────────────
  return (
    <LobbyChrome>
      <div className="grid w-full max-w-[1240px] gap-6 lg:grid-cols-[1.4fr_1fr] xl:gap-8">
        {/* ── Preview ───────────────────────────────────────────── */}
        <motion.div variants={fadeUp} initial="initial" animate="animate" className="relative">
          <div
            className={cn(
              'relative aspect-[16/10] w-full overflow-hidden rounded-3xl border border-[var(--c-line-strong)]',
              'bg-[#05060a] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)]'
            )}
          >
            {/* Video */}
            {permState === PERM.granted && videoOn ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cn(
                  'h-full w-full object-cover transition-[filter] duration-300',
                  mirror && 'scale-x-[-1]',
                  blurClassName
                )}
              />
            ) : (
              <PreviewFallback
                state={permState}
                videoOn={videoOn}
                detail={permDetail}
                onRetry={acquire}
                user={user}
              />
            )}

            {/* Loading overlay (re-acquire) */}
            <AnimatePresence>
              {permState === PERM.pending && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                >
                  <div className="flex flex-col items-center gap-3 text-white">
                    <Spinner size="lg" />
                    <div className="text-[13px] font-medium">Starting camera…</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Name pill */}
            {permState !== PERM.pending && user && (
              <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 backdrop-blur-md">
                <Avatar name={user.name} color={user.avatar_color} size="xs" />
                <span className="text-[12.5px] font-semibold text-white">{user.name}</span>
              </div>
            )}

            {/* HD pill */}
            {permState === PERM.granted && videoOn && (
              <div className="pointer-events-none absolute top-4 left-4 flex items-center gap-1.5 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-bold tracking-wider text-white backdrop-blur-md">
                {hd ? 'HD · 720p' : 'SD · 360p'}
              </div>
            )}

            {/* Audio meter */}
            {permState === PERM.granted && (
              <div className="pointer-events-none absolute top-4 right-4 flex items-center gap-2 rounded-md border border-white/10 bg-black/40 px-2 py-1 backdrop-blur-md">
                <span className={cn('flex h-4 w-4 items-center justify-center rounded-full', audioOn ? 'text-white' : 'text-red-400')}>
                  {audioOn ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
                </span>
                <AudioLevelBars level={audioOn ? audioLevel : 0} />
              </div>
            )}

            {/* Control dock */}
            <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
              <div className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-black/55 p-1.5 backdrop-blur-xl shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)]">
                <IconButton
                  variant={audioOn ? 'glass' : 'toggleDanger'}
                  size="lg"
                  onClick={toggleAudio}
                  label={audioOn ? 'Mute microphone' : 'Unmute microphone'}
                  shortcut="⌘ D"
                  disabled={permState !== PERM.granted}
                >
                  {audioOn ? <Mic /> : <MicOff />}
                </IconButton>
                <IconButton
                  variant={videoOn ? 'glass' : 'toggleDanger'}
                  size="lg"
                  onClick={toggleVideo}
                  label={videoOn ? 'Turn camera off' : 'Turn camera on'}
                  shortcut="⌘ E"
                  disabled={permState !== PERM.granted}
                >
                  {videoOn ? <Video /> : <CameraOff />}
                </IconButton>
                <span className="mx-1 h-7 w-px bg-white/10" />
                <IconButton
                  variant="glass"
                  size="lg"
                  onClick={() => setMirror((v) => !v)}
                  label={mirror ? 'Mirror: on' : 'Mirror: off'}
                  className={cn(mirror && 'ring-1 ring-white/20')}
                >
                  <FlipHorizontal />
                </IconButton>
                <IconButton
                  variant="glass"
                  size="lg"
                  onClick={() => setHd((v) => !v)}
                  label={hd ? 'HD: on' : 'HD: off'}
                  className={cn(hd && 'ring-1 ring-white/20')}
                >
                  <Sun />
                </IconButton>
                <IconButton
                  variant="glass"
                  size="lg"
                  onClick={() => setBgMode(bgMode === 'none' ? 'blur-light' : bgMode === 'blur-light' ? 'blur-heavy' : 'none')}
                  label={
                    bgMode === 'none' ? 'Background: off'
                    : bgMode === 'blur-light' ? 'Background: light blur'
                    : 'Background: heavy blur'
                  }
                  className={cn(bgMode !== 'none' && 'ring-1 ring-white/20')}
                >
                  <Waves />
                </IconButton>
              </div>
            </div>
          </div>

          {/* Device pickers */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <DevicePicker
              label="Microphone"
              icon={<Mic className="h-3.5 w-3.5" />}
              devices={devices.audio}
              value={audioDeviceId}
              onChange={setAudioDeviceId}
              disabled={permState !== PERM.granted}
              fallbackLabel="Default microphone"
            />
            <DevicePicker
              label="Camera"
              icon={<Camera className="h-3.5 w-3.5" />}
              devices={devices.video}
              value={videoDeviceId}
              onChange={setVideoDeviceId}
              disabled={permState !== PERM.granted}
              fallbackLabel="Default camera"
            />
          </div>
        </motion.div>

        {/* ── Join panel ───────────────────────────────────────── */}
        <motion.aside
          variants={fadeUp}
          initial="initial"
          animate="animate"
          className="relative overflow-hidden rounded-3xl border border-[var(--c-line-strong)] bg-[color-mix(in_srgb,var(--c-surface)_82%,transparent)] p-7 backdrop-blur-xl shadow-[0_40px_80px_-20px_rgba(0,0,0,0.45)]"
        >
          <div
            aria-hidden
            className="absolute inset-x-0 -top-px h-px"
            style={{ background: 'linear-gradient(90deg, transparent, var(--c-accent), transparent)' }}
          />
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-bg-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--c-fg-muted)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--c-accent)]" />
            Meeting · <span className="mono ml-1 text-[var(--c-fg)]">{code}</span>
          </div>
          <h1 className="mt-3 text-[26px] font-bold leading-tight tracking-tight">
            {meeting?.title || 'Ready to join?'}
          </h1>
          {user && (
            <p className="mt-1.5 text-[13.5px] text-[var(--c-fg-muted)]">
              Joining as <strong className="text-[var(--c-fg)]">{user.name}</strong>
            </p>
          )}

          {meeting?.scheduled_at && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3 py-2 text-[12.5px]">
              <Calendar className="h-3.5 w-3.5 text-[var(--c-accent)]" />
              <span className="text-[var(--c-fg-dim)]">
                {new Date(meeting.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                {meeting.timezone_name ? ` · ${meeting.timezone_name}` : ''}
              </span>
            </div>
          )}

          {meeting?.waiting_room_enabled && meeting?.host_id !== user?.id && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[var(--c-warn)]/25 bg-[var(--c-warn-soft)] p-3 text-[12.5px] text-[var(--c-warn)]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>This meeting has a waiting room — the host will let you in.</span>
            </div>
          )}

          {needsPassword && (
            <div className="mt-4">
              <Input
                type="password"
                placeholder="Enter meeting password"
                value={meetingPwd}
                onChange={(e) => setMeetingPwd(e.target.value)}
                leftIcon={<Lock />}
                autoComplete="off"
              />
            </div>
          )}

          {err && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[var(--c-danger)]/30 bg-[var(--c-danger-soft)] p-3 text-[12.5px] text-[var(--c-danger)]">
              <X className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="font-medium">{err}</span>
            </div>
          )}

          {/* Share link */}
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-2 pl-3">
            <LinkIcon className="h-3.5 w-3.5 shrink-0 text-[var(--c-fg-muted)]" />
            <code className="mono flex-1 truncate text-[12px] text-[var(--c-fg-dim)]">
              {`${window.location.origin}/meet/${code}`}
            </code>
            <button
              onClick={copyLink}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11.5px] font-semibold transition',
                copied
                  ? 'border-[var(--c-success)] bg-[var(--c-success-soft)] text-[var(--c-success)]'
                  : 'border-[var(--c-line)] bg-[var(--c-bg-1)] text-[var(--c-fg-dim)] hover:border-[var(--c-line-strong)] hover:text-[var(--c-fg)]'
              )}
            >
              {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
            </button>
          </div>

          {/* Actions */}
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <Button
              size="lg"
              block
              onClick={join}
              disabled={!meeting || (needsPassword && !meetingPwd) || permState === PERM.pending}
              asMotion
              leftIcon={<Video className="h-4 w-4" />}
            >
              Join now
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/')}>Cancel</Button>
          </div>

          {/* Tips */}
          <div className="mt-6 space-y-2 border-t border-[var(--c-line)] pt-5">
            <Tip icon={<ShieldCheck />}>Peer-to-peer video — streams go directly between devices.</Tip>
            <Tip icon={<Waves />}>HD video with noise suppression and adaptive quality.</Tip>
            <Tip icon={<Sparkles />}>AI captions and recap generated locally during the call.</Tip>
          </div>
        </motion.aside>
      </div>
    </LobbyChrome>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

function LobbyChrome({ children }) {
  return (
    <div className="relative isolate flex min-h-screen flex-col bg-[var(--c-bg)] text-[var(--c-fg)]">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="grid-pattern absolute inset-0 opacity-30" />
        <div
          className="absolute -top-32 -left-40 h-[440px] w-[440px] rounded-full opacity-40 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, var(--c-accent), transparent)' }}
        />
        <div
          className="absolute -bottom-40 right-0 h-[480px] w-[480px] rounded-full opacity-35 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, var(--c-accent-3), transparent)' }}
        />
      </div>
      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <Logo size={36} withWordmark />
        <div className="flex items-center gap-2.5">
          <Badge tone="neutral" size="md">
            <Clock className="h-3 w-3" />
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Badge>
          <ThemeToggle />
        </div>
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-12 pt-2 sm:px-10">
        {children}
      </main>
    </div>
  )
}

function AudioLevelBars({ level }) {
  // 7 bars, each lights up at successive thresholds. Hot tail goes red.
  return (
    <div className="audio-meter h-3.5 text-white">
      {Array.from({ length: 7 }).map((_, i) => {
        const threshold = (i + 1) / 7
        const active = level >= threshold * 0.9
        const height = active ? 4 + i * 1.2 : 3
        const hot = i >= 5
        return (
          <span
            key={i}
            style={{ height: `${height}px`, opacity: active ? 1 : 0.25 }}
            className={cn(hot && active ? 'text-[var(--c-warn)]' : '')}
          />
        )
      })}
    </div>
  )
}

function PreviewFallback({ state, videoOn, detail, onRetry, user }) {
  if (state === PERM.denied) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-white">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/20 ring-1 ring-red-500/30">
          <CameraOff className="h-7 w-7 text-red-300" />
        </div>
        <div>
          <div className="text-[14.5px] font-semibold">Camera access blocked</div>
          <div className="mx-auto mt-1 max-w-[360px] text-[12.5px] text-white/65 leading-relaxed">{detail}</div>
        </div>
        <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
      </div>
    )
  }
  if (state === PERM.unavailable) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-white">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/8 ring-1 ring-white/12">
          <Monitor className="h-7 w-7 text-white/80" />
        </div>
        <div>
          <div className="text-[14.5px] font-semibold">No camera detected</div>
          <div className="mx-auto mt-1 max-w-[360px] text-[12.5px] text-white/65 leading-relaxed">{detail}</div>
        </div>
        <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
      </div>
    )
  }
  // Camera off but permission granted — show large avatar placeholder
  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(closest-side,rgba(255,255,255,0.06),transparent)]">
      <div className="flex flex-col items-center gap-3">
        <Avatar name={user?.name || ''} color={user?.avatar_color} size="xl" />
        <div className="flex items-center gap-2 text-white/70">
          {videoOn ? <ImageIcon className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
          <span className="text-[12.5px] font-medium">{videoOn ? 'No preview' : 'Camera is off'}</span>
        </div>
      </div>
    </div>
  )
}

function Tip({ icon, children }) {
  return (
    <div className="group/tip flex items-start gap-2.5 text-[12.5px] leading-relaxed text-[var(--c-fg-muted)] transition-colors duration-150 hover:text-[var(--c-fg-dim)]">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--c-bg-3)] text-[var(--c-fg-dim)] transition-all duration-200 group-hover/tip:scale-110 group-hover/tip:bg-[var(--c-accent-soft)] group-hover/tip:text-[var(--c-accent)] [&_svg]:h-3 [&_svg]:w-3">
        {icon}
      </span>
      <span>{children}</span>
    </div>
  )
}

function DevicePicker({ label, icon, devices, value, onChange, disabled, fallbackLabel }) {
  const current = devices.find((d) => d.deviceId === value)
  const display = current?.label || devices[0]?.label || fallbackLabel
  return (
    <label className={cn(
      'group/dp relative flex h-11 cursor-pointer items-center gap-2 overflow-hidden rounded-xl border bg-[var(--c-surface)] px-3 transition-all duration-200',
      'border-[var(--c-line)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--c-accent)_45%,var(--c-line-strong))] hover:shadow-[0_10px_24px_-12px_var(--c-accent-ring)]',
      disabled && 'cursor-not-allowed opacity-50 hover:translate-y-0 hover:shadow-none'
    )}>
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--c-bg-3)] text-[var(--c-fg-dim)] transition-colors duration-200 group-hover/dp:bg-[var(--c-accent-soft)] group-hover/dp:text-[var(--c-accent)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--c-fg-muted)]">{label}</div>
        <div className="truncate text-[12.5px] font-medium text-[var(--c-fg)]">{display}</div>
      </div>
      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--c-fg-muted)] transition-transform duration-200 group-hover/dp:translate-y-0.5 group-hover/dp:text-[var(--c-accent)]" />
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
