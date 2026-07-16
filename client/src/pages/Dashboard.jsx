import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { meetingPath, meetingIntelligencePath } from '../lib/meetingUrls.js'
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
/**
 * Where a history/recent row should go when clicked. A live meeting opens its
 * pre-join lobby so you can (re)join; a concluded meeting opens its AI summary /
 * transcript instead of dropping you into a dead room. Fixes rows that showed
 * "Ended" yet still routed into the meeting interface.
 */
function openPathFor(meeting) {
  return meeting.is_active
    ? meetingPath(meeting.code)
    : meetingIntelligencePath(meeting.code)
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

/* ─────────────────────── action tiles ───────────────────────
 * Calm Linear/Vercel-style cards. Earlier revisions used a four-colour
 * vivid gradient per tile + glow halos + shine sweeps; it read as
 * "AI-generated landing page" rather than a product surface. Now each
 * tile is a neutral card with a small accented icon chip — the colour
 * lives on the icon, not the whole tile. */
const ACTION_TILES = [
  { key: 'new',        label: 'New meeting',    sub: 'Start an instant room',  icon: <Video />,    to: '/', tone: 'accent'  },
  { key: 'schedule',   label: 'Schedule',       sub: 'Plan a meeting ahead',   icon: <Calendar />, to: '/', tone: 'success' },
  { key: 'recordings', label: 'Recordings',     sub: 'Replay and share',       icon: <Disc />,     to: '/', tone: 'warn'    },
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

/* Module-level cache so switching away and back to Analytics renders the
 * last-known data instantly instead of blocking the whole page on a fresh
 * round-trip every time. The page still revalidates in the background on each
 * mount (stale-while-revalidate); only the very first load shows the skeleton.
 * Keyed by user id so a different account never sees another's cached data. */
let dashboardCache = null

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const cached = dashboardCache && dashboardCache.userId === user?.id ? dashboardCache : null
  const [stats, setStats] = useState(cached?.stats ?? null)
  const [history, setHistory] = useState(cached?.history ?? [])
  const [upcoming, setUpcoming] = useState(cached?.upcoming ?? [])
  const [page, setPage] = useState(cached?.page ?? 1)
  // Only block on the skeleton when we have nothing to show yet.
  const [loading, setLoading] = useState(!cached)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api('/api/dashboard/stats'),
      api('/api/dashboard/history?limit=20'),
      api('/api/dashboard/upcoming'),
    ])
      .then(([s, h, u]) => {
        if (cancelled) return
        setStats(s); setHistory(h); setUpcoming(u); setPage(1)
        dashboardCache = { userId: user?.id, stats: s, history: h, upcoming: u, page: 1 }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user?.id])

  const loadMore = async () => {
    const nextPage = page + 1
    try {
      const more = await api(`/api/dashboard/history?page=${nextPage}&limit=20`)
      setHistory((prev) => {
        const next = [...prev, ...more]
        if (dashboardCache && dashboardCache.userId === user?.id) {
          dashboardCache = { ...dashboardCache, history: next, page: nextPage }
        }
        return next
      })
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
      { label: 'This week',  value: week,       color: '#1f7a54' }, // forest green
      { label: 'This month', value: month,      color: '#3FBF9B' }, // green
      { label: 'Older',      value: older,      color: '#F08A44' }, // orange
      { label: 'Recordings', value: recordings, color: '#14b8a6' }, // teal
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
    <div className="relative mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-8 sm:py-10">
      {/* The earlier revision had two large radial-gradient blobs floating
          behind the dashboard. Removing them — SaaS-grade dashboards keep
          the canvas calm and let content carry the colour. */}

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
            onClick={() => navigate('/')}
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
            className="mt-3 text-[32px] font-semibold leading-[1.08] tracking-[-0.025em] text-[var(--c-fg)] sm:text-[38px]"
          >
            {user?.name ? <>Welcome back, {user.name.split(' ')[0]}.</> : <>Your meeting workspace.</>}
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
            onClick={() => navigate('/')}
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

          {ACTION_TILES.map((t) => (
            <ActionTile key={t.key} tile={t} onClick={() => navigate(t.to)} />
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
                    onClick={() => navigate(openPathFor(m))}
                    onIntel={() => navigate(meetingIntelligencePath(m.code))}
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
                    <Button asMotion size="sm" block onClick={() => navigate(meetingPath(m.code))} rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
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
                        onClick={() => navigate(openPathFor(m))}
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
                        onClick={(e) => { e.stopPropagation(); navigate(meetingIntelligencePath(m.code)) }}
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

const ACTION_TONE = {
  accent:  'bg-[var(--c-accent-soft)] text-[var(--c-accent)]',
  success: 'bg-[var(--c-success-soft)] text-[var(--c-success)]',
  warn:    'bg-[var(--c-warn-soft)] text-[var(--c-warn)]',
  purple:  'bg-[color-mix(in_srgb,var(--c-accent-3)_18%,transparent)] text-[var(--c-accent-3)]',
}

/**
 * SaaS-grade action card. Neutral surface with a small tinted icon chip;
 * the only "splash" of colour lives on the icon. Hovering subtly lifts
 * the card and brightens the icon ring — same micro-interaction Linear
 * and Vercel use on their dashboard tiles.
 */
function ActionTile({ tile, onClick }) {
  const toneClass = ACTION_TONE[tile.tone] || ACTION_TONE.accent
  return (
    <motion.button
      variants={fadeUp}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      onClick={onClick}
      className={cn(
        'group/tile relative flex aspect-[3/4] flex-col justify-between rounded-2xl border p-4 text-left',
        'border-[var(--c-line)] bg-[var(--c-surface)]',
        'transition-[border-color,box-shadow] duration-200',
        'hover:border-[var(--c-line-strong)] hover:shadow-[0_10px_30px_-12px_color-mix(in_srgb,var(--c-fg)_18%,transparent)]',
        'outline-none focus-visible:ring-4 focus-visible:ring-[var(--c-accent-ring)]'
      )}
    >
      <span
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-200',
          'group-hover/tile:scale-[1.06] [&_svg]:h-[18px] [&_svg]:w-[18px]',
          toneClass
        )}
      >
        {tile.icon}
      </span>
      <div>
        <div className="text-[14px] font-semibold tracking-tight text-[var(--c-fg)]">
          {tile.label}
        </div>
        <div className="mt-0.5 text-[12px] text-[var(--c-fg-muted)]">{tile.sub}</div>
        <span className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--c-fg-dim)] opacity-0 transition-opacity group-hover/tile:opacity-100">
          Open <ArrowRight className="h-3 w-3" />
        </span>
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
