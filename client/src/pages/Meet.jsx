import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { meetingPath } from '../lib/meetingUrls.js'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle, ArrowRight, Calendar, CalendarClock, CalendarPlus,
  Clock, Hand, Lock, Video,
} from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { fadeUp, stagger } from '../lib/motion'
import Button from '../components/ui/Button'
import { Input, Field } from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import { Card } from '../components/ui/Card'
import { useToast } from '../components/ui/Toast'

/* ────────────────────────── helpers ────────────────────────── */

function formatWhen(iso) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const mins = Math.floor((now - d) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch { return '' }
}
function formatScheduled(iso, tz) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const opts = { dateStyle: 'medium', timeStyle: 'short' }
    if (tz) opts.timeZone = tz
    return { formatted: d.toLocaleString([], opts), isPast: d < now }
  } catch {
    return { formatted: '', isPast: false }
  }
}
function greetingFor(date) {
  const h = date.getHours()
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

const TZ_OPTIONS = [
  'America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Sao_Paulo',
  'Europe/London','Europe/Paris','Europe/Berlin','Europe/Moscow',
  'Asia/Dubai','Asia/Kolkata','Asia/Shanghai','Asia/Tokyo',
  'Australia/Sydney','Pacific/Auckland',
]

/* ───────────────────── small presentational bits ───────────────────── */

function RowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="skeleton h-10 w-10 rounded-xl" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3.5 w-40 rounded" />
        <div className="skeleton h-3 w-24 rounded" />
      </div>
      <div className="skeleton h-6 w-16 rounded-full" />
    </div>
  )
}

/* ─────────────────────── page ─────────────────────── */

export default function Meet() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  /* Schedule form state */
  const [showSchedule, setShowSchedule] = useState(false)
  const [schedTitle, setSchedTitle] = useState('')
  const [schedDate, setSchedDate] = useState('')
  const [schedTime, setSchedTime] = useState('')
  const [schedTz, setSchedTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [schedWaiting, setSchedWaiting] = useState(true)
  const [scheduling, setScheduling] = useState(false)

  useEffect(() => {
    api('/api/meetings/recent')
      .then(setRecent)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const startInstant = async () => {
    setBusy(true)
    setErr('')
    try {
      const meeting = await api('/api/meetings', {
        method: 'POST',
        body: { title: 'Instant meeting' },
      })
      navigate(meetingPath(meeting.code))
    } catch (e) {
      setErr(e.message || 'Could not start meeting')
    } finally {
      setBusy(false)
    }
  }

  const joinCode = (e) => {
    e.preventDefault()
    const cleaned = code.trim().toLowerCase()
    if (cleaned) navigate(meetingPath(cleaned))
  }

  const scheduleMeeting = async (e) => {
    if (e?.preventDefault) e.preventDefault()
    if (!schedDate || !schedTime) return
    setScheduling(true)
    setErr('')
    try {
      const scheduledAt = new Date(`${schedDate}T${schedTime}`).toISOString()
      const meeting = await api('/api/meetings', {
        method: 'POST',
        body: {
          title: schedTitle || 'Scheduled meeting',
          scheduled_at: scheduledAt,
          timezone_name: schedTz || null,
          waiting_room_enabled: schedWaiting,
        },
      })
      setShowSchedule(false)
      setSchedTitle(''); setSchedDate(''); setSchedTime(''); setSchedWaiting(true)
      setRecent((prev) => [meeting, ...prev])
      toast({ variant: 'success', title: 'Meeting scheduled', description: meeting.title })
    } catch (e) {
      setErr(e.message || 'Could not schedule')
    } finally {
      setScheduling(false)
    }
  }

  const tzOptions = useMemo(() => {
    const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return TZ_OPTIONS.includes(userTz) ? TZ_OPTIONS : [userTz, ...TZ_OPTIONS]
  }, [])

  /* Count of upcoming scheduled rooms — drives the Schedule card hint. */
  const upcomingCount = useMemo(
    () => recent.filter((m) => m.scheduled_at && new Date(m.scheduled_at) > new Date()).length,
    [recent]
  )

  const greeting = useMemo(() => greetingFor(new Date()), [])
  const firstName = (user?.name || '').trim().split(/\s+/)[0]

  return (
    <div className="relative isolate mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-8 sm:py-10">
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
        <div
          className="absolute top-[260px] left-1/3 h-[360px] w-[360px] rounded-full opacity-[0.10] blur-3xl"
          style={{ background: 'radial-gradient(closest-side,#15936b,transparent 70%)' }}
        />
        <div className="grid-pattern absolute inset-x-0 top-0 h-[420px] opacity-60" />
      </div>

      {/* ============ Hero ============ */}
      <motion.header
        variants={stagger(0.06)}
        initial="initial"
        animate="animate"
        className="mb-9"
      >
        <motion.div variants={fadeUp} className="flex items-center gap-2 text-[13px] font-medium text-[var(--c-fg-muted)]">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)]">
            <Video className="h-3.5 w-3.5" />
          </span>
          {greeting}{firstName ? `, ${firstName}` : ''}
        </motion.div>
        <motion.h1
          variants={fadeUp}
          className="mt-3 text-[34px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[44px]"
        >
          Start or join a <span className="gradient-text">meeting</span>
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-2.5 max-w-[560px] text-[14.5px] leading-relaxed text-[var(--c-fg-dim)]">
          Start, join and manage your team meetings — one link away, or scheduled ahead and shared with the room.
        </motion.p>

        {/* quick actions */}
        <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2.5">
          <Button
            size="lg"
            loading={busy}
            onClick={startInstant}
            asMotion
            leftIcon={!busy && <Video className="h-4 w-4" />}
          >
            {busy ? 'Starting…' : 'New meeting'}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => document.getElementById('zk-join-input')?.focus()}
            asMotion
            leftIcon={<ArrowRight className="h-4 w-4" />}
          >
            Join meeting
          </Button>
        </motion.div>
      </motion.header>

      <AnimatePresence>
        {err && (
          <motion.div
            key="err"
            role="alert"
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.22 }}
            className="mb-4 overflow-hidden"
          >
            <div className="flex items-start gap-2.5 rounded-xl border border-[var(--c-danger)]/40 bg-[var(--c-danger-soft)] p-3 text-[13px] text-[var(--c-danger)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="font-medium">{err}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ Action cards ============ */}
      <motion.section
        variants={stagger(0.05)}
        initial="initial"
        animate="animate"
        className="grid items-stretch gap-4 lg:grid-cols-[1.5fr_1fr_1fr]"
      >
        {/* ── New meeting (featured) ── */}
        <motion.div variants={fadeUp} className="h-full">
          <Card glow interactive fill className="group/hero relative h-full overflow-hidden p-6 sm:p-7">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.65] transition-opacity duration-500 group-hover/hero:opacity-90"
              style={{
                background:
                  'radial-gradient(700px 220px at 0% 0%, color-mix(in srgb, var(--c-accent) 22%, transparent), transparent 55%),' +
                  'radial-gradient(420px 200px at 100% 100%, color-mix(in srgb, var(--c-accent-3) 18%, transparent), transparent 60%)',
              }}
            />
            <div className="relative flex h-full flex-col">
              <div className="mb-5 flex items-center justify-between">
                <motion.div
                  whileHover={{ rotate: -8, scale: 1.06 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                  className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-accent text-white shadow-[0_10px_28px_-6px_var(--c-accent-ring)]"
                >
                  <Video className="h-7 w-7" />
                </motion.div>
                <Badge tone="live" pulse size="md">Ready</Badge>
              </div>
              <h3 className="text-[23px] font-bold tracking-tight">New meeting</h3>
              <p className="mt-2 max-w-[420px] text-[13.5px] leading-relaxed text-[var(--c-fg-dim)]">
                Start an instant video call and copy the shareable link. Anyone with the link can join.
              </p>
              <div className="mt-auto pt-6">
                <Button
                  size="lg"
                  loading={busy}
                  onClick={startInstant}
                  asMotion
                  leftIcon={!busy && <Video className="h-4 w-4" />}
                >
                  {busy ? 'Starting…' : 'Start instant meeting'}
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* ── Join with code ── */}
        <motion.div variants={fadeUp} className="h-full">
          <Card interactive fill className="group/join h-full p-6">
            <motion.div
              whileHover={{ rotate: -8, scale: 1.08 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--c-accent-soft)] text-[var(--c-accent)] shadow-[0_4px_14px_-4px_var(--c-accent-ring)]"
            >
              <ArrowRight className="h-6 w-6" />
            </motion.div>
            <h3 className="mt-4 text-[17px] font-bold tracking-tight">Join with code</h3>
            <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">Enter the meeting code to join.</p>
            <form onSubmit={joinCode} className="mt-auto space-y-2.5 pt-4">
              <Input
                id="zk-join-input"
                placeholder="abc-defg-hij"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mono text-center tracking-[0.25em]"
                aria-label="Meeting code"
              />
              <Button type="submit" block disabled={!code.trim()} rightIcon={<ArrowRight className="h-4 w-4" />} asMotion>
                Join
              </Button>
            </form>
          </Card>
        </motion.div>

        {/* ── Schedule ── */}
        <motion.div variants={fadeUp} className="h-full">
          <Card interactive fill className="group/sched h-full p-6">
            <motion.div
              whileHover={{ rotate: -8, scale: 1.08 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--c-accent-soft)] text-[var(--c-accent)] shadow-[0_4px_14px_-4px_var(--c-accent-ring)]"
            >
              <Calendar className="h-6 w-6" />
            </motion.div>
            <h3 className="mt-4 text-[17px] font-bold tracking-tight">Schedule</h3>
            <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">Plan a meeting for later — share the code in advance.</p>
            {upcomingCount > 0 ? (
              <div className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg bg-[var(--c-accent-soft)] px-2 py-1 text-[11.5px] font-medium text-[var(--c-accent)]">
                <CalendarClock className="h-3.5 w-3.5" />
                {upcomingCount} upcoming
              </div>
            ) : (
              <div className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg bg-[var(--c-bg-3)] px-2 py-1 text-[11.5px] font-medium text-[var(--c-fg-muted)]">
                <CalendarClock className="h-3.5 w-3.5" />
                Nothing scheduled
              </div>
            )}
            <div className="mt-auto pt-4">
              <Button
                block
                variant="outline"
                onClick={() => setShowSchedule(true)}
                leftIcon={<CalendarPlus className="h-4 w-4" />}
                asMotion
              >
                Schedule meeting
              </Button>
            </div>
          </Card>
        </motion.div>
      </motion.section>

      {/* ============ Recent meetings ============ */}
      <section className="mt-12">
        <div className="mb-4">
          <h2 className="text-[19px] font-semibold tracking-tight">Your meetings</h2>
          <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">Rooms you've created or joined.</p>
        </div>

        {loading ? (
          <div className="divide-y divide-[var(--c-line)] overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-surface)]">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-bg-2)]/40 p-12 text-center">
            <motion.div
              initial={{ scale: 0.9, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 280, damping: 18 }}
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--c-bg-3)] text-[var(--c-fg-muted)] [&_svg]:h-7 [&_svg]:w-7"
            >
              <Video />
            </motion.div>
            <div>
              <div className="text-[14.5px] font-semibold tracking-tight">No meetings yet</div>
              <div className="mt-1 max-w-md text-[12.5px] text-[var(--c-fg-muted)] leading-relaxed">Start one above to see it listed here.</div>
            </div>
            <Button onClick={startInstant} loading={busy} asMotion leftIcon={!busy && <Video className="h-4 w-4" />} className="mt-1">
              Start instant meeting
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--c-line)] overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.3)]">
            <AnimatePresence initial={false}>
              {recent.map((m, i) => {
                const sched = m.scheduled_at ? formatScheduled(m.scheduled_at, m.timezone_name) : null
                return (
                  <motion.li
                    key={m.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
                    exit={{ opacity: 0, y: -6 }}
                    className={m.is_active ? '' : 'opacity-[0.92]'}
                  >
                    <button
                      onClick={() => navigate(meetingPath(m.code))}
                      className="group/row relative flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--c-accent)_6%,transparent)]"
                    >
                      {/* active accent rail */}
                      {m.is_active && (
                        <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[var(--c-success)]" />
                      )}
                      <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--c-bg-3)] text-[var(--c-fg-dim)] transition-all duration-200 group-hover/row:scale-105 group-hover/row:bg-[var(--c-accent-soft)] group-hover/row:text-[var(--c-accent)]">
                        <Video className="h-5 w-5" />
                        {m.is_active && (
                          <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--c-success)] opacity-75" />
                            <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--c-success)] ring-2 ring-[var(--c-surface)]" />
                          </span>
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-semibold tracking-tight transition-colors group-hover/row:text-[var(--c-accent)]">{m.title}</span>
                          {m.password_protected && <Lock className="h-3 w-3 shrink-0 text-[var(--c-fg-muted)]" />}
                          {m.waiting_room_enabled && <Hand className="h-3 w-3 shrink-0 text-[var(--c-fg-muted)]" />}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--c-fg-muted)]">
                          <span className="mono">{m.code}</span>
                          <span className="hidden h-1 w-1 rounded-full bg-[var(--c-fg-muted)]/50 sm:inline-block" />
                          <span className="hidden items-center gap-1 sm:inline-flex">
                            <Clock className="h-3 w-3" /> {formatWhen(m.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="hidden text-[12px] sm:block">
                        {m.is_active ? (
                          <Badge tone="live" pulse size="sm">Active</Badge>
                        ) : sched ? (
                          <Badge tone={sched.isPast ? 'neutral' : 'accent'} size="sm">
                            <Calendar className="h-3 w-3" /> {sched.formatted}
                          </Badge>
                        ) : (
                          <Badge tone="neutral" size="sm">Ended</Badge>
                        )}
                      </div>
                      {/* quick-join affordance */}
                      <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-[var(--c-accent)] opacity-0 transition-all duration-200 group-hover/row:bg-[var(--c-accent-soft)] group-hover/row:opacity-100">
                        Join
                        <ArrowRight className="h-3.5 w-3.5 -translate-x-1 transition-transform duration-200 group-hover/row:translate-x-0" />
                      </span>
                    </button>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {/* ============ Schedule modal ============ */}
      <Modal
        open={showSchedule}
        onClose={() => setShowSchedule(false)}
        title="Schedule a meeting"
        description="Pick a date, choose a timezone, and we'll create the room."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowSchedule(false)}>Cancel</Button>
            <Button
              onClick={scheduleMeeting}
              loading={scheduling}
              disabled={!schedDate || !schedTime}
              leftIcon={!scheduling && <Calendar className="h-4 w-4" />}
              asMotion
            >
              {scheduling ? 'Scheduling…' : 'Schedule'}
            </Button>
          </>
        }
      >
        <form onSubmit={scheduleMeeting} className="space-y-4">
          <Field label="Title">
            <Input
              placeholder="Scheduled meeting"
              value={schedTitle}
              onChange={(e) => setSchedTitle(e.target.value)}
              maxLength={200}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" required>
              <Input
                type="date"
                value={schedDate}
                onChange={(e) => setSchedDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                required
              />
            </Field>
            <Field label="Time" required>
              <Input
                type="time"
                value={schedTime}
                onChange={(e) => setSchedTime(e.target.value)}
                required
              />
            </Field>
          </div>
          <Field label="Timezone">
            <select
              value={schedTz}
              onChange={(e) => setSchedTz(e.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 text-[14px] font-medium text-[var(--c-fg)] outline-none transition focus:border-[var(--c-accent)] focus:shadow-[0_0_0_4px_var(--c-accent-ring)]"
            >
              {tzOptions.map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
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
        </form>
      </Modal>
    </div>
  )
}
