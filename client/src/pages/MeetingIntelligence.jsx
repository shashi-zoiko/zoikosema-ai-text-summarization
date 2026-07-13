import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle, ArrowLeft, Brain, CheckCircle2, ChevronRight, Copy,
  Download, FileText, GitMerge, Lightbulb, ListChecks, Loader2, Mic, Pencil,
  Plus, Printer, RefreshCw, Save, ShieldAlert, Sparkles, Table2, Target, Trash2, TrendingUp,
  Users2, X, Zap,
} from 'lucide-react'

import { api } from '../api/client'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import Spinner from '../components/ui/Spinner'
import TableSummaryView from '../components/TableSummaryView'
import { fadeUp, stagger } from '../lib/motion'
import { cn } from '../lib/cn'

const PRIORITY_TONE = { high: 'danger', med: 'warn', medium: 'warn', low: 'neutral' }
const DECISION_TONE = {
  approved: 'success',
  rejected: 'danger',
  deferred: 'warn',
  escalated: 'warn',
}
const SEVERITY_TONE = { high: 'danger', med: 'warn', medium: 'warn', low: 'neutral' }
const SENTIMENT_TONE = {
  positive: 'success',
  neutral: 'neutral',
  mixed: 'warn',
  negative: 'danger',
}

function ScoreRing({ value = 0, label, icon }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0))
  const [animatedPct, setAnimatedPct] = useState(0)
  useEffect(() => {
    let raf
    const start = performance.now()
    const from = 0
    const duration = 900
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setAnimatedPct(from + (pct - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pct])

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      className="group/ring flex flex-col items-center gap-2"
    >
      <div className="relative h-20 w-20">
        {/* Halo */}
        <div
          aria-hidden
          className="absolute inset-[-6px] rounded-full opacity-0 blur-xl transition-opacity duration-300 group-hover/ring:opacity-70"
          style={{ background: 'radial-gradient(closest-side, var(--c-accent), transparent 70%)' }}
        />
        <div
          className="relative h-full w-full rounded-full transition-transform duration-300 group-hover/ring:scale-105"
          style={{
            background: `conic-gradient(from -90deg, var(--c-accent) 0deg, var(--c-accent-3) ${animatedPct * 3.6}deg, var(--c-bg-3) ${animatedPct * 3.6}deg)`,
          }}
        >
          <div className="absolute inset-1.5 flex flex-col items-center justify-center rounded-full bg-[var(--c-surface)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--c-fg)_6%,transparent)]">
            <span className="text-[18px] font-bold tabular-nums tracking-tight">{Math.round(animatedPct)}</span>
            <span className="text-[9px] uppercase tracking-[0.08em] text-[var(--c-fg-muted)]">/100</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--c-fg-muted)] transition-colors duration-150 group-hover/ring:text-[var(--c-fg-dim)]">
        {icon}
        {label}
      </div>
    </motion.div>
  )
}

// Render the structured payload as a portable markdown document. Used by the
// "Copy as markdown" and "Download .md" buttons so users can paste straight
// into Slack, Notion, or commit it into a wiki.
function intelToMarkdown(meetingTitle, code, payload) {
  if (!payload) return ''
  const lines = []
  lines.push(`# ${meetingTitle || 'Meeting'} — Intelligence`)
  lines.push(`_${code}_`)
  lines.push('')
  if (payload.tldr) {
    lines.push('## TL;DR')
    lines.push(payload.tldr)
    lines.push('')
  }
  const s = payload.score || {}
  if (s.overall != null) {
    lines.push('## Score')
    lines.push(`- Overall: ${s.overall ?? 0}/100`)
    lines.push(`- Productivity: ${s.productivity ?? 0}/100`)
    lines.push(`- Clarity: ${s.clarity ?? 0}/100`)
    lines.push(`- Decision speed: ${s.decision_speed ?? 0}/100`)
    lines.push(`- Participation: ${s.participation ?? 0}/100`)
    lines.push('')
  }
  if (payload.action_items?.length) {
    lines.push('## Action items')
    for (const a of payload.action_items) {
      const meta = [a.owner, a.due, a.priority].filter(Boolean).join(' · ')
      lines.push(`- [ ] ${a.task}${meta ? `  _(${meta})_` : ''}`)
    }
    lines.push('')
  }
  if (payload.decisions?.length) {
    lines.push('## Decisions')
    for (const d of payload.decisions) {
      lines.push(`- **${d.title}**${d.type ? ` _(${d.type})_` : ''}${d.detail ? ` — ${d.detail}` : ''}`)
    }
    lines.push('')
  }
  if (payload.risks?.length) {
    lines.push('## Risks')
    for (const r of payload.risks) {
      lines.push(`- ${r.severity ? `**[${r.severity}]** ` : ''}${r.title}${r.rationale ? ` — ${r.rationale}` : ''}`)
    }
    lines.push('')
  }
  if (payload.topics?.length) {
    lines.push('## Topics')
    payload.topics.forEach((t, i) => {
      lines.push(`${i + 1}. **${t.title}**${t.started_at ? ` (${t.started_at}${t.ended_at ? `→${t.ended_at}` : ''})` : ''}`)
      if (t.summary) lines.push(`   ${t.summary}`)
    })
    lines.push('')
  }
  if (payload.contradictions?.length) {
    lines.push('## Contradictions')
    for (const c of payload.contradictions) {
      lines.push(`- ${c.summary}`)
      if (Array.isArray(c.between)) c.between.forEach((b) => lines.push(`  - ${b}`))
    }
    lines.push('')
  }
  if (payload.knowledge_nuggets?.length) {
    lines.push('## Knowledge nuggets')
    for (const n of payload.knowledge_nuggets) lines.push(`- ${n}`)
    lines.push('')
  }
  return lines.join('\n')
}

// Same idea as intelToMarkdown, but for the simpler transcript-sourced
// payload shape ({title, summary, key_takeaways}) — the post-meeting Groq
// summary, not the chat-based rich analysis above.
function transcriptToMarkdown(meetingTitle, code, payload) {
  if (!payload) return ''
  const lines = []
  lines.push(`# ${payload.title || meetingTitle || 'Meeting'} — Summary`)
  lines.push(`_${code}_`)
  lines.push('')
  if (payload.summary) {
    lines.push(payload.summary)
    lines.push('')
  }
  if (payload.key_takeaways?.length) {
    lines.push('## Key Takeaways')
    for (const t of payload.key_takeaways) {
      lines.push(`- ${t.assignee ? `**${t.assignee}:** ` : ''}${t.text}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function intelToHtmlDoc(meetingTitle, code, payload) {
  if (!payload) return ''
  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const parts = [`<h1>${esc(meetingTitle || 'Meeting')} — Intelligence</h1><p><em>${esc(code)}</em></p>`]
  if (payload.tldr) parts.push(`<h2>TL;DR</h2><p>${esc(payload.tldr)}</p>`)
  if (payload.action_items?.length) {
    parts.push('<h2>Action Items</h2><ul>')
    for (const a of payload.action_items) parts.push(`<li>${esc(a.task)}${a.owner ? ` <em>(${esc(a.owner)})</em>` : ''}</li>`)
    parts.push('</ul>')
  }
  if (payload.decisions?.length) {
    parts.push('<h2>Decisions</h2><ul>')
    for (const d of payload.decisions) parts.push(`<li><strong>${esc(d.title)}</strong>${d.detail ? ` — ${esc(d.detail)}` : ''}</li>`)
    parts.push('</ul>')
  }
  if (payload.risks?.length) {
    parts.push('<h2>Risks</h2><ul>')
    for (const r of payload.risks) parts.push(`<li>${r.severity ? `<strong>[${esc(r.severity)}]</strong> ` : ''}${esc(r.title)}${r.rationale ? ` — ${esc(r.rationale)}` : ''}</li>`)
    parts.push('</ul>')
  }
  if (payload.topics?.length) {
    parts.push('<h2>Topics</h2><ol>')
    for (const t of payload.topics) parts.push(`<li><strong>${esc(t.title)}</strong>${t.summary ? `<br/>${esc(t.summary)}` : ''}</li>`)
    parts.push('</ol>')
  }
  const s = payload.score || {}
  if (s.overall != null) {
    parts.push(`<h2>Score</h2><p>Overall: ${s.overall}/100 | Productivity: ${s.productivity}/100 | Clarity: ${s.clarity}/100 | Decision speed: ${s.decision_speed}/100 | Participation: ${s.participation}/100</p>`)
  }
  if (payload.knowledge_nuggets?.length) {
    parts.push('<h2>Knowledge Nuggets</h2><ul>')
    for (const n of payload.knowledge_nuggets) parts.push(`<li>${esc(n)}</li>`)
    parts.push('</ul>')
  }
  return htmlWrap(parts.join('\n'))
}

function transcriptToHtmlDoc(meetingTitle, code, payload) {
  if (!payload) return ''
  const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const parts = [`<h1>${esc(payload.title || meetingTitle || 'Meeting')} — Summary</h1><p><em>${esc(code)}</em></p>`]
  if (payload.summary) parts.push(`<p>${esc(payload.summary)}</p>`)
  if (payload.key_takeaways?.length) {
    parts.push('<h2>Key Takeaways</h2><ul>')
    for (const t of payload.key_takeaways) {
      parts.push(`<li>${t.assignee ? `<strong>${esc(t.assignee)}:</strong> ` : ''}${esc(t.text)}</li>`)
    }
    parts.push('</ul>')
  }
  return htmlWrap(parts.join('\n'))
}

function htmlWrap(body) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Meeting Summary</title>
<style>
body{font-family:Calibri,Helvetica,Arial,sans-serif;max-width:800px;margin:2em auto;padding:0 1em;color:#1a1a1a;line-height:1.6}
h1{font-size:24px;border-bottom:2px solid #ddd;padding-bottom:8px}
h2{font-size:18px;margin-top:24px;color:#333}
p,li{font-size:14px}
ul,ol{padding-left:24px}
em{color:#666}
strong{color:#000}
</style>
</head>
<body>${body}</body></html>`
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function EmptyState({ icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--c-line)] bg-[var(--c-bg-2)]/40 px-4 py-8 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--c-bg-3)] text-[var(--c-fg-muted)]">
        {icon}
      </div>
      <div className="text-[13px] font-semibold tracking-tight">{title}</div>
      {hint && <div className="text-[11.5px] text-[var(--c-fg-muted)]">{hint}</div>}
    </div>
  )
}

function SectionCard({ title, icon, count, tone = 'neutral', children, action }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={cn(
            'flex h-8 w-8 items-center justify-center rounded-xl [&_svg]:h-[16px] [&_svg]:w-[16px]',
            tone === 'accent' && 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]',
            tone === 'success' && 'bg-[var(--c-success-soft)] text-[var(--c-success)]',
            tone === 'warn' && 'bg-[var(--c-warn-soft)] text-[var(--c-warn)]',
            tone === 'danger' && 'bg-[var(--c-danger-soft)] text-[var(--c-danger)]',
            tone === 'neutral' && 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)]',
          )}>
            {icon}
          </div>
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {typeof count === 'number' && (
            <Badge tone="neutral" size="sm">{count}</Badge>
          )}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}

// Transcript-sourced summary (Groq, generated once when the host leaves) —
// deliberately a much simpler view than the chat-based sections below:
// title, summary, key takeaways, with inline editing. Rendered instead of
// (not alongside) the rich chat-based sections when `intel.source ===
// 'transcript'`, since score/topics/speakers/sentiment/etc. don't apply to
// this payload shape.
function TranscriptSummaryView({
  payload, editing,
  editTitle, setEditTitle,
  editSummary, setEditSummary,
  editTakeaways, setEditTakeaways,
}) {
  if (editing) {
    return (
      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--c-fg-muted)]">
            Title
          </label>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3.5 py-2.5 text-[16px] font-bold text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--c-fg-muted)]">
            Summary
          </label>
          <textarea
            rows={4}
            value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            className="w-full rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3.5 py-2.5 text-[14px] leading-relaxed text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--c-fg-muted)]">
            Key takeaways
          </label>
          <div className="space-y-2">
            {editTakeaways.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <input
                  placeholder="Assignee"
                  value={item.assignee || ''}
                  onChange={(e) => setEditTakeaways((arr) => arr.map((it, j) => (j === i ? { ...it, assignee: e.target.value } : it)))}
                  className="w-28 shrink-0 rounded-lg border border-[var(--c-line)] bg-[var(--c-bg-2)] px-2.5 py-2 text-[12.5px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
                />
                <input
                  placeholder="Takeaway"
                  value={item.text || ''}
                  onChange={(e) => setEditTakeaways((arr) => arr.map((it, j) => (j === i ? { ...it, text: e.target.value } : it)))}
                  className="flex-1 rounded-lg border border-[var(--c-line)] bg-[var(--c-bg-2)] px-2.5 py-2 text-[13px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
                />
                <button
                  type="button"
                  onClick={() => setEditTakeaways((arr) => arr.filter((_, j) => j !== i))}
                  aria-label="Remove takeaway"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--c-fg-muted)] transition hover:bg-[var(--c-danger-soft)] hover:text-[var(--c-danger)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setEditTakeaways((arr) => [...arr, { assignee: '', text: '' }])}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--c-accent)] hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add takeaway
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-center text-[24px] font-bold leading-tight tracking-tight text-[var(--c-fg)]">
        {payload.title || 'Meeting Summary'}
      </h1>
      <p className="mt-4 text-[14px] leading-relaxed text-[var(--c-fg-dim)]">
        {payload.summary || 'No summary produced.'}
      </p>
      <h3 className="mb-4 mt-12 text-[11px] font-semibold uppercase tracking-[0.10em] text-[var(--c-fg-muted)]">
        Key Takeaways
      </h3>
      {(payload.key_takeaways?.length || 0) === 0 ? (
        <EmptyState icon={<ListChecks className="h-4 w-4" />} title="Nothing captured" hint="No action items, decisions, or important points were identified." />
      ) : (
        <ul className="space-y-3">
          {payload.key_takeaways.map((item, i) => (
            <li key={i} className="flex gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/40 p-3 text-[14px] leading-relaxed">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--c-accent)]" />
              <span>
                {item.assignee && <span className="font-semibold text-[var(--c-fg)]">{item.assignee}: </span>}
                <span className="text-[var(--c-fg-dim)]">{item.text}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function MeetingIntelligence() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [intel, setIntel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  // Edit mode for transcript-sourced summaries only (see isTranscript below).
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editTakeaways, setEditTakeaways] = useState([])

  // Toggle between text and table view.
  const [viewMode, setViewMode] = useState('text')
  const [language, setLanguage] = useState('english')

  useEffect(() => {
    let cancelled = false
    let timer = null

    // Poll while a row exists with status=generating (e.g. the post-upload
    // background task hasn't finished yet). Backs off after 60s so we don't
    // hammer the server if generation is wedged.
    const fetchOnce = async () => {
      try {
        const data = await api(`/api/meetings/${code}/intelligence`)
        if (cancelled) return
        setIntel(data)
        setError('')
        if (data && data.status === 'generating') {
          timer = setTimeout(fetchOnce, 2500)
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    setLoading(true)
    fetchOnce()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [code])

  const regenerate = async () => {
    if (generating) return
    setGenerating(true)
    setError('')
    try {
      const fresh = await api(`/api/meetings/${code}/intelligence`, {
        method: 'POST',
        body: { force: true, language },
      })
      setIntel(fresh)
    } catch (e) {
      setError(e.message || 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const payload = intel?.payload || null
  const status = intel?.status
  const isTranscript = intel?.source === 'transcript'
  const hasTable = payload?.table_data?.enabled && payload?.table_data?.rows?.length > 0

  const slug = `${(intel?.meeting_title || code || 'meeting').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}-${isTranscript ? 'summary' : 'intelligence'}`

  const exportMarkdown = (download) => {
    const md = isTranscript
      ? transcriptToMarkdown(intel?.meeting_title, code, payload)
      : intelToMarkdown(intel?.meeting_title, code, payload)
    if (!md) return
    if (download) {
      downloadBlob(md, `${slug}.md`, 'text/markdown;charset=utf-8')
    } else {
      navigator.clipboard?.writeText(md)
    }
  }

  const exportDoc = () => {
    const html = isTranscript
      ? transcriptToHtmlDoc(intel?.meeting_title, code, payload)
      : intelToHtmlDoc(intel?.meeting_title, code, payload)
    if (html) downloadBlob(html, `${slug}.doc`, 'application/msword')
  }

  const exportPdf = () => {
    const html = isTranscript
      ? transcriptToHtmlDoc(intel?.meeting_title, code, payload)
      : intelToHtmlDoc(intel?.meeting_title, code, payload)
    if (!html) return
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html)
    w.document.close()
    w.focus()
    w.print()
  }

  const startEdit = () => {
    setEditTitle(payload?.title || '')
    setEditSummary(payload?.summary || '')
    setEditTakeaways(
      (payload?.key_takeaways || []).map((t) => ({ assignee: t.assignee || '', text: t.text || '' })),
    )
    setEditing(true)
  }

  const saveEdit = async () => {
    setSaving(true)
    setError('')
    try {
      const key_takeaways = editTakeaways
        .filter((t) => (t.text || '').trim())
        .map((t) => ({ assignee: t.assignee?.trim() || undefined, text: t.text.trim() }))
      const fresh = await api(`/api/meetings/${code}/intelligence`, {
        method: 'PATCH',
        body: { title: editTitle, summary: editSummary, key_takeaways },
      })
      setIntel(fresh)
      setEditing(false)
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Derived: 5 score chips, falling back to 0 so the layout never breaks.
  const scores = useMemo(() => {
    const s = payload?.score || {}
    return [
      { key: 'overall',        label: 'Overall',       icon: <Sparkles />,  value: s.overall },
      { key: 'productivity',   label: 'Productivity',  icon: <TrendingUp />, value: s.productivity },
      { key: 'clarity',        label: 'Clarity',       icon: <Lightbulb />,  value: s.clarity },
      { key: 'decision_speed', label: 'Decisions',     icon: <Zap />,        value: s.decision_speed },
      { key: 'participation',  label: 'Participation', icon: <Users2 />,     value: s.participation },
    ]
  }, [payload])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-8 sm:py-10">
      {/* ============ Header ============ */}
      <motion.header
        variants={stagger(0.05)}
        initial="initial"
        animate="animate"
        className="mb-8"
      >
        <motion.div variants={fadeUp} className="flex items-center gap-2">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1 text-[12px] text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
          </button>
        </motion.div>
        <motion.div variants={fadeUp} className="mt-3 flex flex-wrap items-center gap-3">
          <Badge tone="accent" size="md">
            <Brain className="h-3 w-3" /> {isTranscript ? 'Meeting Summary' : 'Meeting Intelligence'}
          </Badge>

          {status === 'ready' && (
            <Badge tone="success" size="sm"><CheckCircle2 className="h-3 w-3" /> Ready</Badge>
          )}
          {status === 'failed' && (
            <Badge tone="danger" size="sm">Failed</Badge>
          )}
        </motion.div>
        <motion.h1 variants={fadeUp} className="mt-3 text-[32px] font-bold leading-[1.1] tracking-[-0.025em] sm:text-[38px]">
          {intel?.meeting_title || 'Meeting analysis'}
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-1 mono text-[12.5px] text-[var(--c-fg-muted)]">
          {code}
          {intel?.created_at && ` · generated ${new Date(intel.created_at).toLocaleString()}`}
        </motion.p>

        <motion.div variants={fadeUp} className="mt-4 flex flex-wrap items-center gap-2">
          {isTranscript ? (
            editing ? (
              <>
                <Button variant="primary" onClick={saveEdit} loading={saving} leftIcon={<Save className="h-4 w-4" />}>
                  Save
                </Button>
                <Button variant="outline" onClick={() => setEditing(false)} leftIcon={<X className="h-4 w-4" />}>
                  Cancel
                </Button>
              </>
            ) : (
              status === 'ready' && (
                <>
                  <Button variant="outline" onClick={startEdit} leftIcon={<Pencil className="h-4 w-4" />}>
                    Edit
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" onClick={() => exportMarkdown(true)} leftIcon={<Download className="h-4 w-4" />}>
                      .md
                    </Button>
                    <Button variant="outline" onClick={exportDoc} leftIcon={<Download className="h-4 w-4" />}>
                      .doc
                    </Button>
                    <Button variant="outline" onClick={exportPdf} leftIcon={<Printer className="h-4 w-4" />}>
                      PDF
                    </Button>
                  </div>
                </>
              )
            )
          ) : (
            <>
              <Button
                variant="primary"
                onClick={regenerate}
                loading={generating}
                leftIcon={<RefreshCw className="h-4 w-4" />}
              >
                {intel ? 'Regenerate' : 'Generate intelligence'}
              </Button>
              {payload && status === 'ready' && (
                <>
                  <Button variant="outline" onClick={() => exportMarkdown(false)} leftIcon={<Copy className="h-4 w-4" />}>
                    Copy as markdown
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" onClick={() => exportMarkdown(true)} leftIcon={<Download className="h-4 w-4" />}>
                      .md
                    </Button>
                    <Button variant="outline" onClick={exportDoc} leftIcon={<Download className="h-4 w-4" />}>
                      .doc
                    </Button>
                    <Button variant="outline" onClick={exportPdf} leftIcon={<Printer className="h-4 w-4" />}>
                      PDF
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </motion.div>

        {payload && status === 'ready' && !editing && (
          <motion.div variants={fadeUp} className="mt-3 flex flex-wrap items-center gap-2">
            {hasTable && (
              <div className="flex items-center gap-0 rounded-lg border border-[var(--c-line)] bg-[var(--c-bg-3)]/40 p-0.5">
                <button
                  onClick={() => setViewMode('text')}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-[12px] font-medium transition',
                    viewMode === 'text'
                      ? 'bg-[var(--c-surface)] text-[var(--c-fg)] shadow-sm'
                      : 'text-[var(--c-fg-muted)] hover:text-[var(--c-fg-dim)]',
                  )}
                >
                  <FileText className="mr-1.5 inline h-3.5 w-3.5" />
                  Text
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-[12px] font-medium transition',
                    viewMode === 'table'
                      ? 'bg-[var(--c-surface)] text-[var(--c-fg)] shadow-sm'
                      : 'text-[var(--c-fg-muted)] hover:text-[var(--c-fg-dim)]',
                  )}
                >
                  <Table2 className="mr-1.5 inline h-3.5 w-3.5" />
                  Table
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5 rounded-lg border border-[var(--c-line)] bg-[var(--c-bg-3)]/40 px-2.5 py-1">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-transparent text-[12px] text-[var(--c-fg)] outline-none"
              >
                <option value="english">English</option>
                <option value="spanish">Spanish</option>
                <option value="french">French</option>
                <option value="german">German</option>
                <option value="hindi">Hindi</option>
                <option value="chinese">Chinese</option>
                <option value="japanese">Japanese</option>
                <option value="arabic">Arabic</option>
                <option value="portuguese">Portuguese</option>
                <option value="russian">Russian</option>
              </select>
            </div>
            {!isTranscript && (
              <Button variant="outline" size="sm" onClick={regenerate} loading={generating} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
                {intel ? 'Regenerate' : 'Generate'}
              </Button>
            )}
          </motion.div>
        )}

        {error && (
          <div className="mt-3 rounded-xl border border-[var(--c-danger)] bg-[var(--c-danger-soft)] px-4 py-2 text-[12.5px] text-[var(--c-danger)]">
            {error}
          </div>
        )}
        {status === 'failed' && intel?.error_message && (
          <div className="mt-3 rounded-xl border border-[var(--c-danger)] bg-[var(--c-danger-soft)] px-4 py-2 text-[12.5px] text-[var(--c-danger)]">
            Last run failed: {intel.error_message}
          </div>
        )}
      </motion.header>

      {!intel && !generating && (
        <Card className="p-10 text-center">
          <Brain className="mx-auto mb-3 h-10 w-10 text-[var(--c-accent)]" />
          <div className="text-[16px] font-semibold tracking-tight">No intelligence yet</div>
          <div className="mt-1 text-[13px] text-[var(--c-fg-muted)]">
            Click <span className="font-semibold">Generate intelligence</span> to analyze this meeting's chat log
            and surface decisions, action items, risks, and team sentiment.
          </div>
        </Card>
      )}

      {intel && status === 'generating' && (
        <Card glow className="p-10 text-center">
          <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-[var(--c-accent)]" />
          <div className="text-[16px] font-semibold tracking-tight">Analyzing the meeting…</div>
          <div className="mt-1 text-[13px] text-[var(--c-fg-muted)]">
            This usually takes 5–20 seconds. The page will refresh automatically when ready.
          </div>
        </Card>
      )}

      {intel && status !== 'generating' && payload && (
        isTranscript ? (
          viewMode === 'table' ? (
            <TableSummaryView tableData={payload.table_data} />
          ) : (
            <motion.section variants={fadeUp} initial="initial" animate="animate" className="mb-6">
              <Card glow className="p-6">
                <TranscriptSummaryView
                  payload={payload}
                  editing={editing}
                  editTitle={editTitle}
                  setEditTitle={setEditTitle}
                  editSummary={editSummary}
                  setEditSummary={setEditSummary}
                  editTakeaways={editTakeaways}
                  setEditTakeaways={setEditTakeaways}
                />
              </Card>
            </motion.section>
          )
        ) : (
        viewMode === 'table' ? (
          <TableSummaryView tableData={payload.table_data} />
        ) : (
        <>
          {/* ============ TL;DR ============ */}
          <motion.section variants={fadeUp} initial="initial" animate="animate" className="mb-6">
            <Card glow className="p-6">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.10em] text-[var(--c-fg-muted)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--c-accent)]" /> Executive headline
              </div>
              <p className="mt-3 text-[18px] font-medium leading-relaxed tracking-tight text-[var(--c-fg)]">
                {payload.tldr || <span className="text-[var(--c-fg-muted)]">No summary produced.</span>}
              </p>
            </Card>
          </motion.section>

          {/* ============ Scores ============ */}
          <motion.section
            variants={stagger(0.04)}
            initial="initial"
            animate="animate"
            className="mb-8"
          >
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.10em] text-[var(--c-fg-muted)]">
                <Target className="h-3.5 w-3.5" /> Meeting score
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {scores.map((s) => (
                  <motion.div key={s.key} variants={fadeUp}>
                    <ScoreRing value={s.value} label={s.label} icon={s.icon} />
                  </motion.div>
                ))}
              </div>
            </Card>
          </motion.section>

          {/* ============ Action Items + Decisions ============ */}
          <section className="mb-8 grid gap-5 lg:grid-cols-2">
            <SectionCard
              title="Action items"
              icon={<ListChecks />}
              tone="accent"
              count={payload.action_items?.length || 0}
            >
              {(payload.action_items?.length || 0) === 0 ? (
                <EmptyState icon={<ListChecks className="h-4 w-4" />} title="No action items found" hint="The model didn't spot any concrete commitments." />
              ) : (
                <ul className="space-y-3">
                  {payload.action_items.map((item, i) => (
                    <li key={i} className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/40 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-semibold leading-snug tracking-tight">{item.task}</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--c-fg-muted)]">
                            {item.owner && <span>👤 {item.owner}</span>}
                            {item.due && <span>📅 {item.due}</span>}
                            {item.depends_on && <span>↳ {item.depends_on}</span>}
                          </div>
                        </div>
                        {item.priority && (
                          <Badge tone={PRIORITY_TONE[item.priority] || 'neutral'} size="sm">
                            {item.priority}
                          </Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Decisions"
              icon={<CheckCircle2 />}
              tone="success"
              count={payload.decisions?.length || 0}
            >
              {(payload.decisions?.length || 0) === 0 ? (
                <EmptyState icon={<CheckCircle2 className="h-4 w-4" />} title="No decisions recorded" />
              ) : (
                <ul className="space-y-3">
                  {payload.decisions.map((d, i) => (
                    <li key={i} className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/40 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-semibold tracking-tight">{d.title}</div>
                          {d.detail && (
                            <div className="mt-1 text-[12.5px] leading-relaxed text-[var(--c-fg-dim)]">{d.detail}</div>
                          )}
                          {d.time && (
                            <div className="mt-1.5 mono text-[11px] text-[var(--c-fg-muted)]">{d.time}</div>
                          )}
                        </div>
                        {d.type && (
                          <Badge tone={DECISION_TONE[d.type] || 'neutral'} size="sm">{d.type}</Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </section>

          {/* ============ Risks + Contradictions ============ */}
          <section className="mb-8 grid gap-5 lg:grid-cols-2">
            <SectionCard
              title="Risks"
              icon={<ShieldAlert />}
              tone="warn"
              count={payload.risks?.length || 0}
            >
              {(payload.risks?.length || 0) === 0 ? (
                <EmptyState icon={<ShieldAlert className="h-4 w-4" />} title="No risks flagged" hint="Nothing in the discussion triggered a warning." />
              ) : (
                <ul className="space-y-2.5">
                  {payload.risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/40 p-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--c-warn)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-[13px] font-semibold tracking-tight">{r.title}</div>
                          {r.severity && (
                            <Badge tone={SEVERITY_TONE[r.severity] || 'neutral'} size="sm">{r.severity}</Badge>
                          )}
                        </div>
                        {r.rationale && (
                          <div className="mt-1 text-[12px] leading-relaxed text-[var(--c-fg-muted)]">{r.rationale}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Contradictions"
              icon={<GitMerge />}
              tone="danger"
              count={payload.contradictions?.length || 0}
            >
              {(payload.contradictions?.length || 0) === 0 ? (
                <EmptyState icon={<GitMerge className="h-4 w-4" />} title="No contradictions detected" />
              ) : (
                <ul className="space-y-3">
                  {payload.contradictions.map((c, i) => (
                    <li key={i} className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/40 p-3">
                      <div className="text-[13px] font-semibold tracking-tight">{c.summary}</div>
                      {Array.isArray(c.between) && c.between.length > 0 && (
                        <ul className="mt-2 space-y-1 text-[12px] text-[var(--c-fg-muted)]">
                          {c.between.map((b, j) => (
                            <li key={j} className="flex gap-1.5"><ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0" /> {b}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </section>

          {/* ============ Topics timeline ============ */}
          <section className="mb-8">
            <SectionCard
              title="Topics discussed"
              icon={<FileText />}
              tone="neutral"
              count={payload.topics?.length || 0}
            >
              {(payload.topics?.length || 0) === 0 ? (
                <EmptyState icon={<FileText className="h-4 w-4" />} title="No topics segmented" />
              ) : (
                <ol className="relative space-y-4 border-l-2 border-[var(--c-line)] pl-5">
                  {payload.topics.map((t, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[27px] mt-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--c-accent)] text-[10px] font-bold text-white">{i + 1}</span>
                      <div className="text-[14px] font-semibold tracking-tight">{t.title}</div>
                      {(t.started_at || t.ended_at) && (
                        <div className="mono mt-0.5 text-[11px] text-[var(--c-fg-muted)]">
                          {t.started_at || '—'} → {t.ended_at || '—'}
                        </div>
                      )}
                      {t.summary && (
                        <div className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--c-fg-dim)]">{t.summary}</div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </SectionCard>
          </section>

          {/* ============ Speakers + Sentiment ============ */}
          <section className="mb-8 grid gap-5 lg:grid-cols-2">
            <SectionCard
              title="Speaker insights"
              icon={<Mic />}
              tone="accent"
              count={payload.speakers?.length || 0}
            >
              {(payload.speakers?.length || 0) === 0 ? (
                <EmptyState icon={<Mic className="h-4 w-4" />} title="No speaker analysis" />
              ) : (
                <ul className="space-y-3">
                  {payload.speakers.map((s, i) => (
                    <li key={i} className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[13.5px] font-semibold tracking-tight">{s.name}</div>
                        <div className="flex items-center gap-1.5">
                          {s.role_in_meeting && <Badge tone="accent" size="sm">{s.role_in_meeting}</Badge>}
                          {typeof s.message_count === 'number' && s.message_count > 0 && (
                            <Badge tone="neutral" size="sm">{s.message_count} msgs</Badge>
                          )}
                        </div>
                      </div>
                      {Array.isArray(s.highlights) && s.highlights.length > 0 && (
                        <ul className="mt-2 space-y-1 text-[12px] text-[var(--c-fg-muted)]">
                          {s.highlights.map((h, j) => (
                            <li key={j} className="flex gap-1.5"><ChevronRight className="mt-0.5 h-3 w-3 flex-shrink-0" /> {h}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="Team sentiment"
              icon={<Sparkles />}
              tone="success"
            >
              {payload.sentiment ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SENTIMENT_TONE[payload.sentiment.overall] || 'neutral'} size="md">
                      {payload.sentiment.overall || 'unknown'}
                    </Badge>
                    {payload.sentiment.energy && (
                      <Badge tone="neutral" size="md">energy: {payload.sentiment.energy}</Badge>
                    )}
                  </div>
                  {payload.sentiment.notes && (
                    <p className="text-[13px] leading-relaxed text-[var(--c-fg-dim)]">{payload.sentiment.notes}</p>
                  )}
                </div>
              ) : (
                <EmptyState icon={<Sparkles className="h-4 w-4" />} title="No sentiment analysis" />
              )}
            </SectionCard>
          </section>

          {/* ============ Follow-ups + Knowledge nuggets ============ */}
          <section className="mb-8 grid gap-5 lg:grid-cols-2">
            <SectionCard
              title="Suggested follow-ups"
              icon={<ArrowLeft className="rotate-180" />}
              tone="accent"
            >
              {(() => {
                const f = payload.follow_ups || {}
                const all = [
                  ...(f.emails || []).map((x) => ({ tag: 'email', body: x })),
                  ...(f.slack || []).map((x) => ({ tag: 'slack', body: x })),
                  ...(f.tasks || []).map((x) => ({ tag: 'task',  body: x })),
                ]
                if (all.length === 0) {
                  return <EmptyState icon={<ArrowLeft className="h-4 w-4" />} title="No follow-ups suggested" />
                }
                return (
                  <ul className="space-y-2">
                    {all.map((x, i) => (
                      <li key={i} className="flex items-start gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/40 p-3">
                        <Badge tone="accent" size="sm">{x.tag}</Badge>
                        <span className="text-[13px] leading-relaxed">{x.body}</span>
                      </li>
                    ))}
                  </ul>
                )
              })()}
            </SectionCard>

            <SectionCard
              title="Knowledge nuggets"
              icon={<Lightbulb />}
              tone="warn"
              count={payload.knowledge_nuggets?.length || 0}
            >
              {(payload.knowledge_nuggets?.length || 0) === 0 ? (
                <EmptyState icon={<Lightbulb className="h-4 w-4" />} title="Nothing wiki-worthy yet" />
              ) : (
                <ul className="space-y-2">
                  {payload.knowledge_nuggets.map((n, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/40 p-3 text-[13px] leading-relaxed">
                      <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--c-warn)]" />
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </section>
        </>
        )
      )
    )}
    </div>
  )
}
