import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle, ArrowRight, Calendar, CalendarPlus, Clock, Lock, Plus,
  Sparkles, Video, Zap,
} from 'lucide-react'
import { api } from '../api/client'
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

const TZ_OPTIONS = [
  'America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Sao_Paulo',
  'Europe/London','Europe/Paris','Europe/Berlin','Europe/Moscow',
  'Asia/Dubai','Asia/Kolkata','Asia/Shanghai','Asia/Tokyo',
  'Australia/Sydney','Pacific/Auckland',
]

/* ─────────────────────── page ─────────────────────── */

export default function Meet() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [recent, setRecent] = useState([])
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
    api('/api/meetings/recent').then(setRecent).catch(() => {})
  }, [])

  const startInstant = async () => {
    setBusy(true)
    setErr('')
    try {
      const meeting = await api('/api/meetings', {
        method: 'POST',
        body: { title: 'Instant meeting' },
      })
      navigate(`/meet/${meeting.code}`)
    } catch (e) {
      setErr(e.message || 'Could not start meeting')
    } finally {
      setBusy(false)
    }
  }

  const joinCode = (e) => {
    e.preventDefault()
    const cleaned = code.trim().toLowerCase()
    if (cleaned) navigate(`/meet/${cleaned}`)
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

  return (
    <div className="relative isolate mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-8 sm:py-10">
      {/* ambient backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -top-32 -left-24 h-[460px] w-[460px] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: 'radial-gradient(closest-side,#5b67f2,transparent 70%)' }}
        />
        <div
          className="absolute -top-24 right-0 h-[460px] w-[460px] rounded-full opacity-[0.16] blur-3xl"
          style={{ background: 'radial-gradient(closest-side,#d670ff,transparent 70%)' }}
        />
      </div>

      {/* ============ Hero ============ */}
      <motion.header
        variants={stagger(0.06)}
        initial="initial"
        animate="animate"
        className="mb-8"
      >
        <motion.div variants={fadeUp}>
          <Badge tone="accent" size="md"><Video className="h-3 w-3" /> Meetings</Badge>
        </motion.div>
        <motion.h1
          variants={fadeUp}
          className="mt-3 text-[34px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[42px]"
        >
          Start or join a <span className="gradient-text">meeting</span>
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-2 max-w-[560px] text-[14.5px] leading-relaxed text-[var(--c-fg-dim)]">
          Instant video calls, one link away. Or schedule ahead and share the code with your team.
        </motion.p>
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
        className="grid gap-4 lg:grid-cols-[1.5fr_1fr_1fr]"
      >
        {/* ── New meeting (featured) ── */}
        <motion.div variants={fadeUp}>
          <Card glow interactive className="group/hero relative overflow-hidden p-6 sm:p-7">
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
              <div className="mb-4 flex items-center justify-between">
                <motion.div
                  whileHover={{ rotate: -8, scale: 1.06 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 18 }}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-accent text-white shadow-[0_8px_22px_-6px_var(--c-accent-ring)]"
                >
                  <Video className="h-6 w-6" />
                </motion.div>
                <Badge tone="live" pulse size="sm">Live</Badge>
              </div>
              <h3 className="text-[22px] font-bold tracking-tight">New meeting</h3>
              <p className="mt-1.5 max-w-[420px] text-[13.5px] leading-relaxed text-[var(--c-fg-dim)]">
                Start an instant video call and copy the shareable link. Anyone with the link can join.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Button
                  size="lg"
                  loading={busy}
                  onClick={startInstant}
                  asMotion
                  leftIcon={!busy && <Zap className="h-4 w-4" />}
                >
                  {busy ? 'Starting…' : 'Start instant meeting'}
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* ── Join with code ── */}
        <motion.div variants={fadeUp}>
          <Card interactive className="group/join h-full p-6">
            <motion.div
              whileHover={{ rotate: -8, scale: 1.08 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--c-accent-soft)] text-[var(--c-accent)] shadow-[0_4px_14px_-4px_var(--c-accent-ring)]"
            >
              <ArrowRight className="h-6 w-6" />
            </motion.div>
            <h3 className="mt-4 text-[17px] font-bold tracking-tight">Join with code</h3>
            <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">Enter the meeting code to join.</p>
            <form onSubmit={joinCode} className="mt-4 space-y-2.5">
              <Input
                placeholder="abc-defg-hij"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mono text-center tracking-widest"
              />
              <Button type="submit" block disabled={!code.trim()} rightIcon={<ArrowRight className="h-4 w-4" />} asMotion>
                Join
              </Button>
            </form>
          </Card>
        </motion.div>

        {/* ── Schedule ── */}
        <motion.div variants={fadeUp}>
          <Card interactive className="group/sched h-full p-6">
            <motion.div
              whileHover={{ rotate: -8, scale: 1.08 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--c-accent-soft)] text-[var(--c-accent)] shadow-[0_4px_14px_-4px_var(--c-accent-ring)]"
            >
              <Calendar className="h-6 w-6" />
            </motion.div>
            <h3 className="mt-4 text-[17px] font-bold tracking-tight">Schedule</h3>
            <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">Plan a meeting for later — share the code in advance.</p>
            <div className="mt-4">
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
      <section className="mt-10">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight">Your meetings</h2>
            <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">Rooms you've created or joined.</p>
          </div>
          {recent.length > 0 && (
            <Badge tone="accent" size="md"><Sparkles className="h-3 w-3" /> {recent.length}</Badge>
          )}
        </div>

        {recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-bg-2)]/40 p-10 text-center">
            <motion.div
              initial={{ scale: 0.9, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 280, damping: 18 }}
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--c-bg-3)] text-[var(--c-fg-muted)] [&_svg]:h-6 [&_svg]:w-6"
            >
              <Video />
            </motion.div>
            <div>
              <div className="text-[14px] font-semibold tracking-tight">No meetings yet</div>
              <div className="mt-1 max-w-md text-[12.5px] text-[var(--c-fg-muted)] leading-relaxed">Start one above to see it listed here.</div>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--c-line)] overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-surface)]">
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
                  >
                    <button
                      onClick={() => navigate(`/meet/${m.code}`)}
                      className="group/row flex w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--c-accent)_5%,transparent)]"
                    >
                      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--c-bg-3)] text-[var(--c-fg-dim)] transition-all duration-200 group-hover/row:scale-110 group-hover/row:bg-[var(--c-accent-soft)] group-hover/row:text-[var(--c-accent)]">
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
                          <span className="truncate text-[13.5px] font-semibold tracking-tight transition-colors group-hover/row:text-[var(--c-accent)]">{m.title}</span>
                          {m.password_protected && <Lock className="h-3 w-3 text-[var(--c-fg-muted)]" />}
                        </div>
                        <div className="mono text-[11px] text-[var(--c-fg-muted)]">{m.code}</div>
                      </div>
                      <div className="hidden text-[12px] sm:block">
                        {m.is_active ? (
                          <Badge tone="live" pulse size="sm">Active</Badge>
                        ) : sched ? (
                          <Badge tone={sched.isPast ? 'neutral' : 'accent'} size="sm">
                            <Calendar className="h-3 w-3" /> {sched.formatted}
                          </Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[var(--c-fg-muted)]">
                            <Clock className="h-3.5 w-3.5" /> {formatWhen(m.created_at)}
                          </span>
                        )}
                      </div>
                      <ArrowRight className="h-4 w-4 -translate-x-1 text-[var(--c-fg-muted)] opacity-0 transition-all duration-200 group-hover/row:translate-x-0 group-hover/row:opacity-100 group-hover/row:text-[var(--c-accent)]" />
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
