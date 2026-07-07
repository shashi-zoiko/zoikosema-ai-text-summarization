import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CheckCircle2, ListChecks, User2, CalendarClock, ArrowRight } from 'lucide-react'
import { api } from '../api/client'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import { Card } from '../components/ui/Card'
import { meetingIntelligencePath } from '../lib/meetingUrls'
import { fadeUp, stagger } from '../lib/motion'

// Priority → Badge tone, mirroring the meeting-intelligence page so the same
// action item reads identically wherever it's shown.
const PRIORITY_TONE = { high: 'danger', med: 'warn', medium: 'warn', low: 'neutral' }

// Group a flat action-item list by meeting, preserving the server's order
// (already priority-major, newest-meeting-minor).
function groupByMeeting(items) {
  const groups = []
  const byCode = new Map()
  for (const it of items) {
    const key = it.meeting_code || '—'
    let g = byCode.get(key)
    if (!g) {
      g = { code: it.meeting_code, title: it.meeting_title, date: it.meeting_date, items: [] }
      byCode.set(key, g)
      groups.push(g)
    }
    g.items.push(it)
  }
  return groups
}

export default function Actions() {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)   // null = loading
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    api('/api/action-items')
      .then((data) => { if (alive) setItems(data) })
      .catch((e) => { if (alive) { setError(e.message); setItems([]) } })
    return () => { alive = false }
  }, [])

  const groups = items ? groupByMeeting(items) : []

  return (
    <div className="relative mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-8 sm:py-10">
      <motion.div variants={stagger(0.05)} initial="initial" animate="animate" className="mb-6 flex flex-wrap items-center gap-3">
        <motion.div variants={fadeUp} className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--c-accent-soft)] text-[var(--c-accent)]">
            <ListChecks className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[22px] font-bold leading-none tracking-[-0.02em] sm:text-[26px]">Action items</h1>
            <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">
              Every commitment your meetings surfaced, gathered in one place.
            </p>
          </div>
        </motion.div>
        {items?.length > 0 && (
          <motion.div variants={fadeUp} className="ml-auto">
            <Badge tone="accent" size="lg">{items.length} open</Badge>
          </motion.div>
        )}
      </motion.div>

      {items === null ? (
        <div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-bg-2)]/40 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--c-bg-3)] text-[var(--c-fg-muted)]">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[14px] font-semibold tracking-tight">
              {error ? 'Couldn’t load action items' : 'No action items yet'}
            </div>
            <div className="mt-1 max-w-md text-[12.5px] text-[var(--c-fg-muted)]">
              {error || 'Action items appear here after a meeting is analyzed with AI summaries.'}
            </div>
          </div>
        </div>
      ) : (
        <motion.div variants={stagger(0.04)} initial="initial" animate="animate" className="space-y-5">
          {groups.map((g) => (
            <motion.section key={g.code || g.title} variants={fadeUp}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[13.5px] font-semibold tracking-tight">{g.title}</h2>
                {g.code && (
                  <button
                    onClick={() => navigate(meetingIntelligencePath(g.code))}
                    className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--c-accent)] hover:underline"
                  >
                    View summary <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Card className="divide-y divide-[var(--c-line)] p-0">
                {g.items.map((it) => (
                  <div key={it.id} className="flex items-start gap-3 px-4 py-3">
                    <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--c-fg-muted)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] leading-snug">{it.task}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--c-fg-muted)]">
                        {it.owner && <span className="inline-flex items-center gap-1"><User2 className="h-3 w-3" />{it.owner}</span>}
                        {it.due && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" />{it.due}</span>}
                        {it.depends_on && <span>depends on: {it.depends_on}</span>}
                      </div>
                    </div>
                    {it.priority && (
                      <Badge tone={PRIORITY_TONE[it.priority] || 'neutral'} size="sm">{it.priority}</Badge>
                    )}
                  </div>
                ))}
              </Card>
            </motion.section>
          ))}
        </motion.div>
      )}
    </div>
  )
}
