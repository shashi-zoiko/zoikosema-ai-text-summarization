import { useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, LifeBuoy, Mail,
  RotateCcw, Send, User as UserIcon,
} from 'lucide-react'
import { api } from '../api/client'
import { useToast } from '../components/ui/Toast'
import { Card } from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import { cn } from '../lib/cn'
import { useResource } from '../lib/useResource'

/* All content comes from GET /api/support/overview (live status, the current
 * user's account/workspace, product FAQs, and their real support cases). The
 * only thing this file holds is presentation — no fabricated data. */

const CASE_STATUS = {
  open: { label: 'Open', tone: 'accent' },
  in_progress: { label: 'In progress', tone: 'warn' },
  resolved: { label: 'Resolved', tone: 'success' },
}

function Panel({ title, description, icon: Icon, actions, children, className }) {
  return (
    <Card className={className}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--c-line)] p-5 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--c-accent-soft)] text-[var(--c-accent)] [&_svg]:h-[18px] [&_svg]:w-[18px]">
                <Icon />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold tracking-tight text-[var(--c-fg)]">{title}</h3>
              {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--c-fg-muted)]">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </Card>
  )
}

function StatusBand({ status }) {
  const operational = status?.state === 'operational'
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-2xl border p-4',
      operational
        ? 'border-[color-mix(in_srgb,var(--c-success)_22%,var(--c-line))] bg-[var(--c-success-soft)]'
        : 'border-[color-mix(in_srgb,var(--c-warn)_22%,var(--c-line))] bg-[var(--c-warn-soft)]',
    )}>
      <span className="relative flex h-3 w-3">
        {operational && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--c-success)] opacity-60" />}
        <span className={cn('relative h-3 w-3 rounded-full', operational ? 'bg-[var(--c-success)]' : 'bg-[var(--c-warn)]')} />
      </span>
      <div>
        <div className={cn('text-[14px] font-semibold', operational ? 'text-[var(--c-success)]' : 'text-[var(--c-warn)]')}>
          {operational ? 'All systems operational' : 'Service degraded'}
        </div>
        <div className="text-[12px] text-[var(--c-fg-muted)]">
          Live status{status?.checkedAt && ` · checked ${new Date(status.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
        </div>
      </div>
    </div>
  )
}

function AccountCard({ account }) {
  const rows = [
    ['Name', account.name],
    ['Email', account.email],
    ['Role', account.role],
    ['Workspace', account.workspace || '—'],
  ]
  return (
    <Panel title="Your account" description="What support sees about you" icon={UserIcon}>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 py-1.5">
            <dt className="shrink-0 text-[12.5px] text-[var(--c-fg-muted)]">{k}</dt>
            <dd className="min-w-0 truncate text-right text-[13px] text-[var(--c-fg)]">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

function NewCaseForm({ categories, onCreated }) {
  const { toast } = useToast()
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState(categories[0] || 'Other')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (subject.trim().length < 3 || message.trim().length < 5) {
      toast({ variant: 'warning', title: 'Add more detail', description: 'A subject and a short description are required.' })
      return
    }
    setBusy(true)
    try {
      await api('/api/support/cases', { method: 'POST', body: { subject, category, message } })
      toast({ variant: 'success', title: 'Case submitted', description: 'We’ll follow up on it.' })
      setSubject(''); setMessage('')
      onCreated()
    } catch (err) {
      toast({ variant: 'error', title: 'Couldn’t submit', description: err.message })
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-lg border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2 text-[13px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)] focus:ring-2 focus:ring-[var(--c-accent-ring)]'
  return (
    <Panel title="Open a support case" description="Describe your issue — we’ll get back to you." icon={LifeBuoy}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-[var(--c-fg-dim)]">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className={input} placeholder="Short summary of the issue" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-[var(--c-fg-dim)]">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-[var(--c-fg-dim)]">Description</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className={cn(input, 'resize-y')} placeholder="What happened? What did you expect?" />
        </label>
        <Button type="submit" variant="primary" size="sm" disabled={busy} leftIcon={<Send className="h-4 w-4" />}>
          {busy ? 'Submitting…' : 'Submit case'}
        </Button>
      </form>
    </Panel>
  )
}

function CasesList({ cases }) {
  return (
    <Panel title="Your support cases" description={`${cases.length} case${cases.length === 1 ? '' : 's'}`} icon={CheckCircle2}>
      {cases.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-[var(--c-fg-muted)]">No cases yet. Open one on the left when you need help.</p>
      ) : (
        <div className="space-y-3">
          {cases.map((c) => {
            const st = CASE_STATUS[c.status] || CASE_STATUS.open
            return (
              <div key={c.id} className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="truncate text-[13.5px] font-semibold text-[var(--c-fg)]">{c.subject}</span>
                  <Badge tone={st.tone} size="sm">{st.label}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] text-[var(--c-fg-dim)]">{c.message}</p>
                <div className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--c-fg-muted)]">
                  <Badge tone="neutral" size="sm">{c.category}</Badge>
                  {c.created_at && <span>{new Date(c.created_at).toLocaleDateString()}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function Faq({ item }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-[var(--c-line)] last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 py-3 text-left text-[13.5px] font-medium text-[var(--c-fg)]"
        aria-expanded={open}
      >
        {item.q}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-[var(--c-fg-muted)] transition-transform', open && 'rotate-180')} />
      </button>
      {open && <p className="pb-3 text-[13px] leading-relaxed text-[var(--c-fg-dim)]">{item.a}</p>}
    </div>
  )
}

function PageMessage({ children }) {
  return <div className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6 lg:px-8">{children}</div>
}

export default function HelpSupport() {
  const { data, error, loading, reload } = useResource('/api/support/overview')

  if (loading) {
    return <PageMessage><div className="flex items-center justify-center py-24"><Spinner size="lg" /></div></PageMessage>
  }
  if (error) {
    return (
      <PageMessage>
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--c-line-strong)] py-20 text-center">
          <AlertTriangle className="h-8 w-8 text-[var(--c-danger)]" />
          <p className="text-[15px] font-semibold text-[var(--c-fg)]">Couldn’t load Help &amp; Support</p>
          <p className="max-w-sm text-[13px] text-[var(--c-fg-muted)]">{error}</p>
          <Button variant="outline" size="sm" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={reload}>Retry</Button>
        </div>
      </PageMessage>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Help &amp; Support</h1>
          <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">Check status, browse FAQs, or open a case.</p>
        </div>
        {data.account.email && (
          <Button variant="outline" size="sm" leftIcon={<Mail className="h-4 w-4" />} onClick={() => { window.location.href = `mailto:support@zoikosema.com?subject=Support%20request%20from%20${encodeURIComponent(data.account.email)}` }}>
            Email support
          </Button>
        )}
      </div>

      <StatusBand status={data.status} />
      <AccountCard account={data.account} />

      <div className="grid gap-5 lg:grid-cols-2">
        <NewCaseForm categories={data.categories} onCreated={reload} />
        <CasesList cases={data.cases} />
      </div>

      <Panel title="Frequently asked questions" description="Quick answers to common questions">
        <div>{data.faqs.map((f) => <Faq key={f.q} item={f} />)}</div>
      </Panel>
    </div>
  )
}
