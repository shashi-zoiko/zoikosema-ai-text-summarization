import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, MapPin, Plus, Users2 } from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/cn'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'

/* Phase 2 slice 9 (added after the fact — see plans/sema-roadmap.md) —
 * native calendar view. The original 8 Phase 2 slices built the backend
 * (native CalendarEvent CRUD/versioning, recurrence, Policy Engine,
 * Scheduling Engine, Action Review Queue) but never a page to look at it;
 * this is that page. Read-only sync'd events (Google/Outlook, via
 * GET /calendar/events) and Sema-native events (GET /calendar/native-events,
 * with recurring series expanded via .../occurrences for the visible range)
 * are merged into one month grid. Creating an event goes through the same
 * governed path everything else in Connect uses — POST can come back
 * `{staged: true}` at L2+ autonomy ceilings, in which case it shows up in
 * /review-queue instead of the calendar until approved. */

function startOfMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - first.getDay()) // back up to Sunday
  return gridStart
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function CalendarView() {
  const { toast } = useToast()
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [events, setEvents] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  const gridDays = useMemo(() => {
    const gridStart = startOfMonthGrid(cursor.getFullYear(), cursor.getMonth())
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      return d
    })
  }, [cursor])

  const rangeStart = gridDays[0]
  const rangeEnd = gridDays[gridDays.length - 1]

  useEffect(() => {
    let cancelled = false
    const timeMin = rangeStart.toISOString()
    const timeMax = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59).toISOString()

    async function load() {
      setError(null)
      try {
        const [external, native] = await Promise.all([
          api(`/api/connect/calendar/events?time_min=${encodeURIComponent(timeMin)}&time_max=${encodeURIComponent(timeMax)}`),
          api(`/api/connect/calendar/native-events?time_min=${encodeURIComponent(timeMin)}&time_max=${encodeURIComponent(timeMax)}`),
        ])

        const recurring = native.filter((e) => e.rrule)
        const nonRecurring = native.filter((e) => !e.rrule)

        const occurrenceLists = await Promise.all(
          recurring.map((e) =>
            api(
              `/api/connect/calendar/native-events/${encodeURIComponent(e.version_chain_id)}/occurrences` +
              `?range_start=${encodeURIComponent(timeMin)}&range_end=${encodeURIComponent(timeMax)}`,
            ).catch(() => []), // one bad series shouldn't blank the whole month
          ),
        )

        const merged = [
          ...external.map((e) => ({
            key: `ext-${e.id}`,
            title: e.title || '(no title)',
            start: e.start_at ? new Date(e.start_at) : null,
            end: e.end_at ? new Date(e.end_at) : null,
            allDay: e.all_day,
            location: e.location,
            description: e.description,
            attendees: e.attendees || [],
            source: 'external',
            provider: e.provider,
            status: e.status,
          })),
          ...nonRecurring.map((e) => ({
            key: `native-${e.id}`,
            versionChainId: e.version_chain_id,
            title: e.title,
            start: new Date(e.start_at),
            end: new Date(e.end_at),
            allDay: false,
            location: e.location,
            description: e.description,
            attendees: e.attendees || [],
            source: 'native',
            confidentiality: e.confidentiality_class,
            status: e.status,
          })),
          ...occurrenceLists.flatMap((occs, i) =>
            occs.map((o) => ({
              key: `native-${recurring[i].version_chain_id}-${o.recurrence_id || o.start_at}`,
              versionChainId: o.version_chain_id,
              recurrenceId: o.recurrence_id,
              title: o.title,
              start: new Date(o.start_at),
              end: new Date(o.end_at),
              allDay: false,
              location: o.location,
              description: o.description,
              attendees: o.attendees || [],
              source: 'native',
              confidentiality: o.confidentiality_class,
              status: o.status,
              recurring: true,
            })),
          ),
        ].filter((e) => e.start && e.status !== 'cancelled')

        if (!cancelled) setEvents(merged)
      } catch (err) {
        if (!cancelled) { setError(err.message); setEvents([]) }
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor])

  const eventsByDay = useMemo(() => {
    const map = new Map()
    if (!events) return map
    for (const ev of events) {
      const key = ev.start.toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(ev)
    }
    for (const list of map.values()) list.sort((a, b) => a.start - b.start)
    return map
  }, [events])

  const today = new Date()
  const monthLabel = cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })

  const onCreated = () => {
    setShowCreate(false)
    setCursor((c) => new Date(c)) // trigger refetch of current range
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-10 sm:px-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Calendar</h1>
          <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">
            Your Sema calendar — native events plus anything synced from Google or Outlook.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" /> New event
        </Button>
      </header>

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="secondary" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>
            Today
          </Button>
        </div>
        <div className="text-[15px] font-semibold text-[var(--c-fg)]">{monthLabel}</div>
      </div>

      {error && (
        <div className="mb-4 rounded-[10px] border border-[color-mix(in_srgb,var(--c-danger)_30%,var(--c-line))] px-4 py-3 text-[13.5px] text-[var(--c-danger)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[14px] border border-[var(--c-line)] bg-[var(--c-line)] shadow-sm">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="bg-[var(--c-bg-2)] px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--c-fg-muted)]">
            {d}
          </div>
        ))}
        {gridDays.map((day) => {
          const inMonth = day.getMonth() === cursor.getMonth()
          const isToday = sameDay(day, today)
          const dayEvents = eventsByDay.get(day.toDateString()) || []
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'min-h-[104px] bg-[var(--c-bg-1)] p-1.5 align-top',
                !inMonth && 'opacity-45',
              )}
            >
              <div className={cn(
                'mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11.5px] font-medium',
                isToday ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-fg-muted)]',
              )}>
                {day.getDate()}
              </div>
              {events === null && inMonth && day.getDate() === 1 && (
                <div className="text-[11px] text-[var(--c-fg-muted)]"><Spinner size="sm" /></div>
              )}
              <div className="space-y-1">
                {dayEvents.slice(0, 3).map((ev) => (
                  <button
                    key={ev.key}
                    onClick={() => setSelected(ev)}
                    className={cn(
                      'block w-full truncate rounded-[6px] px-1.5 py-0.5 text-left text-[11px] font-medium',
                      ev.source === 'native'
                        ? 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]'
                        : 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)]',
                    )}
                    title={ev.title}
                  >
                    {!ev.allDay && <span className="opacity-70">{fmtTime(ev.start)} </span>}
                    {ev.title}
                  </button>
                ))}
                {dayEvents.length > 3 && (
                  <div className="px-1.5 text-[10.5px] text-[var(--c-fg-muted)]">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <EventDetailModal event={selected} onClose={() => setSelected(null)} />
      <CreateEventModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={onCreated} toast={toast} />
    </div>
  )
}

function EventDetailModal({ event, onClose }) {
  return (
    <Modal open={!!event} onClose={onClose} title={event?.title} size="sm">
      {event && (
        <div className="space-y-3 text-[13.5px] text-[var(--c-fg)]">
          <div className="flex items-center gap-2 text-[var(--c-fg-muted)]">
            <span>
              {event.allDay ? 'All day' : `${fmtTime(event.start)} – ${fmtTime(event.end)}`}
              {' · '}
              {event.start.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[var(--c-fg-muted)]" /> {event.location}
            </div>
          )}
          {event.attendees?.length > 0 && (
            <div className="flex items-start gap-2">
              <Users2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-fg-muted)]" />
              <span>{event.attendees.map((a) => a.email || a.name || JSON.stringify(a)).join(', ')}</span>
            </div>
          )}
          {event.description && <p className="text-[var(--c-fg-dim)]">{event.description}</p>}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge tone={event.source === 'native' ? 'accent' : 'neutral'} size="sm">
              {event.source === 'native' ? 'Sema' : event.provider === 'microsoft_calendar' ? 'Outlook' : 'Google'}
            </Badge>
            {event.recurring && <Badge tone="neutral" size="sm">Recurring</Badge>}
            {event.confidentiality === 'confidential' && <Badge tone="warn" size="sm">Confidential</Badge>}
          </div>
        </div>
      )}
    </Modal>
  )
}

function CreateEventModal({ open, onClose, onCreated, toast }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('09:30')
  const [location, setLocation] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      const now = new Date()
      setDate(now.toISOString().slice(0, 10))
      setTitle('')
      setLocation('')
    }
  }, [open])

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim() || !date) return
    setSaving(true)
    try {
      const start_at = new Date(`${date}T${startTime}`).toISOString()
      const end_at = new Date(`${date}T${endTime}`).toISOString()
      const result = await api('/api/connect/calendar/native-events', {
        method: 'POST',
        body: {
          title: title.trim(),
          start_at,
          end_at,
          location: location.trim() || null,
          timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })
      toast({
        variant: 'success',
        title: result.staged ? 'Submitted for review' : 'Event created',
        description: result.staged
          ? 'This needs approval before it appears on the calendar — check Review Queue.'
          : title.trim(),
      })
      onCreated()
    } catch (err) {
      toast({ variant: 'error', title: 'Could not create event', description: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New event" size="sm">
      <form onSubmit={submit} className="space-y-3">
        <LabeledInput label="Title">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none"
            placeholder="Team sync"
          />
        </LabeledInput>
        <LabeledInput label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none"
          />
        </LabeledInput>
        <div className="grid grid-cols-2 gap-3">
          <LabeledInput label="Start">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
              className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none"
            />
          </LabeledInput>
          <LabeledInput label="End">
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
              className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none"
            />
          </LabeledInput>
        </div>
        <LabeledInput label="Location (optional)">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none"
            placeholder="Room 4 / video link"
          />
        </LabeledInput>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function LabeledInput({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-[var(--c-fg-muted)]">{label}</span>
      <div className="rounded-[9px] border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3 py-2">
        {children}
      </div>
    </label>
  )
}
