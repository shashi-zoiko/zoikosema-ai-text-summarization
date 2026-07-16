import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, MapPin, Pencil, Plus, Trash2, Users2, X } from 'lucide-react'
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
 * this is that page. Read-only sync'd events (Google, via GET
 * /calendar/events) and Sema-native events (GET /calendar/native-events,
 * with recurring series expanded via .../occurrences for the visible range)
 * are merged into one grid — Day, Week (the default, like most calendar
 * apps' primary view), or Month. Day and Week share the same hour-grid
 * component (WeekGrid — it's generic over however many day columns it's
 * given), just one day column instead of seven. Not a clone of any one
 * product, but the click-a-slot-to-schedule interaction is table stakes for
 * a calendar: clicking an empty time slot (day/week view) or an empty day
 * (month view) opens the create form with that date/time already filled
 * in — still fully editable, just not blank by default. Creating an event
 * goes through the same governed path everything else in Connect uses —
 * POST can come back `{staged: true}` at L2+ autonomy ceilings, in which
 * case it shows up in /review-queue instead of the calendar until approved. */

const HOUR_H = 48 // px per hour row in week view

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function startOfWeek(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() - r.getDay())
  return r
}

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

function fmtHourLabel(h) {
  return new Date(2000, 0, 1, h, 0).toLocaleTimeString([], { hour: 'numeric' })
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function isoDateLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function hhmm(hour, minute) {
  return `${pad(hour)}:${pad(minute)}`
}

// 30-minute default duration, clamped so a 23:xx slot doesn't roll into
// tomorrow's date field.
function plusThirtyMin(hour, minute) {
  const total = Math.min(hour * 60 + minute + 30, 23 * 60 + 59)
  return hhmm(Math.floor(total / 60), total % 60)
}

// A recurring occurrence's edit/delete target its one instance
// (.../occurrences/{recurrenceId}); a non-recurring native event targets
// the series directly — both are "the whole thing" when there's only one.
function nativeEventPath(ev) {
  const base = `/api/connect/calendar/native-events/${encodeURIComponent(ev.versionChainId)}`
  return ev.recurring ? `${base}/occurrences/${encodeURIComponent(ev.recurrenceId)}` : base
}

// Assigns each event a { col, colCount } so overlapping events split into
// side-by-side columns instead of stacking on top of each other. Standard
// two-pass approach: group events into clusters of mutual overlap first
// (so an unrelated 9am cluster doesn't inherit a 2pm cluster's column
// count), then greedily pack each cluster into the fewest columns.
function layoutDayEvents(sortedEvents) {
  const clusters = []
  let current = []
  let clusterEnd = -Infinity
  for (const ev of sortedEvents) {
    if (ev.start.getTime() >= clusterEnd) {
      if (current.length) clusters.push(current)
      current = []
      clusterEnd = -Infinity
    }
    current.push(ev)
    clusterEnd = Math.max(clusterEnd, ev.end.getTime())
  }
  if (current.length) clusters.push(current)

  const layout = new Map() // event key -> { col, colCount }
  for (const cluster of clusters) {
    const columnEndTimes = []
    const colOf = new Map()
    for (const ev of cluster) {
      let placed = false
      for (let c = 0; c < columnEndTimes.length; c++) {
        if (columnEndTimes[c] <= ev.start.getTime()) {
          columnEndTimes[c] = ev.end.getTime()
          colOf.set(ev.key, c)
          placed = true
          break
        }
      }
      if (!placed) {
        columnEndTimes.push(ev.end.getTime())
        colOf.set(ev.key, columnEndTimes.length - 1)
      }
    }
    const colCount = columnEndTimes.length
    for (const ev of cluster) layout.set(ev.key, { col: colOf.get(ev.key), colCount })
  }
  return layout
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

// Builds a plain RFC 5545 RRULE string from the simplified "Repeat" picker —
// the backend (recurrence.py, dateutil rrulestr) already speaks full RRULE
// syntax, so there's no new format to invent here, just a friendlier set of
// presets than asking someone to type FREQ=WEEKLY;BYDAY=... by hand.
function buildRRule({ repeat, date, endType, endDate }) {
  if (repeat === 'none' || !date) return null
  const d = new Date(`${date}T00:00`)
  let freqPart
  switch (repeat) {
    case 'daily': freqPart = 'FREQ=DAILY'; break
    case 'weekly': freqPart = `FREQ=WEEKLY;BYDAY=${WEEKDAY_CODES[d.getDay()]}`; break
    case 'weekdays': freqPart = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'; break
    case 'monthly': freqPart = `FREQ=MONTHLY;BYMONTHDAY=${d.getDate()}`; break
    case 'yearly': freqPart = 'FREQ=YEARLY'; break
    default: return null
  }
  if (endType === 'on' && endDate) {
    const until = new Date(`${endDate}T23:59:59`)
    const untilStr = until.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
    return `${freqPart};UNTIL=${untilStr}`
  }
  return freqPart
}

function repeatWeekdayLabel(date) {
  if (!date) return 'week'
  return new Date(`${date}T00:00`).toLocaleDateString([], { weekday: 'long' })
}

function repeatMonthDayLabel(date) {
  if (!date) return 'month'
  return new Date(`${date}T00:00`).getDate()
}

// Warn, don't block: overlap is a legitimate thing to want (a quick call
// during a longer block, a double-booked room you're aware of) — this just
// surfaces it before you confirm, same spirit as the week view now showing
// overlaps side by side instead of hiding them. Only checks against events
// already loaded for the visible range, so an edit/create for a date well
// outside the current view won't catch a conflict there — an acceptable
// gap for a warn-only check, not a hard guarantee.
function findConflicts(events, { date, startTime, endTime, excludeKey }) {
  if (!date || !startTime || !endTime) return []
  const start = new Date(`${date}T${startTime}`)
  const end = new Date(`${date}T${endTime}`)
  if (end <= start) return []
  return events.filter((ev) =>
    ev.key !== excludeKey && !ev.allDay && ev.status !== 'cancelled' && ev.start < end && ev.end > start,
  )
}

function weekLabel(days) {
  const start = days[0], end = days[days.length - 1]
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return start.toLocaleDateString([], { month: 'long', year: 'numeric' })
  }
  const startStr = start.toLocaleDateString([], { month: 'short', day: 'numeric' })
  const endStr = end.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return `${startStr} – ${endStr}`
}

export default function CalendarView() {
  const { toast } = useToast()
  const [mode, setMode] = useState('week') // 'week' | 'month'
  const [cursor, setCursor] = useState(() => new Date())
  const [now, setNow] = useState(() => new Date()) // ticks so the current-time line stays fresh
  const [events, setEvents] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null) // the native event being edited, or null
  const [showCreate, setShowCreate] = useState(null) // null | { date, startTime, endTime }

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const viewDays = useMemo(() => {
    if (mode === 'day') {
      return [new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())]
    }
    if (mode === 'week') {
      const start = startOfWeek(cursor)
      return Array.from({ length: 7 }, (_, i) => addDays(start, i))
    }
    const gridStart = startOfMonthGrid(cursor.getFullYear(), cursor.getMonth())
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  }, [mode, cursor])

  const rangeStart = viewDays[0]
  const rangeEnd = viewDays[viewDays.length - 1]

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
            ).catch(() => []), // one bad series shouldn't blank the whole view
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
  }, [mode, cursor])

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
  const headerLabel =
    mode === 'day' ? cursor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : mode === 'week' ? weekLabel(viewDays)
    : cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })

  const goPrev = () => setCursor((c) => (
    mode === 'day' ? addDays(c, -1) : mode === 'week' ? addDays(c, -7) : new Date(c.getFullYear(), c.getMonth() - 1, 1)
  ))
  const goNext = () => setCursor((c) => (
    mode === 'day' ? addDays(c, 1) : mode === 'week' ? addDays(c, 7) : new Date(c.getFullYear(), c.getMonth() + 1, 1)
  ))
  const goToday = () => setCursor(new Date())

  const openCreateBlank = () => {
    const d = new Date()
    setShowCreate({ date: isoDateLocal(d), startTime: '09:00', endTime: '09:30' })
  }
  const openCreateForSlot = (day, hour, minute) => {
    setShowCreate({ date: isoDateLocal(day), startTime: hhmm(hour, minute), endTime: plusThirtyMin(hour, minute) })
  }
  const openCreateForDay = (day) => {
    setShowCreate({ date: isoDateLocal(day), startTime: '09:00', endTime: '09:30' })
  }

  const refetch = () => setCursor((c) => new Date(c)) // same range, forces the fetch effect to re-run

  const onCreated = () => {
    setShowCreate(null)
    refetch()
  }
  const onSaved = () => {
    setEditing(null)
    setSelected(null)
    refetch()
  }
  const onDelete = async (ev) => {
    if (!window.confirm(`Delete "${ev.title}"? Attendees will be notified.`)) return
    try {
      await api(nativeEventPath(ev), { method: 'DELETE' })
      toast({ variant: 'success', title: 'Event deleted', description: ev.title })
      setSelected(null)
      refetch()
    } catch (err) {
      toast({ variant: 'error', title: 'Could not delete event', description: err.message })
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-6 py-10 sm:px-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Calendar</h1>
          <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">
            Your Sema calendar — native events plus anything synced from Google Calendar.
          </p>
        </div>
        <Button variant="primary" onClick={openCreateBlank}>
          <Plus className="h-4 w-4" /> New event
        </Button>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="secondary" onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={goToday}>Today</Button>
          <div className="ml-1 text-[15px] font-semibold text-[var(--c-fg)]">{headerLabel}</div>
        </div>
        <div className="flex gap-1 rounded-[10px] border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] p-1">
          {['day', 'week', 'month'].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-[7px] px-3 py-1 text-[12.5px] font-medium capitalize',
                mode === m ? 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]' : 'text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-[10px] border border-[color-mix(in_srgb,var(--c-danger)_30%,var(--c-line))] px-4 py-3 text-[13.5px] text-[var(--c-danger)]">
          {error}
        </div>
      )}

      {events === null ? (
        <div className="flex items-center justify-center rounded-[14px] border border-[var(--c-line)] bg-[var(--c-bg-1)] py-16">
          <Spinner size="lg" />
        </div>
      ) : mode === 'day' || mode === 'week' ? (
        <WeekGrid
          days={viewDays}
          eventsByDay={eventsByDay}
          today={today}
          now={now}
          onSlotClick={openCreateForSlot}
          onEventClick={setSelected}
        />
      ) : (
        <MonthGrid
          days={viewDays}
          cursor={cursor}
          eventsByDay={eventsByDay}
          today={today}
          onDayClick={openCreateForDay}
          onEventClick={setSelected}
        />
      )}

      <EventDetailModal
        event={selected}
        onClose={() => setSelected(null)}
        onEdit={(ev) => { setSelected(null); setEditing(ev) }}
        onDelete={onDelete}
      />
      <CreateEventModal
        open={!!showCreate}
        initial={showCreate}
        events={events || []}
        onClose={() => setShowCreate(null)}
        onCreated={onCreated}
        toast={toast}
      />
      <EditEventModal
        event={editing}
        events={events || []}
        onClose={() => setEditing(null)}
        onSaved={onSaved}
        toast={toast}
      />
    </div>
  )
}

function WeekGrid({ days, eventsByDay, today, now, onSlotClick, onEventClick }) {
  const scrollRef = useRef(null)
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 7 * HOUR_H }) // open scrolled to ~7 AM, like most calendar apps
  }, [])

  const hasAllDay = days.some((d) => (eventsByDay.get(d.toDateString()) || []).some((e) => e.allDay))
  const gridCols = `52px repeat(${days.length}, 1fr)`

  return (
    <div className="overflow-hidden rounded-[14px] border border-[var(--c-line)] bg-[var(--c-bg-1)] shadow-sm">
      <div className="grid border-b border-[var(--c-line)]" style={{ gridTemplateColumns: gridCols }}>
        <div className="flex items-end justify-center pb-1 text-[9.5px] text-[var(--c-fg-muted)]">
          GMT{now.toLocaleTimeString([], { timeZoneName: 'shortOffset' }).split(' ').pop()?.replace('GMT', '') || ''}
        </div>
        {days.map((d) => (
          <div key={d.toISOString()} className="border-l border-[var(--c-line)] px-2 py-1.5 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-fg-muted)]">
              {d.toLocaleDateString([], { weekday: days.length === 1 ? 'long' : 'short' })}
            </div>
            <div className={cn(
              'mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-medium',
              sameDay(d, today) ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-fg)]',
            )}>
              {d.getDate()}
            </div>
          </div>
        ))}
      </div>

      {hasAllDay && (
        <div className="grid border-b border-[var(--c-line)]" style={{ gridTemplateColumns: gridCols }}>
          <div className="px-1 py-1 text-[9.5px] text-[var(--c-fg-muted)]">All day</div>
          {days.map((d) => (
            <div key={d.toISOString()} className="space-y-1 border-l border-[var(--c-line)] p-1">
              {(eventsByDay.get(d.toDateString()) || []).filter((e) => e.allDay).map((ev) => (
                <button
                  key={ev.key}
                  onClick={() => onEventClick(ev)}
                  className="block w-full truncate rounded-[6px] bg-[var(--c-bg-3)] px-1.5 py-0.5 text-left text-[11px] font-medium text-[var(--c-fg-dim)]"
                >
                  {ev.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="max-h-[600px] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: gridCols }}>
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_H }} className="relative">
                {h > 0 && (
                  <span className="absolute -top-2 right-1.5 text-[10px] text-[var(--c-fg-muted)]">{fmtHourLabel(h)}</span>
                )}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const dayEvents = (eventsByDay.get(d.toDateString()) || []).filter((e) => !e.allDay)
            const layout = layoutDayEvents(dayEvents)
            const isToday = sameDay(d, today)
            const nowMinutes = now.getHours() * 60 + now.getMinutes()
            return (
              <div key={d.toISOString()} className="relative border-l border-[var(--c-line)]">
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onSlotClick(d, h, 0)}
                    style={{ height: HOUR_H }}
                    className="block w-full border-t border-[var(--c-line)] first:border-t-0 hover:bg-[var(--c-bg-2)]"
                  />
                ))}
                {isToday && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
                    style={{ top: (nowMinutes / 60) * HOUR_H }}
                  >
                    <div className="h-2 w-2 -translate-x-1/2 rounded-full bg-[var(--c-danger)]" />
                    <div className="h-px flex-1 bg-[var(--c-danger)]" />
                  </div>
                )}
                {dayEvents.map((ev) => {
                  const startMin = ev.start.getHours() * 60 + ev.start.getMinutes()
                  const endMin = Math.max(startMin + 20, ev.end.getHours() * 60 + ev.end.getMinutes())
                  const top = (startMin / 60) * HOUR_H
                  const height = ((endMin - startMin) / 60) * HOUR_H
                  const { col, colCount } = layout.get(ev.key) || { col: 0, colCount: 1 }
                  const widthPct = 100 / colCount
                  return (
                    <button
                      key={ev.key}
                      onClick={() => onEventClick(ev)}
                      style={{
                        top, height,
                        left: `calc(${col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        zIndex: 20 + col,
                      }}
                      className={cn(
                        'absolute overflow-hidden rounded-[6px] px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight',
                        'ring-1 ring-[var(--c-bg-1)]', // thin separator so adjacent columns read as distinct events
                        ev.source === 'native'
                          ? 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]'
                          : 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)]',
                      )}
                      title={ev.title}
                    >
                      <span className="block truncate">{ev.title}</span>
                      <span className="block truncate opacity-70">{fmtTime(ev.start)}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MonthGrid({ days, cursor, eventsByDay, today, onDayClick, onEventClick }) {
  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[14px] border border-[var(--c-line)] bg-[var(--c-line)] shadow-sm">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
        <div key={d} className="bg-[var(--c-bg-2)] px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--c-fg-muted)]">
          {d}
        </div>
      ))}
      {days.map((day) => {
        const inMonth = day.getMonth() === cursor.getMonth()
        const isToday = sameDay(day, today)
        const dayEvents = eventsByDay.get(day.toDateString()) || []
        return (
          <button
            key={day.toISOString()}
            type="button"
            onClick={() => onDayClick(day)}
            className={cn(
              'min-h-[104px] bg-[var(--c-bg-1)] p-1.5 text-left align-top hover:bg-[var(--c-bg-2)]',
              !inMonth && 'opacity-45',
            )}
          >
            <div className={cn(
              'mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11.5px] font-medium',
              isToday ? 'bg-[var(--c-accent)] text-white' : 'text-[var(--c-fg-muted)]',
            )}>
              {day.getDate()}
            </div>
            <div className="space-y-1">
              {dayEvents.slice(0, 3).map((ev) => (
                <span
                  key={ev.key}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onEventClick(ev) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onEventClick(ev) } }}
                  className={cn(
                    'block w-full truncate rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium',
                    ev.source === 'native'
                      ? 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]'
                      : 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)]',
                  )}
                  title={ev.title}
                >
                  {!ev.allDay && <span className="opacity-70">{fmtTime(ev.start)} </span>}
                  {ev.title}
                </span>
              ))}
              {dayEvents.length > 3 && (
                <div className="px-1.5 text-[10.5px] text-[var(--c-fg-muted)]">+{dayEvents.length - 3} more</div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function EventDetailModal({ event, onClose, onEdit, onDelete }) {
  const editable = event?.source === 'native'
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
          {editable ? (
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => onDelete(event)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
              <Button variant="primary" onClick={() => onEdit(event)}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </div>
          ) : (
            <p className="pt-1 text-[12px] text-[var(--c-fg-muted)]">
              Synced from Google Calendar — edit it there, changes flow back into Sema on the next sync.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function CreateEventModal({ open, initial, events, onClose, onCreated, toast }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('09:30')
  const [location, setLocation] = useState('')
  const [attendees, setAttendees] = useState([])
  const [repeat, setRepeat] = useState('none')
  const [endType, setEndType] = useState('never')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)

  const conflicts = useMemo(
    () => findConflicts(events, { date, startTime, endTime, excludeKey: null }),
    [events, date, startTime, endTime],
  )

  useEffect(() => {
    if (open) {
      setDate(initial?.date || isoDateLocal(new Date()))
      setStartTime(initial?.startTime || '09:00')
      setEndTime(initial?.endTime || '09:30')
      setTitle('')
      setLocation('')
      setAttendees([])
      setRepeat('none')
      setEndType('never')
      setEndDate('')
    }
    // Only re-sync when the modal opens — initial is a fresh object every
    // open, so it's read once here rather than kept as a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          attendees,
          timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
          rrule: buildRRule({ repeat, date, endType, endDate }),
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
        <AttendeesInput attendees={attendees} setAttendees={setAttendees} />
        <RepeatPicker
          repeat={repeat} setRepeat={setRepeat}
          endType={endType} setEndType={setEndType}
          endDate={endDate} setEndDate={setEndDate}
          date={date}
        />
        <ConflictWarning conflicts={conflicts} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function AttendeesInput({ attendees, setAttendees }) {
  const [value, setValue] = useState('')

  const addFromValue = () => {
    const email = value.trim().replace(/[,;]$/, '')
    if (!email || !EMAIL_RE.test(email)) { setValue(''); return }
    if (!attendees.some((a) => a.email.toLowerCase() === email.toLowerCase())) {
      setAttendees([...attendees, { email }])
    }
    setValue('')
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addFromValue()
    } else if (e.key === 'Backspace' && !value && attendees.length) {
      setAttendees(attendees.slice(0, -1))
    }
  }

  return (
    <LabeledInput label="Attendees (optional)">
      <div className="flex flex-wrap items-center gap-1.5">
        {attendees.map((a) => (
          <span key={a.email} className="inline-flex items-center gap-1 rounded-full bg-[var(--c-bg-3)] px-2 py-0.5 text-[12px] text-[var(--c-fg-dim)]">
            {a.email}
            <button
              type="button"
              onClick={() => setAttendees(attendees.filter((x) => x.email !== a.email))}
              className="text-[var(--c-fg-muted)] hover:text-[var(--c-danger)]"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={addFromValue}
          placeholder={attendees.length ? '' : 'name@example.com — Enter to add'}
          className="min-w-[140px] flex-1 bg-transparent text-[14px] text-[var(--c-fg)] outline-none"
        />
      </div>
    </LabeledInput>
  )
}

function RepeatPicker({ repeat, setRepeat, endType, setEndType, endDate, setEndDate, date }) {
  return (
    <div className="space-y-2">
      <LabeledInput label="Repeat">
        <select
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none"
        >
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly on {repeatWeekdayLabel(date)}</option>
          <option value="weekdays">Every weekday (Mon–Fri)</option>
          <option value="monthly">Monthly on day {repeatMonthDayLabel(date)}</option>
          <option value="yearly">Annually</option>
        </select>
      </LabeledInput>
      {repeat !== 'none' && (
        <LabeledInput label="Ends">
          <div className="flex items-center gap-3">
            <select
              value={endType}
              onChange={(e) => setEndType(e.target.value)}
              className="bg-transparent text-[14px] text-[var(--c-fg)] outline-none"
            >
              <option value="never">Never</option>
              <option value="on">On date</option>
            </select>
            {endType === 'on' && (
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="flex-1 bg-transparent text-[14px] text-[var(--c-fg)] outline-none"
              />
            )}
          </div>
        </LabeledInput>
      )}
    </div>
  )
}

function EditEventModal({ event, events, onClose, onSaved, toast }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('09:30')
  const [location, setLocation] = useState('')
  const [attendees, setAttendees] = useState([])
  const [saving, setSaving] = useState(false)

  const conflicts = useMemo(
    () => findConflicts(events, { date, startTime, endTime, excludeKey: event?.key }),
    [events, date, startTime, endTime, event],
  )

  useEffect(() => {
    if (event) {
      setTitle(event.title || '')
      setDate(isoDateLocal(event.start))
      setStartTime(hhmm(event.start.getHours(), event.start.getMinutes()))
      setEndTime(hhmm(event.end.getHours(), event.end.getMinutes()))
      setLocation(event.location || '')
      setAttendees((event.attendees || []).filter((a) => a.email))
    }
  }, [event])

  const submit = async (e) => {
    e.preventDefault()
    if (!event || !title.trim() || !date) return
    setSaving(true)
    try {
      const start_at = new Date(`${date}T${startTime}`).toISOString()
      const end_at = new Date(`${date}T${endTime}`).toISOString()
      await api(nativeEventPath(event), {
        method: 'PATCH',
        body: {
          title: title.trim(),
          start_at,
          end_at,
          location: location.trim() || null,
          attendees,
          timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })
      toast({ variant: 'success', title: 'Event updated', description: title.trim() })
      onSaved()
    } catch (err) {
      toast({ variant: 'error', title: 'Could not update event', description: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!event} onClose={onClose} title="Edit event" size="sm">
      <form onSubmit={submit} className="space-y-3">
        {event?.recurring && (
          <p className="text-[12px] text-[var(--c-fg-muted)]">
            This edits only this occurrence — the rest of the recurring series is unaffected.
          </p>
        )}
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
        <AttendeesInput attendees={attendees} setAttendees={setAttendees} />
        <ConflictWarning conflicts={conflicts} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function ConflictWarning({ conflicts }) {
  if (!conflicts.length) return null
  return (
    <div className="rounded-[8px] border border-[color-mix(in_srgb,var(--c-warn)_30%,var(--c-line))] bg-[var(--c-warn-soft,transparent)] px-3 py-2 text-[12.5px] text-[var(--c-warn)]">
      <div className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" />
        Overlaps {conflicts.length} other event{conflicts.length > 1 ? 's' : ''} — you can still save
      </div>
      <ul className="mt-1 space-y-0.5 pl-5 opacity-90">
        {conflicts.map((c) => (
          <li key={c.key} className="list-disc truncate">{c.title} · {fmtTime(c.start)}–{fmtTime(c.end)}</li>
        ))}
      </ul>
    </div>
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
