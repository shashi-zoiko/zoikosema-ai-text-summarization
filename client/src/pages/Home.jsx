import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { meetingPath, meetingUrl } from '../lib/meetingUrls.js'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, Calendar, Check, ChevronDown, Clock,
  Copy, Download, Link2, Lock, MessageSquareText, Pencil, Plus, Radio, Share2,
  Trash2, Video,
} from 'lucide-react'
import { api, getApiBase } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { fadeUp, stagger } from '../lib/motion'
import { cn } from '../lib/cn'
import Button from '../components/ui/Button'
import { Input, Field } from '../components/ui/Input'
import IconButton from '../components/ui/IconButton'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import { Card } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'

/* ────────────────────────── helpers ────────────────────────── */

function timeAgo(iso) {
  try {
    const d = new Date(iso)
    const mins = Math.floor((new Date() - d) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch { return '' }
}

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatDuration(secs) {
  if (!secs) return '0:00'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/* ────────────────────────── page ────────────────────────── */

/* Single row inside the "New meeting" dropdown. */
function MeetMenuItem({ icon, label, onClick }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="group/mi flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[14px] font-medium text-[var(--c-fg)] transition hover:bg-[var(--c-accent-soft)] hover:text-[var(--c-accent)]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--c-bg-2)] text-[var(--c-fg-dim)] transition-colors group-hover/mi:bg-[var(--c-accent-soft)] group-hover/mi:text-[var(--c-accent)] [&_svg]:h-[18px] [&_svg]:w-[18px]">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate leading-none">{label}</span>
    </button>
  )
}

/* Style-3 emerald button surface, reused by both hero + join CTAs. */
const EMERALD_BTN =
  'bg-[linear-gradient(135deg,#1f7a54_0%,#0f4a34_100%)] ' +
  'shadow-[0_10px_26px_-10px_rgba(16,83,52,0.65)] hover:brightness-[1.06]'

/* Layered mountain/pine scene — the signature visual of Style 3. Pure SVG so
   it scales crisply and ships no image asset. */
function MountainScene() {
  return (
    <svg viewBox="0 0 280 180" className="h-[180px] w-[280px]" role="img" aria-label="Meeting illustration">
      <defs>
        <linearGradient id="zk-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eafaf2" />
          <stop offset="100%" stopColor="#cfeede" />
        </linearGradient>
        <linearGradient id="zk-mtnA" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bfe6d2" />
          <stop offset="100%" stopColor="#9ed4ba" />
        </linearGradient>
        <linearGradient id="zk-mtnB" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#56a883" />
          <stop offset="100%" stopColor="#2f7d5b" />
        </linearGradient>
      </defs>
      <rect width="280" height="180" fill="url(#zk-sky)" />
      <circle cx="208" cy="46" r="20" fill="#ffffff" opacity="0.7" />
      <path d="M0 120 L48 78 L92 112 L140 68 L188 110 L236 74 L280 104 L280 180 L0 180 Z" fill="url(#zk-mtnA)" opacity="0.85" />
      <path d="M138 68 L150 86 L126 86 Z" fill="#eafaf2" opacity="0.9" />
      <path d="M0 150 L44 112 L86 146 L138 100 L186 144 L240 110 L280 138 L280 180 L0 180 Z" fill="url(#zk-mtnB)" />
      {[[38, 152], [60, 158], [212, 150], [234, 157]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path d="M0 -24 L9 2 L-9 2 Z" fill="#1f6f4d" />
          <path d="M0 -15 L7 5 L-7 5 Z" fill="#2a8761" />
          <rect x="-1.5" y="4" width="3" height="6" fill="#3f5a4a" />
        </g>
      ))}
    </svg>
  )
}

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [code, setCode] = useState('')
  const [recent, setRecent] = useState([])
  const [recordings, setRecordings] = useState([])
  const [busy, setBusy] = useState(false)
  // Google Meet-style "New meeting" dropdown + "create for later" link modal.
  const [showNewMenu, setShowNewMenu] = useState(false)
  // Anchor + screen position for the portal-rendered dropdown (the hero Card
  // is `overflow-hidden`, so an in-flow absolute menu gets clipped — we render
  // it into a body portal with fixed positioning instead).
  const newBtnRef = useRef(null)
  const [newMenuPos, setNewMenuPos] = useState({ top: 0, left: 0 })
  const openNewMenu = () => {
    const r = newBtnRef.current?.getBoundingClientRect()
    if (r) setNewMenuPos({ top: r.bottom + 8, left: r.left })
    setShowNewMenu(true)
  }
  // Keep the menu anchored if the user scrolls/resizes while it's open.
  useEffect(() => {
    if (!showNewMenu) return
    const reposition = () => {
      const r = newBtnRef.current?.getBoundingClientRect()
      if (r) setNewMenuPos({ top: r.bottom + 8, left: r.left })
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [showNewMenu])
  const [creatingLater, setCreatingLater] = useState(false)
  const [laterMeeting, setLaterMeeting] = useState(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [schedTitle, setSchedTitle] = useState('')
  const [schedDate, setSchedDate] = useState('')
  const [schedTime, setSchedTime] = useState('')
  const [schedTz, setSchedTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [schedWaiting, setSchedWaiting] = useState(true)
  const [schedPassword, setSchedPassword] = useState('')
  const [schedInvites, setSchedInvites] = useState('')
  const [scheduling, setScheduling] = useState(false)
  // Edit-meeting modal state. Host-only via row gate, additionally enforced
  // server-side by PATCH /api/meetings/{code} (returns 403 for non-hosts).
  const [editMeeting, setEditMeeting] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editTz, setEditTz] = useState('UTC')
  const [editWaiting, setEditWaiting] = useState(true)
  const [editLocked, setEditLocked] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    api('/api/meetings/recent').then(setRecent).catch(() => {})
    api('/api/recordings').then(setRecordings).catch(() => {})
  }, [])

  const meetingLink = (c) => meetingUrl(c)

  // "Start an instant meeting" — mint a meeting and join it immediately.
  const startInstant = async () => {
    setShowNewMenu(false)
    setBusy(true)
    try {
      const meeting = await api('/api/meetings', { method: 'POST', body: { title: 'Instant meeting' } })
      navigate(meetingPath(meeting.code))
    } catch (e) {
      toast({ variant: 'error', title: 'Could not start meeting', description: e.message })
    } finally {
      setBusy(false)
    }
  }

  // "Create a meeting for later" — mint a meeting and surface its shareable
  // link WITHOUT joining, mirroring Google Meet. The host copies the link now
  // and joins whenever from the link or Recent meetings.
  const createForLater = async () => {
    setShowNewMenu(false)
    setCreatingLater(true)
    try {
      const meeting = await api('/api/meetings', { method: 'POST', body: { title: 'Meeting' } })
      setLinkCopied(false)
      setLaterMeeting(meeting)
      // Refresh Recent so the new meeting appears there too.
      api('/api/meetings/recent').then(setRecent).catch(() => {})
    } catch (e) {
      toast({ variant: 'error', title: 'Could not create meeting', description: e.message })
    } finally {
      setCreatingLater(false)
    }
  }

  const copyMeetingLink = async () => {
    if (!laterMeeting) return
    try {
      await navigator.clipboard.writeText(meetingLink(laterMeeting.code))
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1800)
    } catch {
      toast({ variant: 'error', title: 'Copy failed', description: 'Select the link and copy it manually.' })
    }
  }

  const joinCode = (e) => {
    e.preventDefault()
    const cleaned = code.trim().toLowerCase()
    if (!cleaned) return
    navigate(meetingPath(cleaned))
  }

  const scheduleMeeting = async () => {
    if (!schedTitle.trim() || !schedDate || !schedTime) return
    setScheduling(true)
    try {
      const scheduledAt = new Date(`${schedDate}T${schedTime}`).toISOString()
      const body = {
        title: schedTitle.trim(),
        scheduled_at: scheduledAt,
        timezone_name: schedTz,
        waiting_room_enabled: schedWaiting,
      }
      if (schedPassword.trim()) body.password = schedPassword.trim()
      const meeting = await api('/api/meetings', { method: 'POST', body })
      const emails = schedInvites.split(/[,;\s]+/).filter((e) => e.includes('@'))
      if (emails.length > 0) {
        await api(`/api/meetings/${meeting.code}/invite`, { method: 'POST', body: { emails } }).catch(() => {})
      }
      toast({ variant: 'success', title: 'Meeting scheduled', description: meeting.title })
      setShowSchedule(false)
      setSchedTitle(''); setSchedDate(''); setSchedTime(''); setSchedPassword(''); setSchedInvites('')
      setRecent((prev) => [meeting, ...prev])
    } catch (e) {
      toast({ variant: 'error', title: 'Could not schedule', description: e.message })
    } finally {
      setScheduling(false)
    }
  }

  const openEdit = (m) => {
    setEditMeeting(m)
    setEditTitle(m.title || '')
    if (m.scheduled_at) {
      // Pull the host's own scheduled instant in their local clock for the
      // date+time inputs; <input type="date|time"> are naïve and don't carry tz.
      const d = new Date(m.scheduled_at)
      const pad = (n) => String(n).padStart(2, '0')
      setEditDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
      setEditTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
    } else {
      setEditDate(''); setEditTime('')
    }
    setEditTz(m.timezone_name || Intl.DateTimeFormat().resolvedOptions().timeZone)
    setEditWaiting(m.waiting_room_enabled !== false)
    setEditLocked(!!m.locked)
  }

  const saveEdit = async () => {
    if (!editMeeting) return
    setEditing(true)
    try {
      const body = {
        title: editTitle.trim() || editMeeting.title,
        waiting_room_enabled: editWaiting,
        locked: editLocked,
        timezone_name: editTz,
      }
      if (editDate && editTime) {
        body.scheduled_at = new Date(`${editDate}T${editTime}`).toISOString()
      } else if (!editDate && !editTime) {
        body.scheduled_at = null
      }
      const updated = await api(`/api/meetings/${editMeeting.code}`, { method: 'PATCH', body })
      setRecent((prev) => prev.map((r) => (r.code === updated.code ? { ...r, ...updated } : r)))
      toast({ variant: 'success', title: 'Meeting updated' })
      setEditMeeting(null)
    } catch (e) {
      toast({ variant: 'error', title: 'Could not update', description: e.message })
    } finally {
      setEditing(false)
    }
  }

  const deleteRecording = async (id) => {
    if (!window.confirm('Delete this recording?')) return
    try {
      await api(`/api/recordings/${id}`, { method: 'DELETE' })
      setRecordings((prev) => prev.filter((r) => r.id !== id))
    } catch {}
  }

  const shareRecording = async (rec) => {
    try {
      // If a share token already exists, just copy the link — don't re-mint
      // a new token (would silently invalidate previously-distributed links).
      let token = rec.share_token
      if (!token) {
        const updated = await api(`/api/recordings/${rec.id}/share`, { method: 'POST' })
        token = updated.share_token
        setRecordings((prev) => prev.map((r) => (r.id === rec.id ? { ...r, share_token: token } : r)))
      }
      const shareUrl = `${window.location.origin}/recording/${token}`
      await navigator.clipboard.writeText(shareUrl)
      toast({ variant: 'success', title: 'Share link copied' })
    } catch (e) {
      toast({ variant: 'error', title: 'Could not share', description: e.message })
    }
  }

  const unshareRecording = async (id) => {
    if (!window.confirm('Revoke the share link? Anyone with the URL will lose access.')) return
    try {
      await api(`/api/recordings/${id}/share`, { method: 'DELETE' })
      setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, share_token: null } : r)))
      toast({ variant: 'success', title: 'Share link revoked' })
    } catch (e) {
      toast({ variant: 'error', title: 'Could not revoke', description: e.message })
    }
  }

  const downloadRecording = (rec) => {
    const a = document.createElement('a')
    a.href = `${getApiBase()}${rec.file_url}`
    a.download = rec.file_name
    a.click()
  }

  const firstName = user?.name?.split(' ')[0] || 'there'
  const today = useMemo(() =>
    new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
    []
  )
  const upcomingCount = recent.filter((m) => m.scheduled_at && new Date(m.scheduled_at) > new Date()).length


  return (
    <div className="relative isolate mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-8 sm:py-10">
      {/* ambient backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -top-32 -left-24 h-[460px] w-[460px] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: 'radial-gradient(closest-side,#1f7a54,transparent 70%)' }}
        />
        <div
          className="absolute -top-24 right-0 h-[460px] w-[460px] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: 'radial-gradient(closest-side,#34d399,transparent 70%)' }}
        />
      </div>

      {/* ============ Greeting ============ */}
      <motion.header
        variants={stagger(0.06)}
        initial="initial"
        animate="animate"
        className="mb-8"
      >
        <motion.div variants={fadeUp} className="flex items-center gap-2">
          <span className="text-[12.5px] text-[var(--c-fg-muted)]">{today}</span>
        </motion.div>
        <motion.h1
          variants={fadeUp}
          className="mt-3 text-[34px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[44px]"
        >
          {greeting()}, <span className="gradient-text">{firstName}</span>
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-2 max-w-[560px] text-[14.5px] leading-relaxed text-[var(--c-fg-dim)]">
          Your meetings and chat in one place. Start an instant call, schedule for later, or pick up where your team left off.
        </motion.p>
      </motion.header>

      {/* ============ Hero row: Instant meeting + Join with code ============ */}
      <motion.section
        variants={stagger(0.05)}
        initial="initial"
        animate="animate"
        className="grid gap-4 lg:grid-cols-3"
      >
        {/* ── Instant meeting (featured) ── */}
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <Card className="group/hero relative overflow-hidden p-6 sm:p-7 bg-[var(--hero-bg)] border border-[var(--hero-border)] shadow-[var(--hero-shadow)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--hero-border-hover)] hover:shadow-[var(--hero-shadow-hover)]">
            {/* layered ambient inside the card */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.7] transition-opacity duration-500 group-hover/hero:opacity-90"
              style={{
                background:
                  'radial-gradient(700px 220px at 0% 0%, rgba(31,122,82,0.10), transparent 55%),' +
                  'radial-gradient(420px 200px at 100% 100%, rgba(95,174,140,0.14), transparent 60%)',
              }}
            />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-md space-y-3">
                <motion.div
                  whileHover={{ scale: 1.04 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 20 }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--c-success)_30%,transparent)] bg-[var(--c-success-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--c-success)]"
                >
                  <span className="relative inline-flex h-1.5 w-1.5">
                    <span className="absolute inset-0 animate-ping rounded-full bg-[var(--c-success)] opacity-70" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--c-success)]" />
                  </span>
                  Ready to host
                </motion.div>
                <h2 className="text-[24px] font-bold tracking-tight text-[var(--hero-fg)]">Start an instant meeting</h2>
                <p className="text-[13.5px] leading-relaxed text-[var(--hero-fg-dim)]">
                  HD video, screen share, captions, recording — share the link with anyone, no install required.
                </p>
                <div className="pt-1">
                  <div ref={newBtnRef} className="relative inline-block">
                    <Button
                      size="lg"
                      className={EMERALD_BTN}
                      loading={busy || creatingLater}
                      onClick={() => (showNewMenu ? setShowNewMenu(false) : openNewMenu())}
                      asMotion
                      aria-haspopup="menu"
                      aria-expanded={showNewMenu}
                      leftIcon={!(busy || creatingLater) && <Video className="h-4 w-4" />}
                      rightIcon={!(busy || creatingLater) && (
                        <ChevronDown className={cn('h-4 w-4 transition-transform', showNewMenu && 'rotate-180')} />
                      )}
                    >
                      {busy ? 'Starting…' : creatingLater ? 'Creating…' : 'New meeting'}
                    </Button>

                    {/* Rendered in a body portal so the hero Card's overflow-hidden
                        doesn't clip the menu (which previously showed an empty box). */}
                    {createPortal(
                      <AnimatePresence>
                        {showNewMenu && (
                          <>
                            {/* Click-away layer — closes the menu on any outside click.
                                The global base `button` rule (index.css) forces an opaque
                                fill + a :hover background on every <button>, which turned
                                this full-screen overlay into a white panel that hid the
                                whole page on hover. Reset it to a true transparent layer. */}
                            <button
                              aria-hidden
                              tabIndex={-1}
                              className="fixed inset-0 z-[60] cursor-default !bg-transparent !border-0 !p-0 !shadow-none"
                              onClick={() => setShowNewMenu(false)}
                            />
                            <motion.div
                              role="menu"
                              initial={{ opacity: 0, y: -6, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: -6, scale: 0.98 }}
                              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                              style={{ top: newMenuPos.top, left: newMenuPos.left }}
                              className="fixed z-[61] w-[272px] overflow-hidden rounded-2xl border border-[var(--c-line-strong)] bg-[var(--c-surface)] p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)]"
                            >
                              <MeetMenuItem
                                icon={<Link2 />}
                                label="Create a meeting for later"
                                onClick={createForLater}
                              />
                              <MeetMenuItem
                                icon={<Plus />}
                                label="Start an instant meeting"
                                onClick={startInstant}
                              />
                              <MeetMenuItem
                                icon={<Calendar />}
                                label="Schedule a meeting"
                                onClick={() => { setShowNewMenu(false); setShowSchedule(true) }}
                              />
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>,
                      document.body
                    )}
                  </div>
                </div>
              </div>

              {/* Mountain scene — signature of Style 3 */}
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="relative hidden shrink-0 sm:block"
              >
                <div
                  aria-hidden
                  className="absolute -inset-6 rounded-full opacity-40 blur-3xl transition-opacity duration-500 group-hover/hero:opacity-60"
                  style={{ background: 'radial-gradient(closest-side, #6fce9f, transparent)' }}
                />
                <div className="relative overflow-hidden rounded-2xl border border-[var(--hero-border)] shadow-[0_24px_60px_-24px_rgba(16,83,52,0.4)]">
                  <MountainScene />
                </div>
              </motion.div>
            </div>
          </Card>
        </motion.div>

        {/* ── Join with code ── */}
        <motion.div variants={fadeUp}>
          <Card className="group/join flex h-full flex-col p-6 bg-[var(--hero-bg-2)] border border-[var(--hero-border)] shadow-[var(--hero-shadow)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--hero-border-hover)] hover:shadow-[var(--hero-shadow-hover)]">
            <div className="flex items-center gap-3">
              <motion.div
                whileHover={{ rotate: -8, scale: 1.08 }}
                transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#1f7a54_0%,#0f4a34_100%)] text-white shadow-[0_6px_18px_-6px_rgba(16,83,52,0.6)]"
              >
                <ArrowRight className="h-5 w-5" />
              </motion.div>
              <div>
                <div className="text-[15px] font-semibold tracking-tight text-[var(--hero-fg)]">Join with code</div>
                <div className="text-[12px] text-[var(--hero-fg-dim)]">Enter the link or code someone shared.</div>
              </div>
            </div>
            <form onSubmit={joinCode} className="mt-auto space-y-3 pt-6">
              <Input
                placeholder="abc-defg-hij"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mono tracking-widest text-center"
              />
              <Button
                type="submit"
                block
                className={EMERALD_BTN}
                disabled={!code.trim()}
                rightIcon={<ArrowRight className="h-4 w-4" />}
                asMotion
              >
                Join meeting
              </Button>
            </form>
          </Card>
        </motion.div>
      </motion.section>

      {/* ============ Recent meetings ============ */}
      <Section
        title="Recent meetings"
        sub="Your latest rooms — click to rejoin or copy the link."
        action={
          upcomingCount > 0 ? <Badge tone="accent" size="md"><Calendar className="h-3 w-3" /> {upcomingCount} upcoming</Badge> : null
        }
      >
        {recent.length === 0 ? (
          <EmptyState
            icon={<Calendar />}
            title="No meetings yet"
            desc="Start one above to see it here. Scheduled meetings will also appear in this list."
          />
        ) : (
          <ul className="divide-y divide-[var(--c-line)] overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-surface)]">
            <AnimatePresence initial={false}>
              {recent.slice(0, 6).map((m, i) => {
                const isHost = user?.id && m.host_id === user.id
                const isScheduled = !!m.scheduled_at
                const downloadIcs = () => {
                  const token = localStorage.getItem('zoiko_token') || ''
                  // .ics download must hit the same Cloud Run host; getApiBase()
                  // is '' for same-origin (default), absolute for env-overridden.
                  const url = `${getApiBase()}/api/meetings/${m.code}/calendar`
                  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                    .then((r) => r.ok ? r.blob() : Promise.reject(r))
                    .then((blob) => {
                      const a = document.createElement('a')
                      a.href = URL.createObjectURL(blob)
                      a.download = `${m.title || m.code}.ics`
                      a.click()
                      URL.revokeObjectURL(a.href)
                    })
                    .catch(() => toast({ variant: 'error', title: 'Could not download .ics' }))
                }
                return (
                  <motion.li
                    key={m.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}
                    exit={{ opacity: 0, y: -6 }}
                    className="group/row flex w-full items-center gap-4 px-4 py-3 transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--c-accent)_5%,transparent)]"
                  >
                    <button
                      onClick={() => navigate(meetingPath(m.code))}
                      className="flex min-w-0 flex-1 items-center gap-4 text-left"
                    >
                      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--c-bg-3)] text-[var(--c-fg-dim)] transition-all duration-200 group-hover/row:scale-110 group-hover/row:bg-[var(--c-accent-soft)] group-hover/row:text-[var(--c-accent)]">
                        <Video className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-semibold tracking-tight transition-colors group-hover/row:text-[var(--c-accent)]">{m.title}</span>
                          {m.password_protected && <Lock className="h-3 w-3 text-[var(--c-fg-muted)]" />}
                        </div>
                        <div className="mono text-[11px] text-[var(--c-fg-muted)]">{m.code}</div>
                      </div>
                      <div className="hidden items-center gap-1.5 text-[12px] text-[var(--c-fg-muted)] sm:flex">
                        {isScheduled ? (
                          <>
                            <Calendar className="h-3.5 w-3.5" />
                            <span>{new Date(m.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          </>
                        ) : (
                          <>
                            <Clock className="h-3.5 w-3.5" />
                            <span>{timeAgo(m.created_at)}</span>
                          </>
                        )}
                      </div>
                    </button>
                    <div className="flex items-center gap-1">
                      {isScheduled && (
                        <IconButton variant="ghost" size="sm" label="Download .ics" onClick={downloadIcs}>
                          <Download />
                        </IconButton>
                      )}
                      {isHost && (
                        <IconButton variant="ghost" size="sm" label="Edit meeting" onClick={() => openEdit(m)}>
                          <Pencil />
                        </IconButton>
                      )}
                      <ArrowRight className="ml-1 h-4 w-4 text-[var(--c-fg-muted)] opacity-0 transition-all duration-200 group-hover/row:opacity-100 group-hover/row:text-[var(--c-accent)]" />
                    </div>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </Section>

      {/* ============ Recordings ============ */}
      <Section
        title="Recordings"
        sub="Your saved meeting recordings — download, share, or delete."
      >
        {recordings.length === 0 ? (
          <EmptyState
            icon={<Radio />}
            title="No recordings yet"
            desc="Record a meeting and it'll appear here. Recordings auto-delete after 5 days."
          />
        ) : (
          <ul className="divide-y divide-[var(--c-line)] overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-surface)]">
            <AnimatePresence initial={false}>
              {recordings.map((rec, i) => (
                <motion.li
                  key={rec.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
                  exit={{ opacity: 0, y: -6 }}
                  className="group/rec flex items-center gap-4 px-4 py-3 transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--c-accent)_4%,transparent)]"
                >
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--c-danger-soft)] text-[var(--c-danger)] transition-transform duration-200 group-hover/rec:scale-110">
                    <Radio className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold tracking-tight">
                      {rec.meeting_title || 'Untitled meeting'}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--c-fg-muted)]">
                      <span className="mono">{rec.meeting_code}</span>
                      <span className="h-0.5 w-0.5 rounded-full bg-[var(--c-fg-muted)]" />
                      <span>{formatDuration(rec.duration)}</span>
                      <span className="h-0.5 w-0.5 rounded-full bg-[var(--c-fg-muted)]" />
                      <span>{formatSize(rec.file_size)}</span>
                      {rec.includes_chat && (
                        <>
                          <span className="h-0.5 w-0.5 rounded-full bg-[var(--c-fg-muted)]" />
                          <span className="inline-flex items-center gap-1"><MessageSquareText className="h-3 w-3" /> Chat log</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="hidden text-[11.5px] text-[var(--c-fg-muted)] sm:flex sm:items-center sm:gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {timeAgo(rec.created_at)}
                  </div>
                  <div className="flex items-center gap-1">
                    <IconButton variant="ghost" size="sm" label="Download" onClick={() => downloadRecording(rec)}>
                      <Download />
                    </IconButton>
                    <IconButton variant="ghost" size="sm" label={rec.share_token ? 'Copy share link' : 'Create share link'} onClick={() => shareRecording(rec)}>
                      <Share2 />
                    </IconButton>
                    {rec.share_token && (
                      <IconButton variant="ghost" size="sm" label="Revoke share link" onClick={() => unshareRecording(rec.id)}>
                        <Lock />
                      </IconButton>
                    )}
                    <IconButton variant="ghost" size="sm" label="Delete" onClick={() => deleteRecording(rec.id)}>
                      <Trash2 />
                    </IconButton>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Section>

      {/* ============ Meeting-link modal (Create for later) ============ */}
      <Modal
        open={!!laterMeeting}
        onClose={() => setLaterMeeting(null)}
        title="Here's your meeting link"
        description="Copy this link and send it to people you want to meet with. Save it so you can use it later, too."
        size="sm"
        footer={<Button onClick={() => setLaterMeeting(null)}>Done</Button>}
      >
        {laterMeeting && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-2)] p-2 pl-3.5">
              <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--c-fg)]">
                {meetingLink(laterMeeting.code)}
              </span>
              <Button
                size="sm"
                variant={linkCopied ? 'success' : 'secondary'}
                onClick={copyMeetingLink}
                leftIcon={linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              >
                {linkCopied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <button
              onClick={() => { const c = laterMeeting.code; setLaterMeeting(null); navigate(meetingPath(c)) }}
              className="text-[13px] font-medium text-[var(--c-accent)] transition hover:underline"
            >
              Join this meeting now →
            </button>
          </div>
        )}
      </Modal>

      {/* ============ Schedule modal ============ */}
      <Modal
        open={showSchedule}
        onClose={() => setShowSchedule(false)}
        title="Schedule a meeting"
        description="Pick a date, invite people, and we'll handle the calendar invites."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowSchedule(false)}>Cancel</Button>
            <Button
              onClick={scheduleMeeting}
              loading={scheduling}
              disabled={!schedTitle.trim() || !schedDate || !schedTime}
              leftIcon={!scheduling && <Calendar className="h-4 w-4" />}
              asMotion
            >
              {scheduling ? 'Scheduling…' : 'Schedule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Meeting title" required>
            <Input value={schedTitle} onChange={(e) => setSchedTitle(e.target.value)} placeholder="Team standup" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" required>
              <Input type="date" value={schedDate} onChange={(e) => setSchedDate(e.target.value)} />
            </Field>
            <Field label="Time" required>
              <Input type="time" value={schedTime} onChange={(e) => setSchedTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Timezone">
            <select
              value={schedTz}
              onChange={(e) => setSchedTz(e.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 text-[14px] text-[var(--c-fg)] outline-none transition focus:border-[var(--c-accent)] focus:shadow-[0_0_0_4px_var(--c-accent-ring)]"
            >
              {[
                'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
                'Europe/London','Europe/Paris','Europe/Berlin','Asia/Kolkata','Asia/Tokyo',
                'Asia/Shanghai','Australia/Sydney','Pacific/Auckland',
              ].map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <Field label="Invite people" hint="Comma-separated email addresses">
            <Input
              value={schedInvites}
              onChange={(e) => setSchedInvites(e.target.value)}
              placeholder="alice@example.com, bob@example.com"
            />
          </Field>
          <Field label="Password" hint="Leave blank for no password">
            <Input
              type="password"
              value={schedPassword}
              onChange={(e) => setSchedPassword(e.target.value)}
              leftIcon={<Lock />}
              autoComplete="off"
            />
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3 transition-colors hover:border-[var(--c-line-strong)] hover:bg-[var(--c-bg-2)]/80">
            <input
              type="checkbox"
              checked={schedWaiting}
              onChange={(e) => setSchedWaiting(e.target.checked)}
              className="h-4 w-4 rounded accent-[var(--c-accent)]"
            />
            <div className="flex-1">
              <div className="text-[13px] font-semibold">Enable waiting room</div>
              <div className="text-[11.5px] text-[var(--c-fg-muted)]">Approve attendees one-by-one before they join.</div>
            </div>
          </label>
        </div>
      </Modal>

      {/* ============ Edit meeting modal ============ */}
      <Modal
        open={!!editMeeting}
        onClose={() => setEditMeeting(null)}
        title="Edit meeting"
        description="Update the title, schedule, or host controls. Saves to the server immediately."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditMeeting(null)}>Cancel</Button>
            <Button
              onClick={saveEdit}
              loading={editing}
              disabled={!editTitle.trim()}
              leftIcon={!editing && <Pencil className="h-4 w-4" />}
              asMotion
            >
              {editing ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Meeting title" required>
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" hint="Leave both blank to convert to instant">
              <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </Field>
            <Field label="Time">
              <Input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} />
            </Field>
          </div>
          <Field label="Timezone">
            <select
              value={editTz}
              onChange={(e) => setEditTz(e.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 text-[14px] text-[var(--c-fg)] outline-none transition focus:border-[var(--c-accent)] focus:shadow-[0_0_0_4px_var(--c-accent-ring)]"
            >
              {[
                'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
                'Europe/London','Europe/Paris','Europe/Berlin','Asia/Kolkata','Asia/Tokyo',
                'Asia/Shanghai','Australia/Sydney','Pacific/Auckland', editTz,
              ].filter((v, i, arr) => arr.indexOf(v) === i).map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3 transition-colors hover:border-[var(--c-line-strong)] hover:bg-[var(--c-bg-2)]/80">
            <input
              type="checkbox"
              checked={editWaiting}
              onChange={(e) => setEditWaiting(e.target.checked)}
              className="h-4 w-4 rounded accent-[var(--c-accent)]"
            />
            <div className="flex-1">
              <div className="text-[13px] font-semibold">Waiting room</div>
              <div className="text-[11.5px] text-[var(--c-fg-muted)]">Approve attendees before they join.</div>
            </div>
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3 transition-colors hover:border-[var(--c-line-strong)] hover:bg-[var(--c-bg-2)]/80">
            <input
              type="checkbox"
              checked={editLocked}
              onChange={(e) => setEditLocked(e.target.checked)}
              className="h-4 w-4 rounded accent-[var(--c-accent)]"
            />
            <div className="flex-1">
              <div className="text-[13px] font-semibold">Lock meeting</div>
              <div className="text-[11.5px] text-[var(--c-fg-muted)]">No new joiners. Existing attendees keep their seats.</div>
            </div>
          </label>
        </div>
      </Modal>
    </div>
  )
}

/* ────────────────────────── pieces ────────────────────────── */

function Section({ title, sub, action, children }) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
          {sub && <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ icon, title, desc }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-bg-2)]/40 p-10 text-center">
      <motion.div
        initial={{ scale: 0.9, opacity: 0.7 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 18 }}
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--c-bg-3)] text-[var(--c-fg-muted)] [&_svg]:h-6 [&_svg]:w-6"
      >
        {icon}
      </motion.div>
      <div>
        <div className="text-[14px] font-semibold tracking-tight">{title}</div>
        <div className="mt-1 max-w-md text-[12.5px] text-[var(--c-fg-muted)] leading-relaxed">{desc}</div>
      </div>
    </div>
  )
}
