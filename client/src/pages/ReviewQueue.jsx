import { useEffect, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, ShieldAlert,
  ThumbsDown, ThumbsUp, Undo2,
} from 'lucide-react'
import { api } from '../api/client'
import { Card } from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import { useToast } from '../components/ui/Toast'
import { cn } from '../lib/cn'

/* Action Review Queue (Phase 2 slice 2) — one cross-category queue for
 * every staged governed action, per spec §5.1/DR-06. Persistent workspace
 * surface, not buried inside Calendar (spec §15.1). No real producer exists
 * yet (Phase 2 slice 3/7 are the first) — this UI is real against the real
 * backend, it will simply show an empty queue until then. */

const STATUS_TONE = {
  pending: 'warn', approved: 'success', rejected: 'danger',
  redraft_requested: 'accent', escalated: 'danger',
}
const STATUS_LABEL = {
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected',
  redraft_requested: 'Redraft requested', escalated: 'Escalated',
}

function ageLabel(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function VerdictBadge({ label, verdict }) {
  const tone = verdict === 'fail' ? 'danger' : verdict === 'warn' ? 'warn' : 'success'
  return <Badge tone={tone} size="sm">{label}: {String(verdict)}</Badge>
}

function QueueItemCard({ item, onTransition, busy }) {
  const [expanded, setExpanded] = useState(false)
  const isPending = item.status === 'pending'

  const act = async (fn) => {
    const note = window.prompt('Optional note for this decision:') || undefined
    await onTransition(item.id, fn, note)
  }

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--c-line)] p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] text-[var(--c-fg-muted)]">{item.action_type}</span>
            <Badge tone={STATUS_TONE[item.status] || 'neutral'} size="sm">{STATUS_LABEL[item.status] || item.status}</Badge>
            {item.proposed_by_agent && <Badge tone="accent" size="sm">Agent-proposed</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--c-fg-muted)]">
            <Clock className="h-3.5 w-3.5" /> {ageLabel(item.created_at)}
          </div>
        </div>
        <Button variant="ghost" size="xs" onClick={() => setExpanded((v) => !v)} rightIcon={expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}>
          {expanded ? 'Hide details' : 'Details'}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-3 border-b border-[var(--c-line)] p-4">
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--c-fg-muted)]">Proposed action</div>
            <pre className="overflow-x-auto rounded-lg bg-[var(--c-bg-2)] p-3 text-[12px] text-[var(--c-fg-dim)]">{JSON.stringify(item.action_payload, null, 2)}</pre>
          </div>
          {item.reasoning_trace_ref && (
            <div className="text-[12px] text-[var(--c-fg-muted)]">Reasoning trace: <span className="font-mono">{item.reasoning_trace_ref}</span></div>
          )}
          {!!Object.keys(item.policy_verdicts || {}).length && (
            <div>
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--c-fg-muted)]">Policy verdicts</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(item.policy_verdicts).map(([k, v]) => <VerdictBadge key={k} label={k} verdict={v} />)}
              </div>
            </div>
          )}
          {!!Object.keys(item.blast_radius || {}).length && (
            <div>
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--c-fg-muted)]">Blast radius</div>
              <pre className="overflow-x-auto rounded-lg bg-[var(--c-bg-2)] p-3 text-[12px] text-[var(--c-fg-dim)]">{JSON.stringify(item.blast_radius, null, 2)}</pre>
            </div>
          )}
          <div className="text-[12px] text-[var(--c-fg-muted)]">
            Rollback: <span className="font-medium text-[var(--c-fg-dim)]">{item.rollback_descriptor.replace(/_/g, ' ')}</span>
          </div>
          {item.review_note && (
            <div className="rounded-lg border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3 text-[12px] text-[var(--c-fg-dim)]">
              <span className="font-semibold text-[var(--c-fg)]">Reviewer note:</span> {item.review_note}
            </div>
          )}
        </div>
      )}

      {isPending && (
        <div className="flex flex-wrap gap-2 p-4">
          <Button variant="primary" size="sm" disabled={busy} leftIcon={<ThumbsUp className="h-3.5 w-3.5" />} onClick={() => act('approve')}>Approve</Button>
          <Button variant="outline" size="sm" disabled={busy} leftIcon={<ThumbsDown className="h-3.5 w-3.5" />} onClick={() => act('reject')}>Reject</Button>
          <Button variant="ghost" size="sm" disabled={busy} leftIcon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => act('requestRedraft')}>Request redraft</Button>
          <Button variant="ghost" size="sm" disabled={busy} leftIcon={<ShieldAlert className="h-3.5 w-3.5" />} onClick={() => act('escalate')}>Escalate</Button>
        </div>
      )}
    </Card>
  )
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'redraft_requested', label: 'Redraft requested' },
  { key: 'escalated', label: 'Escalated' },
]

export default function ReviewQueue() {
  const { toast } = useToast()
  const [items, setItems] = useState(null) // null = loading
  const [filter, setFilter] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const load = async (status) => {
    try {
      const qs = status ? `?status=${encodeURIComponent(status)}` : ''
      const data = await api(`/api/connect/action-review/items${qs}`)
      setItems(data)
    } catch (e) {
      setError(e.message)
      setItems([])
    }
  }

  useEffect(() => { load(filter) }, [filter])

  const endpointFor = { approve: 'approve', reject: 'reject', requestRedraft: 'request-redraft', escalate: 'escalate' }

  const onTransition = async (itemId, action, note) => {
    setBusyId(itemId)
    try {
      await api(`/api/connect/action-review/items/${itemId}/${endpointFor[action]}`, {
        method: 'POST', body: { note },
      })
      toast(`Item ${action === 'requestRedraft' ? 'sent back for redraft' : action + 'd'}`)
      await load(filter)
    } catch (e) {
      toast(e.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 py-10 sm:px-10">
      <header className="mb-6">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--c-accent-soft)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--c-accent)]">
          <CheckCircle2 className="h-3.5 w-3.5" /> Governance
        </div>
        <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Review Queue</h1>
        <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">
          Every staged action awaiting human review — calendar, mail, and future agent actions all land in one place.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              filter === f.key
                ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-accent)]'
                : 'border-[var(--c-line)] bg-[var(--c-bg-2)] text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items === null && (
        <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>
      )}

      {items !== null && error && (
        <div className="mb-4 flex items-center gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--c-danger)_30%,var(--c-line))] px-4 py-3 text-[13px] text-[var(--c-danger)]">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {items !== null && !items.length && !error && (
        <div className="rounded-[14px] border border-dashed border-[var(--c-line-strong)] bg-[var(--c-bg-2)] px-6 py-12 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-[var(--c-fg-muted)]" />
          <p className="text-[13.5px] font-medium text-[var(--c-fg)]">Nothing to review</p>
          <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">Staged actions from Calendar and Mail will appear here once those features start proposing them.</p>
        </div>
      )}

      <div className="space-y-3">
        {(items || []).map((item) => (
          <QueueItemCard key={item.id} item={item} onTransition={onTransition} busy={busyId === item.id} />
        ))}
      </div>
    </div>
  )
}
