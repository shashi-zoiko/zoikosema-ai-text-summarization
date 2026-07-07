import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { meetingPath, meetingUrl, meetingShareText } from '../lib/meetingUrls.js'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, ArrowRight, Calendar, Check, CheckCircle2, ChevronDown, Copy,
  Info, Link2, Lock, Plus, Sparkles, Users2, Video,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { fadeUp, stagger } from '../lib/motion'
import { cn } from '../lib/cn'
import Button from '../components/ui/Button'
import { Input, Field } from '../components/ui/Input'
import Avatar from '../components/ui/Avatar'
import Modal from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'

/* ────────────────────────── helpers ────────────────────────── */

function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/* Solid brand CTA surfaces used by the three action cards + top buttons. */
const BLUE_BTN = '!bg-[#2563eb] !text-white hover:!bg-[#1d4ed8] !border-transparent shadow-[0_10px_24px_-10px_rgba(37,99,235,0.6)]'
const GREEN_BTN = '!bg-[#15803d] !text-white hover:!bg-[#166534] !border-transparent shadow-[0_10px_24px_-10px_rgba(21,128,61,0.55)]'
const PURPLE_BTN = '!bg-[#6d28d9] !text-white hover:!bg-[#5b21b6] !border-transparent shadow-[0_10px_24px_-10px_rgba(109,40,217,0.55)]'

/* Map a notification `type` to the icon + tone used in the Team activity feed.
   Unknown types fall back to a neutral activity glyph. */
const ACTIVITY_STYLES = {
  meeting_scheduled: { icon: Calendar,     tone: 'blue' },
  meeting_invite:    { icon: Calendar,     tone: 'blue' },
  meeting_started:   { icon: Video,        tone: 'blue' },
  summary_ready:     { icon: Sparkles,     tone: 'green' },
  action_item:       { icon: CheckCircle2, tone: 'amber' },
  recording_ready:   { icon: Activity,     tone: 'amber' },
  member_joined:     { icon: Users2,       tone: 'purple' },
  org_invite:        { icon: Users2,       tone: 'purple' },
}

/* Compact "2m ago / 3h ago / 5d ago" formatter for activity timestamps. */
function timeAgo(iso) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const TILE_TONES = {
  blue: 'bg-[#eef4ff] text-[var(--c-brand)]',
  green: 'bg-[#e9f9ef] text-[#15803d]',
  amber: 'bg-[#fff5e6] text-[#c2740b]',
  purple: 'bg-[#f1ecfe] text-[#6d28d9]',
}

/* ────────────────────────── page ────────────────────────── */

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

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [code, setCode] = useState('')
  const [recent, setRecent] = useState([])
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState([])
  const [busy, setBusy] = useState(false)

  // "New meeting" dropdown (anchored to the split-button chevron).
  const [showNewMenu, setShowNewMenu] = useState(false)
  const newBtnRef = useRef(null)
  const [newMenuPos, setNewMenuPos] = useState({ top: 0, left: 0 })
  const openNewMenu = () => {
    const r = newBtnRef.current?.getBoundingClientRect()
    if (r) setNewMenuPos({ top: r.bottom + 8, left: r.left })
    setShowNewMenu(true)
  }
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
  const [showJoin, setShowJoin] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [schedTitle, setSchedTitle] = useState('')
  const [schedDate, setSchedDate] = useState('')
  const [schedTime, setSchedTime] = useState('')
  const [schedTz, setSchedTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [schedWaiting, setSchedWaiting] = useState(true)
  const [schedPassword, setSchedPassword] = useState('')
  const [schedInvites, setSchedInvites] = useState('')
  const [scheduling, setScheduling] = useState(false)

  useEffect(() => {
    api('/api/meetings/recent').then(setRecent).catch(() => {})
    api('/api/dashboard/stats').then(setStats).catch(() => {})
    api('/api/notifications?limit=6').then((n) => setActivity(Array.isArray(n) ? n : [])).catch(() => {})
  }, [])

  const meetingLink = (c) => meetingUrl(c)

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

  const createForLater = async () => {
    setShowNewMenu(false)
    setCreatingLater(true)
    try {
      const meeting = await api('/api/meetings', { method: 'POST', body: { title: 'Meeting' } })
      setLinkCopied(false)
      setLaterMeeting(meeting)
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
      await navigator.clipboard.writeText(meetingShareText(laterMeeting.code))
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

  const firstName = user?.name?.split(' ')[0] || 'there'
  const today = useMemo(() => {
    const d = new Date()
    const weekday = d.toLocaleDateString([], { weekday: 'long' })
    const day = d.getDate()
    const month = d.toLocaleDateString([], { month: 'long' })
    return `${weekday}, ${day} ${month}`
  }, [])

  // Real upcoming (scheduled, future) meetings only — no demo fallback.
  const upcoming = useMemo(() => {
    return recent
      .filter((m) => m.scheduled_at && new Date(m.scheduled_at) > new Date())
      .slice(0, 3)
      .map((m) => {
        const d = new Date(m.scheduled_at)
        let h = d.getHours()
        const ampm = h >= 12 ? 'PM' : 'AM'
        h = h % 12 || 12
        return {
          time: `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          ampm,
          title: m.title || 'Untitled meeting',
          host: user?.name || 'You',
          people: [user?.name || 'You'],
          extra: 0,
        }
      })
  }, [recent, user])

  return (
    <div className="relative mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-8 sm:py-9">
      {/* ============ Greeting ============ */}
      <motion.header
        variants={stagger(0.05)}
        initial="initial"
        animate="animate"
        className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="min-w-0">
          <motion.div variants={fadeUp} className="text-[13px] font-semibold text-[var(--c-brand)]">{today}</motion.div>
          <motion.h1
            variants={fadeUp}
            className="mt-2 text-[30px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[38px]"
          >
            {greeting()}, <span className="text-[var(--c-brand)]">{firstName}</span> <span className="align-middle">👋</span>
          </motion.h1>
          <motion.p variants={fadeUp} className="mt-3 max-w-[620px] text-[14px] leading-relaxed text-[var(--c-fg-dim)]">
            Bring every meeting, message, and decision into one secure workspace. Start instantly, schedule ahead,
            capture AI summaries, and move your team from conversation to action.
          </motion.p>
        </div>
        <motion.div variants={fadeUp} className="flex shrink-0 items-center gap-2.5">
          <Button variant="outline" leftIcon={<Users2 className="h-4 w-4" />} onClick={() => navigate('/admin')}>
            Invite people
          </Button>
          <Button className={BLUE_BTN} leftIcon={<GridIcon />} onClick={() => setShowJoin(true)}>
            Join by code
          </Button>
        </motion.div>
      </motion.header>

      {/* ============ Action cards ============ */}
      <motion.section
        variants={stagger(0.06)}
        initial="initial"
        animate="animate"
        className="grid gap-4 lg:grid-cols-3"
      >
        {/* Start instant meeting */}
        <motion.div variants={fadeUp}>
          <ActionCard
            tint="bg-[color-mix(in_srgb,#2563eb_7%,var(--c-surface))] border-[color-mix(in_srgb,#2563eb_22%,var(--c-surface))]"
            tile={<span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#2563eb] text-white shadow-[0_10px_22px_-8px_rgba(37,99,235,0.6)] [&_svg]:h-6 [&_svg]:w-6"><Video /></span>}
            title="Start an instant meeting"
            desc="HD video, audio, screen share, captions and AI summaries."
          >
            <div ref={newBtnRef} className="flex w-full">
              <button
                onClick={startInstant}
                disabled={busy || creatingLater}
                className={cn('flex h-11 flex-1 items-center justify-center rounded-l-xl text-[14px] font-semibold transition disabled:opacity-60', BLUE_BTN, '!rounded-r-none')}
              >
                {busy ? 'Starting…' : 'Start meeting'}
              </button>
              <button
                onClick={() => (showNewMenu ? setShowNewMenu(false) : openNewMenu())}
                aria-haspopup="menu"
                aria-expanded={showNewMenu}
                aria-label="More meeting options"
                className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-r-xl border-l border-white/25 transition', BLUE_BTN, '!rounded-l-none')}
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform', showNewMenu && 'rotate-180')} />
              </button>
            </div>
          </ActionCard>
        </motion.div>

        {/* Schedule a meeting */}
        <motion.div variants={fadeUp}>
          <ActionCard
            tint="bg-[color-mix(in_srgb,#15803d_8%,var(--c-surface))] border-[color-mix(in_srgb,#15803d_22%,var(--c-surface))]"
            tile={<span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#dcfce7] text-[#15803d] [&_svg]:h-6 [&_svg]:w-6"><Calendar /></span>}
            title="Schedule a meeting"
            desc="Create a meeting, invite people, and plan ahead."
          >
            <button
              onClick={() => setShowSchedule(true)}
              className={cn('flex h-11 w-full items-center justify-center rounded-xl text-[14px] font-semibold transition', GREEN_BTN)}
            >
              Schedule meeting
            </button>
          </ActionCard>
        </motion.div>

        {/* Create meeting link */}
        <motion.div variants={fadeUp}>
          <ActionCard
            tint="bg-[color-mix(in_srgb,#6d28d9_8%,var(--c-surface))] border-[color-mix(in_srgb,#6d28d9_22%,var(--c-surface))]"
            tile={<span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#ede9fe] text-[#6d28d9] [&_svg]:h-6 [&_svg]:w-6"><Users2 /></span>}
            title="Create meeting link"
            desc="Share a link anyone can use to join your meeting."
          >
            <button
              onClick={createForLater}
              disabled={creatingLater}
              className={cn('flex h-11 w-full items-center justify-center rounded-xl text-[14px] font-semibold transition disabled:opacity-60', PURPLE_BTN)}
            >
              {creatingLater ? 'Creating…' : 'Create link'}
            </button>
          </ActionCard>
        </motion.div>
      </motion.section>

      {/* ============ Insight row ============ */}
      <motion.section
        variants={stagger(0.06)}
        initial="initial"
        animate="animate"
        className="mt-4 grid gap-4 lg:grid-cols-3"
      >
        {/* AI Meeting Intelligence */}
        <motion.div variants={fadeUp} className="lg:col-span-1">
          <Panel>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-[18px] w-[18px] text-[var(--c-brand)]" />
                <span className="text-[15px] font-semibold tracking-tight">Meeting stats</span>
                <Info className="h-3.5 w-3.5 text-[var(--c-fg-muted)]" />
              </div>
              {stats && (
                <span className="inline-flex shrink-0 items-center rounded-full bg-[#e9f9ef] px-2.5 py-1 text-[11px] font-semibold text-[#15803d]">
                  {stats.meetings_this_week} this week
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--c-fg-muted)]">
              A roll-up of your meetings, participants and recordings.
            </p>
            <div className="mt-4 grid grid-cols-4 gap-2.5">
              <StatTile icon={<Video />} tone="blue" value={stats?.total_meetings ?? 0} label="Meetings" sub="Total" />
              <StatTile icon={<Calendar />} tone="green" value={stats?.meetings_this_month ?? 0} label="This month" sub="Meetings" />
              <StatTile icon={<Users2 />} tone="purple" value={stats?.total_participants ?? 0} label="Participants" sub="Hosted" />
              <StatTile icon={<Activity />} tone="amber" value={stats?.total_recordings ?? 0} label="Recordings" sub="Saved" />
            </div>
            <button onClick={() => navigate('/dashboard')} className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--c-brand)] transition hover:gap-1.5">
              View analytics <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Panel>
        </motion.div>

        {/* Upcoming meetings */}
        <motion.div variants={fadeUp}>
          <Panel>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-[18px] w-[18px] text-[var(--c-fg-dim)]" />
                <span className="text-[15px] font-semibold tracking-tight">Upcoming meetings</span>
              </div>
              <button onClick={() => navigate('/scheduled')} className="text-[12.5px] font-semibold text-[var(--c-brand)] hover:underline">View calendar</button>
            </div>
            {upcoming.length > 0 ? (
              <div className="mt-3 divide-y divide-[var(--c-line)]">
                {upcoming.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 py-3 first:pt-1">
                    <div className="w-[46px] shrink-0">
                      <div className="text-[13.5px] font-bold leading-none tracking-tight">{m.time}</div>
                      <div className="mt-0.5 text-[10.5px] font-medium text-[var(--c-fg-muted)]">{m.ampm}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold tracking-tight">{m.title}</div>
                      <div className="truncate text-[11.5px] text-[var(--c-fg-muted)]">{m.host}</div>
                    </div>
                    <AvatarStack people={m.people} extra={m.extra} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyHint icon={<Calendar />} text="No upcoming meetings scheduled." />
            )}
            <button onClick={() => navigate('/scheduled')} className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--c-brand)] transition hover:gap-1.5">
              View all meetings <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Panel>
        </motion.div>

        {/* Team activity */}
        <motion.div variants={fadeUp}>
          <Panel>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-[18px] w-[18px] text-[var(--c-fg-dim)]" />
                <span className="text-[15px] font-semibold tracking-tight">Team activity</span>
              </div>
              <button onClick={() => navigate('/scheduled')} className="text-[12.5px] font-semibold text-[var(--c-brand)] hover:underline">View all</button>
            </div>
            {activity.length > 0 ? (
              <div className="mt-3 space-y-1">
                {activity.map((a) => {
                  const style = ACTIVITY_STYLES[a.type] || { icon: Activity, tone: 'blue' }
                  const Ico = style.icon
                  return (
                    <div key={a.id} className="flex items-start gap-3 py-1.5">
                      <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg [&_svg]:h-4 [&_svg]:w-4', TILE_TONES[style.tone])}>
                        <Ico />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] leading-snug text-[var(--c-fg)]">
                          <span className="font-semibold">{a.title}</span>
                        </div>
                        {a.body && <div className="truncate text-[11.5px] text-[var(--c-fg-dim)]">{a.body}</div>}
                        <div className="mt-0.5 text-[11px] text-[var(--c-fg-muted)]">{timeAgo(a.created_at)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyHint icon={<Activity />} text="No recent activity yet." />
            )}
          </Panel>
        </motion.div>
      </motion.section>

      {/* ============ New-meeting dropdown (portal) ============ */}
      {createPortal(
        <AnimatePresence>
          {showNewMenu && (
            <>
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
                <MeetMenuItem icon={<Link2 />} label="Create a meeting for later" onClick={createForLater} />
                <MeetMenuItem icon={<Plus />} label="Start an instant meeting" onClick={startInstant} />
                <MeetMenuItem icon={<Calendar />} label="Schedule a meeting" onClick={() => { setShowNewMenu(false); setShowSchedule(true) }} />
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* ============ Join by code modal ============ */}
      <Modal
        open={showJoin}
        onClose={() => setShowJoin(false)}
        title="Join a meeting"
        description="Enter the meeting code or paste the link someone shared with you."
        size="sm"
      >
        <form onSubmit={(e) => { joinCode(e); setShowJoin(false) }} className="space-y-3">
          <Input
            placeholder="abc-defg-hij"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="mono tracking-widest text-center"
            autoFocus
          />
          <Button type="submit" block className={BLUE_BTN} disabled={!code.trim()} rightIcon={<ArrowRight className="h-4 w-4" />}>
            Join meeting
          </Button>
        </form>
      </Modal>

      {/* ============ Meeting-link modal (Create link) ============ */}
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
              className="text-[13px] font-medium text-[var(--c-brand)] transition hover:underline"
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
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3 transition-colors hover:border-[var(--c-line-strong)]">
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
    </div>
  )
}

/* ────────────────────────── pieces ────────────────────────── */

/* Keypad/grid glyph for the "Join by code" button. */
function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
      {[0, 6, 12].flatMap((y) => [0, 6, 12].map((x) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" rx="1" />
      )))}
    </svg>
  )
}

function ActionCard({ tint, tile, title, desc, children }) {
  return (
    <div className={cn('flex h-full flex-col rounded-2xl border p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.25)]', tint)}>
      <div className="flex items-start gap-3.5">
        {tile}
        <div className="min-w-0 pt-0.5">
          <h3 className="text-[15.5px] font-semibold tracking-tight text-[var(--c-fg)]">{title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--c-fg-muted)]">{desc}</p>
        </div>
      </div>
      <div className="mt-auto pt-5">{children}</div>
    </div>
  )
}

function EmptyHint({ icon, text }) {
  return (
    <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--c-line)] px-4 py-8 text-center">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--c-bg-2)] text-[var(--c-fg-muted)] [&_svg]:h-[18px] [&_svg]:w-[18px]">
        {icon}
      </span>
      <p className="text-[12.5px] text-[var(--c-fg-muted)]">{text}</p>
    </div>
  )
}

function Panel({ children }) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-[var(--c-line)] bg-[var(--c-surface)] p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {children}
    </div>
  )
}

function StatTile({ icon, value, label, sub, tone = 'blue' }) {
  return (
    <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-1)] p-2.5 text-center">
      <span className={cn('mx-auto grid h-8 w-8 place-items-center rounded-lg [&_svg]:h-[17px] [&_svg]:w-[17px]', TILE_TONES[tone])}>
        {icon}
      </span>
      <div className="mt-1.5 text-[20px] font-bold leading-none tracking-tight">{value}</div>
      <div className="mt-1 text-[11.5px] font-semibold leading-tight tracking-tight">{label}</div>
      <div className="text-[10.5px] leading-tight text-[var(--c-fg-muted)]">{sub}</div>
    </div>
  )
}

function AvatarStack({ people = [], extra = 0 }) {
  return (
    <div className="flex shrink-0 items-center">
      {people.slice(0, 3).map((name, i) => (
        <Avatar key={i} name={name} size="xs" className="-ml-2 ring-2 ring-[var(--c-surface)] first:ml-0" />
      ))}
      {extra > 0 && (
        <span className="-ml-2 grid h-6 w-6 place-items-center rounded-full bg-[var(--c-bg-3)] text-[9.5px] font-semibold text-[var(--c-fg-dim)] ring-2 ring-[var(--c-surface)]">
          +{extra}
        </span>
      )}
    </div>
  )
}
