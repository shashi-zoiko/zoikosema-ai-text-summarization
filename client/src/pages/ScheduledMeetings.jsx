import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, Calendar, CalendarClock, Check, Copy, Download,
  Globe, Pencil, Trash2, Users2, Video, XCircle,
} from 'lucide-react'
import { api, getApiBase } from '../api/client'
import { meetingPath, meetingShareText } from '../lib/meetingUrls.js'
import { fadeUp, stagger } from '../lib/motion'
import { cn } from '../lib/cn'
import Button from '../components/ui/Button'
import IconButton from '../components/ui/IconButton'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import { Input, Field } from '../components/ui/Input'
import { Card } from '../components/ui/Card'
import Skeleton from '../components/ui/Skeleton'
import { useToast } from '../components/ui/Toast'

/* ────────────────────────── helpers ────────────────────────── */

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Dubai',
  'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney', 'Pacific/Auckland', 'UTC',
]

// Render a stored (UTC) instant in a given IANA zone. Falls back to the
// browser's zone if the meeting has none.
function fmtDate(iso, tz) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString([], {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      ...(tz ? { timeZone: tz } : {}),
    })
  } catch { return new Date(iso).toLocaleDateString() }
}
function fmtTime(iso, tz) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
      ...(tz ? { timeZone: tz } : {}),
    })
  } catch { return new Date(iso).toLocaleTimeString() }
}

const STATUS_TONE = {
  scheduled: 'accent',
  live: 'live',
  ended: 'neutral',
  cancelled: 'danger',
}
const STATUS_LABEL = {
  scheduled: 'Scheduled',
  live: 'Live',
  ended: 'Ended',
  cancelled: 'Cancelled',
}

const TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
]

function tabOf(status) {
  if (status === 'cancelled') return 'cancelled'
  if (status === 'ended') return 'past'
  return 'upcoming' // scheduled + live
}

/* ────────────────────────── page ────────────────────────── */

export default function ScheduledMeetings() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [meetings, setMeetings] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('upcoming')
  const [copiedCode, setCopiedCode] = useState(null)

  // Edit modal
  const [editMeeting, setEditMeeting] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [editTz, setEditTz] = useState('UTC')
  const [editWaiting, setEditWaiting] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyCode, setBusyCode] = useState(null)

  const load = () => {
    setLoading(true)
    api('/api/meetings/scheduled')
      .then((rows) => setMeetings(Array.isArray(rows) ? rows : []))
      .catch(() => setMeetings([]))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const grouped = useMemo(() => {
    const g = { upcoming: [], past: [], cancelled: [] }
    for (const m of meetings) g[tabOf(m.status)]?.push(m)
    // Upcoming reads best soonest-first; the API sorts desc, so flip it.
    g.upcoming.reverse()
    return g
  }, [meetings])

  const rows = grouped[tab] || []

  const copyLink = async (m) => {
    try {
      await navigator.clipboard.writeText(meetingShareText(m.code))
      setCopiedCode(m.code)
      setTimeout(() => setCopiedCode((c) => (c === m.code ? null : c)), 1600)
    } catch {
      toast({ variant: 'error', title: 'Copy failed' })
    }
  }

  const downloadIcs = (m) => {
    const token = localStorage.getItem('zoiko_token') || ''
    fetch(`${getApiBase()}/api/meetings/${m.code}/calendar`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(r)))
      .then((blob) => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${m.title || m.code}.ics`
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(() => toast({ variant: 'error', title: 'Could not download .ics' }))
  }

  const openEdit = (m) => {
    setEditMeeting(m)
    setEditTitle(m.title || '')
    if (m.scheduled_at) {
      const d = new Date(m.scheduled_at)
      const pad = (n) => String(n).padStart(2, '0')
      setEditDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
      setEditTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
    } else {
      setEditDate(''); setEditTime('')
    }
    setEditTz(m.timezone_name || Intl.DateTimeFormat().resolvedOptions().timeZone)
    setEditWaiting(m.waiting_room_enabled !== false)
  }

  const saveEdit = async () => {
    if (!editMeeting) return
    setSaving(true)
    try {
      const body = {
        title: editTitle.trim() || editMeeting.title,
        timezone_name: editTz,
        waiting_room_enabled: editWaiting,
      }
      if (editDate && editTime) body.scheduled_at = new Date(`${editDate}T${editTime}`).toISOString()
      const updated = await api(`/api/meetings/${editMeeting.code}`, { method: 'PATCH', body })
      setMeetings((prev) => prev.map((r) => (r.code === updated.code ? { ...r, ...updated } : r)))
      // Re-notify invitees of the change (best-effort; server dedupes by email).
      toast({ variant: 'success', title: 'Meeting updated' })
      setEditMeeting(null)
    } catch (e) {
      toast({ variant: 'error', title: 'Could not update', description: e.message })
    } finally {
      setSaving(false)
    }
  }

  const cancelMeeting = async (m) => {
    if (!window.confirm(`Cancel "${m.title}"? Invitees will be emailed that it's cancelled.`)) return
    setBusyCode(m.code)
    try {
      const updated = await api(`/api/meetings/${m.code}/cancel`, { method: 'POST' })
      setMeetings((prev) => prev.map((r) => (r.code === updated.code ? { ...r, ...updated } : r)))
      toast({ variant: 'success', title: 'Meeting cancelled', description: 'Invitees have been notified.' })
    } catch (e) {
      toast({ variant: 'error', title: 'Could not cancel', description: e.message })
    } finally {
      setBusyCode(null)
    }
  }

  const deleteMeeting = async (m) => {
    if (!window.confirm(`Delete "${m.title}" permanently? This cannot be undone.`)) return
    setBusyCode(m.code)
    try {
      await api(`/api/meetings/${m.code}`, { method: 'DELETE' })
      setMeetings((prev) => prev.filter((r) => r.code !== m.code))
      toast({ variant: 'success', title: 'Meeting deleted' })
    } catch (e) {
      toast({ variant: 'error', title: 'Could not delete', description: e.message })
    } finally {
      setBusyCode(null)
    }
  }

  return (
    <div className="relative mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-8 sm:py-10">
      {/* Header */}
      <motion.div variants={stagger(0.05)} initial="initial" animate="animate" className="mb-6 flex flex-wrap items-center gap-3">
        <motion.div variants={fadeUp} className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--c-accent-soft)] text-[var(--c-accent)]">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[22px] font-bold leading-none tracking-[-0.02em] sm:text-[26px]">Scheduled meetings</h1>
            <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">Plan ahead, invite people, and manage everything in one place.</p>
          </div>
        </motion.div>
        <motion.div variants={fadeUp} className="ml-auto">
          <Button asMotion leftIcon={<Calendar className="h-4 w-4" />} onClick={() => navigate('/')}>
            Schedule a meeting
          </Button>
        </motion.div>
      </motion.div>

      {/* Tabs */}
      <div className="mb-5 flex items-center gap-1 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/50 p-1">
        {TABS.map((t) => {
          const count = grouped[t.key]?.length || 0
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold tracking-tight transition',
                active ? 'text-[var(--c-fg)]' : 'text-[var(--c-fg-muted)] hover:text-[var(--c-fg-dim)]'
              )}
            >
              {active && (
                <motion.span layoutId="sched-tab" className="absolute inset-0 rounded-lg bg-[var(--c-surface)] shadow-sm" transition={{ type: 'spring', stiffness: 380, damping: 30 }} />
              )}
              <span className="relative">{t.label} <span className="ml-1 tabular-nums text-[var(--c-fg-muted)]">{count}</span></span>
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-2xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState tab={tab} onSchedule={() => navigate('/')} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--c-line)] bg-[var(--c-surface)]">
          <div className="hidden grid-cols-[1fr_150px_120px_150px_110px_180px] gap-4 border-b border-[var(--c-line)] bg-[var(--c-bg-2)]/40 px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.10em] text-[var(--c-fg-muted)] lg:grid">
            <span>Meeting</span><span>Date</span><span>Time</span><span>Timezone</span><span>Status</span><span className="text-right">Actions</span>
          </div>
          <ul className="divide-y divide-[var(--c-line)]">
            <AnimatePresence initial={false}>
              {rows.map((m) => (
                <MeetingRow
                  key={m.id}
                  m={m}
                  copied={copiedCode === m.code}
                  busy={busyCode === m.code}
                  onJoin={() => navigate(meetingPath(m.code))}
                  onCopy={() => copyLink(m)}
                  onIcs={() => downloadIcs(m)}
                  onEdit={() => openEdit(m)}
                  onCancel={() => cancelMeeting(m)}
                  onDelete={() => deleteMeeting(m)}
                />
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}

      {/* Edit modal */}
      <Modal
        open={!!editMeeting}
        onClose={() => setEditMeeting(null)}
        title="Edit scheduled meeting"
        description="Update the details. Changes save immediately."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditMeeting(null)}>Cancel</Button>
            <Button onClick={saveEdit} loading={saving} disabled={!editTitle.trim()} leftIcon={!saving && <Pencil className="h-4 w-4" />} asMotion>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Meeting title" required>
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} /></Field>
            <Field label="Time"><Input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} /></Field>
          </div>
          <Field label="Timezone">
            <select
              value={editTz}
              onChange={(e) => setEditTz(e.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 text-[14px] text-[var(--c-fg)] outline-none transition focus:border-[var(--c-accent)] focus:shadow-[0_0_0_4px_var(--c-accent-ring)]"
            >
              {[...new Set([...TIMEZONES, editTz])].map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3 transition-colors hover:border-[var(--c-line-strong)]">
            <input type="checkbox" checked={editWaiting} onChange={(e) => setEditWaiting(e.target.checked)} className="h-4 w-4 rounded accent-[var(--c-accent)]" />
            <div className="flex-1">
              <div className="text-[13px] font-semibold">Waiting room</div>
              <div className="text-[11.5px] text-[var(--c-fg-muted)]">Approve attendees before they join.</div>
            </div>
          </label>
        </div>
      </Modal>
    </div>
  )
}

/* ────────────────────────── pieces ────────────────────────── */

function MeetingRow({ m, copied, busy, onJoin, onCopy, onIcs, onEdit, onCancel, onDelete }) {
  const canJoin = m.status === 'scheduled' || m.status === 'live'
  const canManage = m.status === 'scheduled' || m.status === 'live'
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className="grid grid-cols-1 gap-3 px-4 py-3.5 sm:px-5 lg:grid-cols-[1fr_150px_120px_150px_110px_180px] lg:items-center lg:gap-4"
    >
      {/* Meeting */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--c-accent-soft)] text-[var(--c-accent)]">
          <Video className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold tracking-tight">{m.title}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--c-fg-muted)]">
            <span className="mono">{m.code}</span>
            <span className="inline-flex items-center gap-1"><Users2 className="h-3 w-3" />{m.invite_count || 0}</span>
          </div>
        </div>
      </div>

      {/* Date / Time / TZ (stacked on mobile via labels) */}
      <div className="text-[12.5px] text-[var(--c-fg-dim)]">
        <span className="lg:hidden text-[var(--c-fg-muted)]">Date · </span>{fmtDate(m.scheduled_at, m.timezone_name)}
      </div>
      <div className="text-[12.5px] tabular-nums text-[var(--c-fg-dim)]">
        <span className="lg:hidden text-[var(--c-fg-muted)]">Time · </span>{fmtTime(m.scheduled_at, m.timezone_name)}
      </div>
      <div className="flex items-center gap-1.5 truncate text-[12px] text-[var(--c-fg-muted)]">
        <Globe className="hidden h-3.5 w-3.5 shrink-0 lg:inline" />
        <span className="truncate">{(m.timezone_name || 'Local').replace(/_/g, ' ')}</span>
      </div>

      {/* Status */}
      <div>
        <Badge tone={STATUS_TONE[m.status] || 'neutral'} size="sm" pulse={m.status === 'live'}>
          {STATUS_LABEL[m.status] || m.status}
        </Badge>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-start gap-1 lg:justify-end">
        {canJoin && (
          <Button asMotion size="sm" onClick={onJoin} rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>Join</Button>
        )}
        <IconButton variant="ghost" size="sm" label={copied ? 'Copied' : 'Copy link'} onClick={onCopy}>
          {copied ? <Check className="text-[var(--c-success)]" /> : <Copy />}
        </IconButton>
        {m.scheduled_at && (
          <IconButton variant="ghost" size="sm" label="Download .ics" onClick={onIcs}><Download /></IconButton>
        )}
        {canManage && (
          <>
            <IconButton variant="ghost" size="sm" label="Edit" onClick={onEdit} disabled={busy}><Pencil /></IconButton>
            <IconButton variant="ghost" size="sm" label="Cancel meeting" onClick={onCancel} disabled={busy}><XCircle /></IconButton>
          </>
        )}
        <IconButton variant="ghost" size="sm" label="Delete" onClick={onDelete} disabled={busy}><Trash2 /></IconButton>
      </div>
    </motion.li>
  )
}

function EmptyState({ tab, onSchedule }) {
  const copy = {
    upcoming: { title: 'No upcoming meetings', desc: 'Schedule one and it’ll show up here with invites and reminders handled for you.' },
    past: { title: 'No past meetings', desc: 'Meetings you’ve hosted will move here once they end.' },
    cancelled: { title: 'Nothing cancelled', desc: 'Cancelled meetings will appear here.' },
  }[tab]
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-bg-2)]/40 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--c-bg-3)] text-[var(--c-fg-muted)]">
        <Calendar className="h-6 w-6" />
      </div>
      <div>
        <div className="text-[14px] font-semibold tracking-tight">{copy.title}</div>
        <div className="mt-1 max-w-md text-[12.5px] text-[var(--c-fg-muted)]">{copy.desc}</div>
      </div>
      {tab === 'upcoming' && (
        <Button asMotion className="mt-1" leftIcon={<Calendar className="h-4 w-4" />} onClick={onSchedule}>Schedule a meeting</Button>
      )}
    </div>
  )
}
