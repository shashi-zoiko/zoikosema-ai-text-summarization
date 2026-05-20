import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, ArrowUpRight, BarChart3, Brain, Calendar, CalendarDays, Clock, Disc,
  Download, Plus, Search, Sparkles, TrendingUp, Users2, Video,
} from 'lucide-react'
import { api, getApiBase } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { fadeUp, stagger } from '../lib/motion'
import Button from '../components/ui/Button'
import IconButton from '../components/ui/IconButton'
import Badge from '../components/ui/Badge'
import Avatar from '../components/ui/Avatar'
import CountUp from '../components/ui/CountUp'
import Skeleton from '../components/ui/Skeleton'
import DonutChart from '../components/ui/DonutChart'
import { Card } from '../components/ui/Card'
import { cn } from '../lib/cn'

/* ────────────────────────── helpers ────────────────────────── */

function formatDuration(mins) {
  if (!mins) return '0m'
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
function formatHoursShort(mins) {
  if (!mins) return '0h'
  const h = mins / 60
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`
}
function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function relativeDay(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const ms = today.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)
  const days = Math.round(ms / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}

/* ─────────────────────── action tile colors ─────────────────────── */
/* Each tile uses a layered gradient + a soft hover shine like the reference image. */
const ACTION_TILES = [
  {
    key: 'new',
    label: 'New meeting',
    sub: 'Instant room',
    icon: <Video />,
    to: '/meet',
    bg: 'linear-gradient(160deg,#7B86FF 0%,#5B67F2 55%,#3F4ACB 100%)',
    glow: 'rgba(91,103,242,0.55)',
  },
  {
    key: 'schedule',
    label: 'Schedule',
    sub: 'Plan ahead',
    icon: <Calendar />,
    to: '/meet',
    bg: 'linear-gradient(160deg,#7EE2C2 0%,#3FBF9B 55%,#1F9D7B 100%)',
    glow: 'rgba(63,191,155,0.5)',
  },
  {
    key: 'recordings',
    label: 'Recordings',
    sub: 'Replay & share',
    icon: <Disc />,
    to: '/meet',
    bg: 'linear-gradient(160deg,#FFB877 0%,#F08A44 55%,#D86919 100%)',
    glow: 'rgba(240,138,68,0.5)',
  },
  {
    key: 'intel',
    label: 'AI Intelligence',
    sub: 'Recaps & action items',
    icon: <Brain />,
    to: '/meet',
    bg: 'linear-gradient(160deg,#E07BFF 0%,#B658F0 55%,#7C3CC8 100%)',
    glow: 'rgba(182,88,240,0.55)',
  },
]

/* ─────────────────────── stat strip ─────────────────────── */

const STAT_CONFIG = [
  { key: 'total_meetings',         label: 'Total meetings',  icon: <Video />,        tone: 'accent'  },
  { key: 'meetings_this_week',     label: 'This week',       icon: <TrendingUp />,   tone: 'success' },
  { key: 'meetings_this_month',    label: 'This month',      icon: <CalendarDays />, tone: 'neutral' },
  { key: 'total_participants',     label: 'Participants',    icon: <Users2 />,       tone: 'neutral' },
  { key: 'total_duration_minutes', label: 'Time in meetings',icon: <Clock />,        tone: 'neutral', format: formatDuration },
  { key: 'total_recordings',       label: 'Recordings',      icon: <Disc />,         tone: 'warn'    },
]

const TONE_BG = {
  accent:  'bg-[var(--c-accent-soft)] text-[var(--c-accent)]',
  success: 'bg-[var(--c-success-soft)] text-[var(--c-success)]',
  warn:    'bg-[var(--c-warn-soft)] text-[var(--c-warn)]',
  neutral: 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)]',
}

/* ─────────────────────── page ─────────────────────── */

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [history, setHistory] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    Promise.all([
      api('/api/dashboard/stats'),
      api('/api/dashboard/history?limit=20'),
      api('/api/dashboard/upcoming'),
    ])
      .then(([s, h, u]) => { setStats(s); setHistory(h); setUpcoming(u) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const loadMore = async () => {
    const nextPage = page + 1
    try {
      const more = await api(`/api/dashboard/history?page=${nextPage}&limit=20`)
      setHistory((prev) => [...prev, ...more])
      setPage(nextPage)
    } catch {}
  }

  const downloadCalendar = async (code) => {
    try {
      const token = localStorage.getItem('zoiko_token')
      const res = await fetch(`${getApiBase()}/api/meetings/${code}/calendar`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'meeting.ics'
      a.click()
    } catch {}
  }

  /* Derived: time-breakdown segments for the donut */
  const donutSegments = useMemo(() => {
    if (!stats) return []
    const totalMin = stats.total_duration_minutes || 0
    const week     = Math.min(totalMin, (stats.meetings_this_week || 0) * 30)
    const month    = Math.min(Math.max(0, totalMin - week), (stats.meetings_this_month || 0) * 30)
    const older    = Math.max(0, totalMin - week - month)
    const recordings = (stats.total_recordings || 0) * 12
    return [
      { label: 'This week',  value: week,       color: '#5B67F2' }, // indigo
      { label: 'This month', value: month,      color: '#3FBF9B' }, // green
      { label: 'Older',      value: older,      color: '#F08A44' }, // orange
      { label: 'Recordings', value: recordings, color: '#B658F0' }, // purple
    ].filter((s) => s.value > 0)
  }, [stats])

  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return history
    return history.filter((m) =>
      (m.title || '').toLowerCase().includes(q) ||
      (m.code  || '').toLowerCase().includes(q) ||
      (m.host_name || '').toLowerCase().includes(q)
    )
  }, [history, query])

  /* recent few (visual list) */
  const recent = (history || []).slice(0, 4)

  /* ───────── loading state — skeleton instead of bare spinner ───────── */
  if (loading) return <DashboardSkeleton />

  return (
    <div className="relative isolate mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-8 sm:py-10">
      {/* ambient backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full opacity-[0.18] blur-3xl"
          style={{ background: 'radial-gradient(closest-side,#5b67f2,transparent 70%)' }}
        />
        <div
          className="absolute -top-24 right-0 h-[460px] w-[460px] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: 'radial-gradient(closest-side,#d670ff,transparent 70%)' }}
        />
      </div>

      {/* =============== Top bar: greeting + search + upgrade =============== */}
      <motion.div
        variants={stagger(0.05)}
        initial="initial"
        animate="animate"
        className="mb-6 flex flex-wrap items-center gap-3"
      >
        <motion.div variants={fadeUp} className="flex items-center gap-2">
          <h1 className="text-[22px] font-bold leading-none tracking-[-0.02em] sm:text-[26px]">
            Overview
          </h1>
          {stats && (
            <Badge tone="accent" size="md">
              <Sparkles className="h-3 w-3" /> {stats.total_meetings ?? 0} meetings
            </Badge>
          )}
        </motion.div>

        <motion.div variants={fadeUp} className="ml-auto flex items-center gap-2">
          <div className="group/srch relative hidden md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--c-fg-muted)] transition-colors group-focus-within/srch:text-[var(--c-accent)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search meetings…"
              className="h-10 w-[240px] rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/60 pl-9 pr-3 text-[13px] font-medium text-[var(--c-fg)] outline-none transition placeholder:text-[var(--c-fg-muted)] hover:border-[var(--c-line-strong)] focus:border-[var(--c-accent)] focus:bg-[var(--c-surface-2)] focus:shadow-[0_0_0_4px_var(--c-accent-ring)]"
            />
          </div>
          <Button
            asMotion
            size="md"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => navigate('/meet')}
          >
            New meeting
          </Button>
        </motion.div>
      </motion.div>

      {/* =============== Hero block + action tiles =============== */}
      <section className="mb-8 grid gap-5 lg:grid-cols-[1.05fr_1.4fr]">
        {/* ── Hero copy ── */}
        <motion.div
          variants={stagger(0.05)}
          initial="initial"
          animate="animate"
          className="flex flex-col justify-center"
        >
          <motion.div variants={fadeUp}>
            <Badge tone="accent" size="md">
              <BarChart3 className="h-3 w-3" /> Workspace pulse
            </Badge>
          </motion.div>
          <motion.h2
            variants={fadeUp}
            className="mt-3 text-[36px] font-bold leading-[1.05] tracking-[-0.025em] sm:text-[44px]"
          >
            {user?.name ? <>Welcome back, <span className="gradient-text">{user.name.split(' ')[0]}</span></> : <>Manage your <span className="gradient-text">meetings</span></>}
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="mt-3 max-w-[440px] text-[14.5px] leading-relaxed text-[var(--c-fg-dim)]"
          >
            Start a room, schedule ahead, replay recordings, or open the AI recap — everything lives one tap away.
          </motion.p>
        </motion.div>

        {/* ── Tiles row ── */}
        <motion.div
          variants={stagger(0.07)}
          initial="initial"
          animate="animate"
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {/* dashed "plus" tile */}
          <motion.button
            variants={fadeUp}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 22 }}
            onClick={() => navigate('/meet')}
            className="group/tile relative flex aspect-[3/4] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[var(--c-line-strong)] bg-transparent text-[var(--c-fg-muted)] outline-none transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)] focus-visible:ring-4 focus-visible:ring-[var(--c-accent-ring)]"
          >
            <motion.span
              animate={{ rotate: 0 }}
              whileHover={{ rotate: 90, scale: 1.1 }}
              transition={{ type: 'spring', stiffness: 240, damping: 16 }}
              className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--c-line-strong)] bg-[var(--c-bg-2)]/60 group-hover/tile:border-[var(--c-accent)] group-hover/tile:bg-[var(--c-accent-soft)]"
            >
              <Plus className="h-6 w-6" />
            </motion.span>
            <span className="mt-3 text-[12px] font-semibold tracking-tight">New room</span>
          </motion.button>

          {ACTION_TILES.map((t, i) => (
            <ActionTile key={t.key} tile={t} index={i + 1} onClick={() => navigate(t.to)} />
          ))}
        </motion.div>
      </section>

      {/* =============== Stat strip =============== */}
      {stats && (
        <motion.section
          variants={stagger(0.05)}
          initial="initial"
          animate="animate"
          className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        >
          {STAT_CONFIG.map((cfg) => {
            const raw = Number(stats[cfg.key] || 0)
            return (
              <motion.div
                key={cfg.key}
                variants={fadeUp}
                whileHover={{ y: -3 }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              >
                <Card interactive className="group/stat relative p-4">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-4 -bottom-6 h-12 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover/stat:opacity-70"
                    style={{ background: 'linear-gradient(90deg, var(--c-accent), var(--c-accent-3))' }}
                  />
                  <div className="flex items-start justify-between">
                    <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl transition-transform duration-200 group-hover/stat:scale-110 [&_svg]:h-[18px] [&_svg]:w-[18px]', TONE_BG[cfg.tone])}>
                      {cfg.icon}
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 -translate-y-1 translate-x-1 text-[var(--c-fg-muted)] opacity-0 transition-all duration-200 group-hover/stat:translate-x-0 group-hover/stat:translate-y-0 group-hover/stat:opacity-100" />
                  </div>
                  <div className="mt-3 text-[24px] font-bold tracking-tight tabular-nums text-[var(--c-fg)]">
                    {cfg.format
                      ? <CountUp value={raw} format={cfg.format} />
                      : <CountUp value={raw} />}
                  </div>
                  <div className="text-[11.5px] uppercase tracking-[0.08em] text-[var(--c-fg-muted)]">{cfg.label}</div>
                </Card>
              </motion.div>
            )
          })}
        </motion.section>
      )}

      {/* =============== Donut + Recent meetings =============== */}
      <section className="mb-10 grid gap-5 lg:grid-cols-[420px_1fr]">
        {/* ── Donut breakdown ── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
          <Card className="relative p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight">Time breakdown</h3>
                <p className="mt-0.5 text-[11.5px] text-[var(--c-fg-muted)]">How your meeting hours split.</p>
              </div>
              <Badge tone="neutral" size="sm">All time</Badge>
            </div>

            <div className="grid grid-cols-[auto_1fr] items-center gap-5">
              <DonutChart
                segments={donutSegments.length ? donutSegments : [{ label: 'No data', value: 1, color: 'var(--c-line-strong)' }]}
                centerLabel={formatHoursShort(stats?.total_duration_minutes || 0)}
                centerSub="Total"
              />
              <ul className="space-y-2.5">
                {(donutSegments.length ? donutSegments : [
                  { label: 'No meetings yet', value: 0, color: 'var(--c-line-strong)' },
                ]).map((s, i) => (
                  <motion.li
                    key={s.label}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + i * 0.06, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center justify-between gap-2 text-[12.5px]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                      <span className="text-[var(--c-fg-dim)]">{s.label}</span>
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--c-fg)]">
                      {s.value ? formatDuration(Math.round(s.value)) : '—'}
                    </span>
                  </motion.li>
                ))}
              </ul>
            </div>
          </Card>
        </motion.div>

        {/* ── Recent meetings (preview list) ── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}>
          <Card className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight">Recent meetings</h3>
                <p className="mt-0.5 text-[11.5px] text-[var(--c-fg-muted)]">Your last {recent.length || 0} rooms.</p>
              </div>
              {history.length > 4 && (
                <button
                  onClick={() => document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' })}
                  className="group/all inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--c-accent)] transition hover:text-[var(--c-accent-2)]"
                >
                  View all
                  <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover/all:translate-x-0.5" />
                </button>
              )}
            </div>
            {recent.length === 0 ? (
              <EmptyMeetings />
            ) : (
              <ul className="mt-2 divide-y divide-[var(--c-line)]">
                {recent.map((m, i) => (
                  <RecentRow
                    key={m.id}
                    meeting={m}
                    delay={i * 0.05}
                    onClick={() => navigate(`/meet/${m.code}`)}
                    onIntel={() => navigate(`/meet/${m.code}/intelligence`)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </motion.div>
      </section>

      {/* =============== Upcoming =============== */}
      {upcoming.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h2 className="text-[18px] font-semibold tracking-tight">Upcoming meetings</h2>
              <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">Your next {upcoming.length} scheduled rooms.</p>
            </div>
            <Badge tone="accent" size="md"><Sparkles className="h-3 w-3" /> {upcoming.length} planned</Badge>
          </div>
          <motion.div
            variants={stagger(0.06)}
            initial="initial"
            animate="animate"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {upcoming.map((m) => (
              <motion.div
                key={m.id}
                variants={fadeUp}
                whileHover={{ y: -3 }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              >
                <Card interactive className="group/upcoming p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3 py-2 leading-none transition-colors group-hover/upcoming:border-[var(--c-accent)]">
                      <span className="text-[18px] font-bold tabular-nums">{new Date(m.scheduled_at).getDate()}</span>
                      <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--c-fg-muted)]">
                        {new Date(m.scheduled_at).toLocaleString([], { month: 'short' })}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold tracking-tight">{m.title}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-[var(--c-fg-muted)]">
                        <Clock className="h-3 w-3" /> {formatTime(m.scheduled_at)}
                        {m.timezone_name && <span className="ml-1 text-[var(--c-fg-muted)]">· {m.timezone_name}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button asMotion size="sm" block onClick={() => navigate(`/meet/${m.code}`)} rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                      Join
                    </Button>
                    <IconButton variant="ghost" size="sm" label="Add to calendar" onClick={() => downloadCalendar(m.code)}>
                      <Download />
                    </IconButton>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}

      {/* =============== History table =============== */}
      <section id="history">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight">Meeting history</h2>
            <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">All your past and active meeting rooms.</p>
          </div>
          {query && (
            <Badge tone="accent" size="md">{filteredHistory.length} matches for “{query}”</Badge>
          )}
        </div>

        {history.length === 0 ? (
          <EmptyMeetings large />
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-surface)]">
              <div className="hidden grid-cols-[1fr_180px_120px_120px_140px_100px] gap-4 border-b border-[var(--c-line)] bg-[var(--c-bg-2)]/40 px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.10em] text-[var(--c-fg-muted)] md:grid">
                <span>Meeting</span>
                <span>Host</span>
                <span>Participants</span>
                <span>Duration</span>
                <span>Date</span>
                <span>Status</span>
              </div>
              <ul className="divide-y divide-[var(--c-line)]">
                <AnimatePresence initial={false}>
                  {filteredHistory.map((m, i) => (
                    <motion.li
                      key={m.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.25, delay: Math.min(i, 8) * 0.02, ease: [0.16, 1, 0.3, 1] }}
                      className="group relative"
                    >
                      <button
                        onClick={() => navigate(`/meet/${m.code}`)}
                        className="grid w-full grid-cols-1 gap-1 px-5 py-3 text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--c-accent)_5%,transparent)] md:grid-cols-[1fr_180px_120px_120px_140px_100px] md:items-center md:gap-4"
                      >
                        <span className="flex items-center gap-3">
                          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)] transition-transform duration-200 group-hover:scale-110">
                            <Video className="h-4 w-4" />
                            {m.is_active && (
                              <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                                <span className="absolute inset-0 animate-ping rounded-full bg-[var(--c-success)] opacity-75" />
                                <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--c-success)] ring-2 ring-[var(--c-surface)]" />
                              </span>
                            )}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-[13.5px] font-semibold tracking-tight transition-colors group-hover:text-[var(--c-accent)]">{m.title}</span>
                            <span className="mono text-[11px] text-[var(--c-fg-muted)]">{m.code}</span>
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5 text-[12.5px] text-[var(--c-fg-dim)]">
                          <span className="truncate">{m.host_name || 'Unknown'}</span>
                          {m.host_id === user?.id && <Badge tone="accent" size="sm">You</Badge>}
                        </span>
                        <span className="text-[12.5px] tabular-nums text-[var(--c-fg-dim)]">{m.participant_count}</span>
                        <span className="text-[12.5px] tabular-nums text-[var(--c-fg-dim)]">
                          {m.duration_minutes != null ? formatDuration(m.duration_minutes) : '—'}
                        </span>
                        <span className="text-[12.5px] text-[var(--c-fg-dim)]">{relativeDay(m.created_at)}</span>
                        <span>
                          {m.is_active
                            ? <Badge tone="live" pulse size="sm">Live</Badge>
                            : <Badge tone="neutral" size="sm">Ended</Badge>
                          }
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/meet/${m.code}/intelligence`) }}
                        title="View AI intelligence"
                        className="absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-lg border border-[var(--c-line)] bg-[var(--c-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--c-fg-dim)] opacity-0 transition-all duration-200 hover:border-[var(--c-accent)] hover:text-[var(--c-accent)] group-hover:opacity-100 md:inline-flex"
                      >
                        <Brain className="h-3.5 w-3.5" /> Intelligence
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
            {filteredHistory.length === 0 && query && (
              <div className="mt-4 rounded-xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-bg-2)]/40 p-6 text-center text-[12.5px] text-[var(--c-fg-muted)]">
                No meetings match “{query}”.
              </div>
            )}
            {history.length >= page * 20 && !query && (
              <div className="mt-4 text-center">
                <Button asMotion variant="outline" onClick={loadMore} rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

/* ────────────────────────── pieces ────────────────────────── */

function ActionTile({ tile, index, onClick }) {
  return (
    <motion.button
      variants={fadeUp}
      whileHover={{ y: -6 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      onClick={onClick}
      className="group/tile relative isolate flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-2xl p-4 text-left text-white outline-none focus-visible:ring-4 focus-visible:ring-[var(--c-accent-ring)]"
      style={{ background: tile.bg }}
    >
      {/* Soft hover halo */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-4 -z-10 opacity-0 blur-2xl transition-opacity duration-300 group-hover/tile:opacity-80"
        style={{ background: tile.glow }}
      />
      {/* Shine sweep */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(120deg,transparent_30%,rgba(255,255,255,0.28)_50%,transparent_70%)] transition-transform duration-700 ease-out group-hover/tile:translate-x-full"
      />
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-bold tabular-nums tracking-[0.1em] text-white/70">
          {String(index).padStart(2, '0')}
        </span>
        <span className="text-white/60 transition-transform duration-200 group-hover/tile:rotate-90">⋮</span>
      </div>
      <div>
        <motion.span
          whileHover={{ rotate: -8, scale: 1.05 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm [&_svg]:h-5 [&_svg]:w-5"
        >
          {tile.icon}
        </motion.span>
        <div className="mt-3 text-[14px] font-bold tracking-tight">{tile.label}</div>
        <div className="text-[11px] font-medium text-white/75">{tile.sub}</div>
      </div>
    </motion.button>
  )
}

function RecentRow({ meeting, delay = 0, onClick, onIntel }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="group/row"
    >
      <button
        onClick={onClick}
        className="flex w-full items-center gap-3 px-1 py-3 text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--c-accent)_4%,transparent)] rounded-xl -mx-1 px-2"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--c-accent-soft)] text-[var(--c-accent)] transition-transform duration-200 group-hover/row:scale-110">
          <Video className="h-4 w-4" />
          {meeting.is_active && (
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--c-success)] opacity-70" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--c-success)] ring-2 ring-[var(--c-surface)]" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold tracking-tight transition-colors group-hover/row:text-[var(--c-accent)]">
            {meeting.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--c-fg-muted)]">
            <span className="mono">{meeting.code}</span>
            <span aria-hidden>·</span>
            <span>{meeting.participant_count} {meeting.participant_count === 1 ? 'person' : 'people'}</span>
          </span>
        </span>
        <AvatarStack name={meeting.host_name} count={meeting.participant_count} />
        <span className="ml-2 hidden w-[110px] text-right text-[11.5px] text-[var(--c-fg-muted)] sm:inline">
          {relativeDay(meeting.created_at)}
        </span>
        <ArrowRight className="ml-2 h-3.5 w-3.5 -translate-x-1 text-[var(--c-fg-muted)] opacity-0 transition-all duration-200 group-hover/row:translate-x-0 group-hover/row:opacity-100" />
      </button>
    </motion.li>
  )
}

function AvatarStack({ name, count }) {
  const visible = Math.min(3, Math.max(1, count || 1))
  const seeds = [name || 'A', 'B', 'C'].slice(0, visible)
  const extra = (count || 1) - visible
  return (
    <span className="hidden items-center sm:inline-flex">
      <span className="flex -space-x-2">
        {seeds.map((s, i) => (
          <Avatar key={i} name={s} size="xs" className="ring-2 ring-[var(--c-surface)]" />
        ))}
      </span>
      {extra > 0 && (
        <span className="ml-2 inline-flex h-6 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-bg-2)] px-1.5 text-[10px] font-semibold text-[var(--c-fg-dim)]">
          +{extra}
        </span>
      )}
    </span>
  )
}

function EmptyMeetings({ large }) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-bg-2)]/40 text-center',
      large ? 'p-10' : 'p-6 mt-2'
    )}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--c-bg-3)] text-[var(--c-fg-muted)]">
        <Video className="h-6 w-6" />
      </div>
      <div>
        <div className="text-[14px] font-semibold tracking-tight">No meetings yet</div>
        <div className="mt-1 max-w-md text-[12.5px] text-[var(--c-fg-muted)]">Start or join a meeting to build your history.</div>
      </div>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-8 sm:py-10">
      <div className="mb-6 flex items-center gap-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="ml-auto h-10 w-[240px]" />
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="mb-8 grid gap-5 lg:grid-cols-[1.05fr_1.4fr]">
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-4 w-5/6" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />
          ))}
        </div>
      </div>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
      <div className="mb-10 grid gap-5 lg:grid-cols-[420px_1fr]">
        <Skeleton className="h-[260px] rounded-2xl" />
        <Skeleton className="h-[260px] rounded-2xl" />
      </div>
      <Skeleton className="h-[280px] rounded-2xl" />
    </div>
  )
}
