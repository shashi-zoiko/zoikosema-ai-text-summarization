import { createContext, useContext, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowUpRight, Bot, CalendarClock, CheckCircle2,
  ChevronDown, Clock, FileText, Info, Landmark, LifeBuoy, Lock, MessageSquare,
  Play, RotateCcw, Send, Shield, ShieldCheck, Sparkles, Stethoscope,
  Users, Zap,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/ui/Toast'
import { Card } from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Avatar from '../components/ui/Avatar'
import Spinner from '../components/ui/Spinner'
import { cn } from '../lib/cn'
import { useResource } from '../lib/useResource'
import { can, normalizeRole, recordAudit } from '../features/support/supportData'

/* All page content is fetched from /api/support/overview and shared via this
 * context so nested cards read it without prop-threading. */
const SupportDataContext = createContext(null)
const useData = () => useContext(SupportDataContext)

/* ══════════════════════════════════ primitives ══════════════════════════════════ */

const TONE_TEXT = {
  success: 'text-[var(--c-success)]', accent: 'text-[var(--c-accent)]',
  warn: 'text-[var(--c-warn)]', danger: 'text-[var(--c-danger)]', neutral: 'text-[var(--c-fg-dim)]',
}
const TONE_SOFT = {
  success: 'bg-[var(--c-success-soft)] text-[var(--c-success)]',
  accent: 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]',
  warn: 'bg-[var(--c-warn-soft)] text-[var(--c-warn)]',
  danger: 'bg-[var(--c-danger-soft)] text-[var(--c-danger)]',
  neutral: 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)]',
}

/* A titled surface built on the shared Card so it inherits the dashboard's
 * radius / shadow / border language. Same contract as Billing's Panel. */
function Panel({ title, description, icon: Icon, actions, children, className, id }) {
  return (
    <Card className={className} id={id}>
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

function KV({ label, value, mono, strong, className }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', className)}>
      <dt className="shrink-0 text-[12.5px] text-[var(--c-fg-muted)]">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-[13px] text-[var(--c-fg)]', mono && 'font-mono tabular-nums', strong && 'font-semibold')}>{value}</dd>
    </div>
  )
}

function SectionLabel({ children }) {
  return <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--c-fg-muted)]">{children}</div>
}

const PRIORITY_TONE = { P1: 'danger', P2: 'warn', P3: 'accent', P4: 'neutral' }

/* ══════════════════════════════════ Zone 1 — header ══════════════════════════════════ */

function SupportHeader({ act }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Help &amp; Support</h1>
        <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">Your enterprise support command center</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" leftIcon={<MessageSquare className="h-4 w-4" />} onClick={() => act('Contact CSM')}>Contact CSM</Button>
        <Button variant="danger" size="sm" leftIcon={<AlertTriangle className="h-4 w-4" />} onClick={() => act('Raise emergency', 'newCase')}>Emergency</Button>
        <Button variant="primary" size="sm" leftIcon={<ArrowUpRight className="h-4 w-4" />} onClick={() => act.openCase()}>New Case</Button>
      </div>
    </div>
  )
}

/* Reusable status band — renders any of the five states from STATUS_BANDS.
 * `navy` is a fixed enterprise-dark band; the rest map onto theme tones. */
export function StatusBand({ stateKey, act }) {
  const { STATUS_BANDS, CURRENT_STATUS } = useData()
  const s = STATUS_BANDS[stateKey || CURRENT_STATUS] || STATUS_BANDS.healthy
  const navy = s.tone === 'navy'
  const Icon = { success: CheckCircle2, warn: AlertTriangle, danger: AlertTriangle, navy: Landmark }[s.tone] || Info
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between',
        navy
          ? 'border-[#2a3550] bg-[#111a2e] text-[#dbe4f5]'
          : cn('border-[color-mix(in_srgb,currentColor_22%,var(--c-line))]', TONE_SOFT[s.tone]),
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center', navy && 'text-[#7aa5f7]')}>
          {s.tone === 'success'
            ? <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--c-success)] opacity-60" /><span className="relative h-3 w-3 rounded-full bg-[var(--c-success)]" /></span>
            : <Icon className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-[14px] font-semibold', navy ? 'text-white' : TONE_TEXT[s.tone])}>{s.title}</span>
            <Badge tone={navy ? 'accent' : s.tone} size="sm">{s.label}</Badge>
          </div>
          <div className={cn('mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]', navy ? 'text-[#aebbd6]' : 'text-[var(--c-fg-dim)]')}>
            {s.lines.map((l, i) => (
              <span key={l} className="inline-flex items-center gap-2">
                {i > 0 && <span aria-hidden className="h-1 w-1 rounded-full bg-current opacity-50" />}{l}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-center">
        {s.actions.map((a) => (
          <Button
            key={a.label}
            variant={a.variant || 'secondary'}
            size="sm"
            className={navy ? 'border-[#2a3550] bg-[#1b2740] text-white hover:bg-[#243357]' : undefined}
            onClick={() => (a.kind === 'newCase' ? act.openCase() : act(a.label))}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/* Enterprise account team + SLA + policy. */
function AccountTeam({ act }) {
  const { csm, tam, sla, policy } = useData().ACCOUNT_TEAM
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Customer Success" icon={Users} className="lg:col-span-1">
        <ContactRow c={csm} />
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--c-line)] pt-3">
          <Button variant="outline" size="xs" leftIcon={<MessageSquare className="h-3.5 w-3.5" />} onClick={() => act('Message CSM')}>Message</Button>
          <Button variant="ghost" size="xs" leftIcon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => act('Book time with CSM')}>Book time</Button>
        </div>
      </Panel>

      <Panel title="Technical Account" icon={ShieldCheck} className="lg:col-span-1">
        <ContactRow c={tam} />
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--c-line)] pt-3">
          <Button variant="outline" size="xs" leftIcon={<Zap className="h-3.5 w-3.5" />} onClick={() => act('Escalate to TAM')}>Escalate</Button>
        </div>
      </Panel>

      <Panel title="Support Policy & SLA" icon={Landmark} className="lg:col-span-1">
        <dl>
          <KV label="Tier" value={sla.tier} strong />
          <KV label="P1 response" value={sla.p1} />
          <KV label="P2 response" value={sla.p2} />
          <KV label="Coverage" value={sla.coverage} />
        </dl>
        <p className="mt-3 border-t border-[var(--c-line)] pt-3 text-[12px] text-[var(--c-fg-muted)]">{policy}</p>
        <Button variant="ghost" size="xs" className="mt-2" rightIcon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => act('View support policy')}>View policy</Button>
      </Panel>
    </div>
  )
}

function ContactRow({ c }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={c.name} color={c.avatarColor} size="md" />
      <div className="min-w-0">
        <div className="truncate text-[14px] font-semibold text-[var(--c-fg)]">{c.name}</div>
        <div className="truncate text-[12px] text-[var(--c-fg-muted)]">{c.role}</div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════ Zone 2 — AI triage ══════════════════════════════════ */

function AITriage({ act }) {
  const { TRIAGE_CATEGORIES, TRIAGE_RESULT } = useData()
  const [issue, setIssue] = useState('')
  const [cat, setCat] = useState(null)
  const [step, setStep] = useState(0) // 0 input · 1 parsed · 2 known issues · 3 resolution
  const r = TRIAGE_RESULT

  const analyze = () => { if (issue.trim() || cat) setStep(1) }
  const reset = () => { setStep(0); setIssue(''); setCat(null) }

  return (
    <Panel
      title="What can we help with?"
      description="Describe the issue — AI triages it, checks known incidents, and drafts a case."
      icon={Sparkles}
      actions={step > 0 && <Button variant="ghost" size="xs" leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={reset}>Start over</Button>}
    >
      {step === 0 ? (
        <>
          <textarea
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            rows={3}
            placeholder="Describe the issue in your own words…"
            aria-label="Describe the issue"
            className="w-full resize-y rounded-xl border border-[var(--c-line)] bg-[var(--c-surface)] p-3 text-[13.5px] text-[var(--c-fg)] outline-none placeholder:text-[var(--c-fg-muted)] focus:border-[var(--c-accent)] focus:ring-4 focus:ring-[var(--c-accent-ring)]"
          />
          <SectionLabel>Or pick a category</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {TRIAGE_CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c === cat ? null : c)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent-ring)]',
                  c === cat
                    ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-accent)]'
                    : 'border-[var(--c-line)] text-[var(--c-fg-dim)] hover:border-[var(--c-line-strong)] hover:bg-[var(--c-bg-3)]',
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <Button variant="primary" size="sm" leftIcon={<Bot className="h-4 w-4" />} disabled={!issue.trim() && !cat} onClick={analyze}>Analyze with AI</Button>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <TriageSteps step={step} />

          {/* Step 1 — parsed */}
          <div className="grid gap-3 sm:grid-cols-2">
            <TriageStat label="Product area" value={cat || r.area} />
            <TriageStat label="Urgency" value={r.urgency} tone="warn" />
            <TriageStat label="Workspace" value={r.workspace} />
            <TriageStat label="Possible cause" value={r.cause} />
          </div>

          {step >= 2 && (
            <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-4">
              <SectionLabel>Checked against known issues</SectionLabel>
              <ul className="space-y-2">
                {r.knownIssues.map((k) => (
                  <li key={k.text} className="flex items-center gap-2 text-[13px]">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', { warn: 'bg-[var(--c-warn)]', neutral: 'bg-[var(--c-fg-muted)]', accent: 'bg-[var(--c-accent)]' }[k.tone])} />
                    <span className="text-[var(--c-fg-dim)]">{k.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step >= 3 && (
            <div className="rounded-xl border border-[color-mix(in_srgb,var(--c-accent)_25%,var(--c-line))] bg-[var(--c-accent-soft)] p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold text-[var(--c-accent)]">Suggested fix</span>
                <Badge tone="accent" size="sm">AI confidence {r.confidence}%</Badge>
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--c-fg-dim)]">{r.fix}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="success" size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => { act('Marked resolved by AI'); reset() }}>Resolved</Button>
                <Button variant="outline" size="sm" onClick={() => act.openCase({ summary: issue, area: cat || r.area, urgency: r.urgency })}>Still need help → Open case</Button>
              </div>
            </div>
          )}

          {step < 3 && (
            <Button variant="primary" size="sm" onClick={() => setStep((s) => s + 1)}>
              {step === 1 ? 'Check known issues' : 'Offer resolution'}
            </Button>
          )}
        </div>
      )}
    </Panel>
  )
}

function TriageSteps({ step }) {
  const steps = ['Parse issue', 'Check known issues', 'Offer resolution']
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
      {steps.map((label, i) => {
        const n = i + 1
        const done = step > n
        const active = step === n
        return (
          <li key={label} className="flex items-center gap-2">
            <span className={cn(
              'inline-flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-bold',
              done ? 'bg-[var(--c-success)] text-white' : active ? 'bg-[var(--c-accent)] text-white' : 'bg-[var(--c-bg-3)] text-[var(--c-fg-muted)]',
            )}>{done ? '✓' : n}</span>
            <span className={cn(active ? 'font-semibold text-[var(--c-fg)]' : 'text-[var(--c-fg-muted)]')}>{label}</span>
            {i < steps.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-[var(--c-line-strong)]" />}
          </li>
        )
      })}
    </ol>
  )
}

function TriageStat({ label, value, tone = 'neutral' }) {
  return (
    <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--c-fg-muted)]">{label}</div>
      <div className={cn('mt-1 text-[13.5px] font-medium', tone === 'warn' ? 'text-[var(--c-warn)]' : 'text-[var(--c-fg)]')}>{value}</div>
    </div>
  )
}

/* ══════════════════════════════════ Support cases ══════════════════════════════════ */

const CASE_STATUS = {
  action_required: { label: 'Action needed', tone: 'danger' },
  in_progress: { label: 'In progress', tone: 'accent' },
  resolved: { label: 'Resolved', tone: 'success' },
}

function SupportCases({ act }) {
  const { CASES, RESOLVED_COUNT } = useData()
  return (
    <Panel
      title="Your Support Cases"
      description="Sorted by action required, then SLA urgency, then recent activity"
      icon={LifeBuoy}
      actions={<Button variant="primary" size="xs" onClick={() => act.openCase()}>New Case</Button>}
    >
      <div className="space-y-3">
        {CASES.map((c) => <SupportCaseCard key={c.id} c={c} act={act} />)}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-[var(--c-line)] pt-3">
        <span className="inline-flex items-center gap-2 text-[13px] text-[var(--c-fg-muted)]">
          <CheckCircle2 className="h-4 w-4 text-[var(--c-success)]" /> Recently resolved ({RESOLVED_COUNT})
        </span>
        <Button variant="ghost" size="xs" onClick={() => act('Show all cases')}>Show all</Button>
      </div>
    </Panel>
  )
}

export function SupportCaseCard({ c, act }) {
  const st = CASE_STATUS[c.status]
  const actionNeeded = c.status === 'action_required'
  return (
    <div className={cn(
      'rounded-xl border p-4',
      actionNeeded ? 'border-[color-mix(in_srgb,var(--c-danger)_30%,var(--c-line))] bg-[var(--c-danger-soft)]' : 'border-[var(--c-line)] bg-[var(--c-bg-2)]',
    )}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={PRIORITY_TONE[c.priority]} size="sm">{c.priority}</Badge>
          <span className="font-mono text-[13px] font-semibold text-[var(--c-fg)]">{c.id}</span>
          <Badge tone={st.tone} size="sm">{st.label}</Badge>
        </div>
        {c.slaRemaining && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--c-warn)]">
            <Clock className="h-3.5 w-3.5" /> {c.slaRemaining} remaining
          </span>
        )}
      </div>
      <p className="mt-2 text-[12.5px] text-[var(--c-fg-muted)]">{c.activity}</p>
      <p className="mt-1 line-clamp-2 text-[13px] text-[var(--c-fg-dim)]">{c.preview}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 border-t border-[var(--c-line)] pt-2 sm:grid-cols-3">
        <KV label="Owner" value={c.owner} />
        <KV label="Escalation" value={c.escalation} />
        <KV label="Next update" value={c.nextUpdate} />
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {actionNeeded
          ? <Button variant="primary" size="xs" leftIcon={<Send className="h-3.5 w-3.5" />} onClick={() => act(`Reply to ${c.id}`)}>Reply now</Button>
          : <Button variant="outline" size="xs" onClick={() => act(`View case ${c.id}`)}>View case</Button>}
      </div>
    </div>
  )
}

/* ══════════════════════════════════ Diagnostics ══════════════════════════════════ */

function DiagnosticsPanel({ act, onBundle }) {
  const { DIAGNOSTIC_HISTORY } = useData()
  return (
    <Panel title="Diagnostics & Status" description="Run diagnostics and manage what Support can see" icon={Stethoscope}>
      <div className="grid gap-3 sm:grid-cols-2">
        <DiagAction icon={Play} title="Run meeting diagnostic" desc="Measure jitter, packet loss, bitrate" onClick={() => act('Run meeting diagnostic', 'runDiagnostic')} disabled={!can(act.role, 'runDiagnostic')} />
        <DiagAction icon={Activity} title="Incident subscriptions" desc="Alerts by component & region" onClick={() => act('Manage incident subscriptions')} />
        <DiagAction icon={Shield} title="Secure support bundle" desc="Metadata only — content excluded" onClick={onBundle} />
        <DiagAction icon={Clock} title="Diagnostic history" desc={`${DIAGNOSTIC_HISTORY.length} recent runs`} onClick={() => act('Open diagnostic history')} />
      </div>
      <div className="mt-4 border-t border-[var(--c-line)] pt-3">
        <SectionLabel>Recent diagnostics</SectionLabel>
        <ul className="space-y-2">
          {DIAGNOSTIC_HISTORY.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className={cn('h-2 w-2 shrink-0 rounded-full', d.tone === 'success' ? 'bg-[var(--c-success)]' : 'bg-[var(--c-warn)]')} />
                <span className="truncate text-[var(--c-fg-dim)]">{d.result}</span>
              </span>
              <span className="shrink-0 font-mono text-[11.5px] text-[var(--c-fg-muted)]">{d.when}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

function DiagAction({ icon: Icon, title, desc, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-start gap-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3 text-left transition-colors hover:border-[var(--c-accent-ring)] hover:bg-[var(--c-bg-3)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent-ring)]"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)] [&_svg]:h-[17px] [&_svg]:w-[17px]">{Icon && <Icon />}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-[var(--c-fg)]">{title}</span>
        <span className="block text-[11.5px] text-[var(--c-fg-muted)]">{desc}</span>
      </span>
    </button>
  )
}

/* ══════════════════════════════════ Agentic action review ══════════════════════════════════ */

function AgenticReview({ act }) {
  const { AGENTIC_ACTIONS } = useData()
  return (
    <Panel title="Recent Agentic Actions" description="Review, trace, and roll back autonomous actions" icon={Bot}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {AGENTIC_ACTIONS.map((a) => <AgenticActionCard key={a.id} a={a} act={act} />)}
      </div>
    </Panel>
  )
}

export function AgenticActionCard({ a, act }) {
  const confTone = a.confidence >= 90 ? 'success' : a.confidence >= 80 ? 'accent' : 'warn'
  return (
    <div className="flex flex-col rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold text-[var(--c-fg)]">{a.title}</div>
          <div className="truncate text-[12px] text-[var(--c-fg-muted)]">{a.meeting}</div>
        </div>
        <Badge tone={confTone} size="sm">{a.confidence}%</Badge>
      </div>
      {a.detail && <p className="mt-2 text-[12.5px] text-[var(--c-fg-dim)]">{a.detail}</p>}
      <dl className="mt-2 border-t border-[var(--c-line)] pt-2">
        <KV label="Action ID" value={a.id} mono />
        <KV label="Workflow" value={a.workflowId} mono />
        <KV label="Connected" value={a.connectedSystem} />
        <KV label="Approval" value={a.approvalMode} />
        <KV label="Policy" value={<span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-[var(--c-success)]" />{a.policy}</span>} />
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {a.actions.map((label) => {
          const rollback = label === 'Rollback'
          const report = label === 'Report issue'
          return (
            <Button
              key={label}
              variant={rollback ? (a.canRollback ? 'outline' : 'ghost') : report ? 'ghost' : 'ghost'}
              size="xs"
              disabled={rollback && !a.canRollback}
              title={rollback && !a.canRollback ? 'Rollback not available for this action' : undefined}
              leftIcon={rollback ? <RotateCcw className="h-3.5 w-3.5" /> : undefined}
              onClick={() => act(`${label} — ${a.id}`)}
            >
              {label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

/* ══════════════════════════════════ Incidents ══════════════════════════════════ */

const SEV_TONE = { Critical: 'danger', Major: 'warn', Minor: 'accent' }

function IncidentCenter({ act }) {
  const { INCIDENTS, SUBSCRIPTION_CHANNELS, SUBSCRIPTION_SCOPES } = useData()
  return (
    <Panel
      title="Incident Center"
      description="Live incidents and subscription management"
      icon={AlertTriangle}
      actions={<Button variant="outline" size="xs" onClick={() => act('Open subscription center')}>Subscribe</Button>}
    >
      <div className="space-y-3">
        {INCIDENTS.map((i) => <IncidentCard key={i.id} i={i} act={act} />)}
      </div>
      <div className="mt-4 border-t border-[var(--c-line)] pt-3">
        <SectionLabel>Subscription channels</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {SUBSCRIPTION_CHANNELS.map((c) => <Badge key={c} tone="neutral" size="md">{c}</Badge>)}
          <span aria-hidden className="mx-1 h-5 w-px bg-[var(--c-line-strong)]" />
          {SUBSCRIPTION_SCOPES.map((c) => <Badge key={c} tone="accent" size="md">{c}</Badge>)}
        </div>
      </div>
    </Panel>
  )
}

export function IncidentCard({ i, act }) {
  const { INCIDENT_LIFECYCLE } = useData()
  const stageIdx = INCIDENT_LIFECYCLE.indexOf(i.stage)
  return (
    <div className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-semibold text-[var(--c-fg)]">{i.id}</span>
          <Badge tone={SEV_TONE[i.severity]} size="sm">{i.severity}</Badge>
          {i.affectsYou && <Badge tone="warn" size="sm">Affects you</Badge>}
        </div>
        <span className="text-[12px] text-[var(--c-fg-muted)]">Next update {i.nextUpdate}</span>
      </div>
      <div className="mt-1 text-[13px] font-medium text-[var(--c-fg)]">{i.component} · {i.region}</div>
      {/* Lifecycle */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {INCIDENT_LIFECYCLE.map((stage, idx) => (
          <span key={stage} className={cn(
            'rounded-full px-2 py-0.5 text-[10.5px] font-medium',
            idx < stageIdx ? 'bg-[var(--c-success-soft)] text-[var(--c-success)]'
              : idx === stageIdx ? 'bg-[var(--c-accent)] text-white'
              : 'bg-[var(--c-bg-3)] text-[var(--c-fg-muted)]',
          )}>{stage}</span>
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 border-t border-[var(--c-line)] pt-2">
        <KV label="Started" value={i.start} />
        <KV label="Owner" value={i.owner} />
      </dl>
      <div className="mt-2 rounded-lg bg-[var(--c-warn-soft)] p-2.5 text-[12px] text-[var(--c-fg-dim)]">
        <span className="font-semibold text-[var(--c-warn)]">Workaround:</span> {i.workaround}
      </div>
      <Button variant="ghost" size="xs" className="mt-2" onClick={() => act(`View incident ${i.id}`)}>View incident</Button>
    </div>
  )
}

/* ══════════════════════════════════ Zone 3 — resources ══════════════════════════════════ */

function ComplianceSection({ act }) {
  const { COMPLIANCE_PATHS } = useData()
  return (
    <Panel title="Compliance Support Paths" description="Structured intake for legal, privacy, and regulatory requests" icon={Shield}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {COMPLIANCE_PATHS.map((p) => <ComplianceCard key={p.key} p={p} act={act} />)}
      </div>
    </Panel>
  )
}

export function ComplianceCard({ p, act }) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-4">
      <div className="text-[13.5px] font-semibold text-[var(--c-fg)]">{p.title}</div>
      <dl className="mt-2 flex-1">
        <KV label="Owner" value={p.owner} />
        <KV label="SLA" value={p.sla} strong />
      </dl>
      <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--c-fg-muted)]"><span className="font-medium text-[var(--c-fg-dim)]">Required:</span> {p.required}</p>
      <Button variant="outline" size="xs" className="mt-3" disabled={!can(act.role, 'compliance')} onClick={() => act.openCase({ requestType: p.title }, 'security')}>Start request</Button>
    </div>
  )
}

function ResourcesSection({ act }) {
  const { TRUST_CENTER, RESOURCES } = useData()
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Trust center spans wider */}
      <Panel title="Trust Center" description="Certifications, residency, and subprocessors" icon={ShieldCheck} className="lg:col-span-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {TRUST_CENTER.certifications.map((c) => (
            <div key={c.label} className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3 text-center">
              <ShieldCheck className="mx-auto h-5 w-5 text-[var(--c-success)]" />
              <div className="mt-1.5 text-[12.5px] font-semibold text-[var(--c-fg)]">{c.label}</div>
              <div className="text-[11px] text-[var(--c-fg-muted)]">{c.status}</div>
            </div>
          ))}
        </div>
        <a href={TRUST_CENTER.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--c-accent)] hover:underline">
          Open Trust Center <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </Panel>

      {RESOURCES.map((r) => <ResourceCard key={r.key} r={r} act={act} />)}
    </div>
  )
}

export function ResourceCard({ r, act }) {
  return (
    <Card className="flex flex-col p-5" fill interactive>
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)]"><FileText className="h-[17px] w-[17px]" /></span>
        <h3 className="text-[13.5px] font-semibold tracking-tight">{r.title}</h3>
      </div>
      <p className="flex-1 text-[12.5px] text-[var(--c-fg-muted)]">{r.desc}</p>
      <Button variant="ghost" size="xs" className="mt-3 self-start" rightIcon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={() => act(r.cta)}>{r.cta}</Button>
    </Card>
  )
}

/* ══════════════════════════════════ Secure bundle modal ══════════════════════════════════ */

function SecureBundleModal({ open, onClose, act }) {
  const { BUNDLE } = useData()
  const [consent, setConsent] = useState(false)
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Secure Support Bundle"
      description="Zoiko Support receives metadata only. Meeting content stays private."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="outline" size="sm" onClick={() => act('Preview support bundle')}>Preview bundle</Button>
          <Button variant="primary" size="sm" disabled={!consent} leftIcon={<Send className="h-4 w-4" />} onClick={() => { act('Sent support bundle with consent'); onClose() }}>Send with consent</Button>
        </>
      }
    >
      <div className="space-y-4">
        <BundleGroup title="Included" tone="success" items={BUNDLE.included} />

        <div className="rounded-xl border border-[color-mix(in_srgb,var(--c-accent)_25%,var(--c-line))] bg-[var(--c-accent-soft)] p-3">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-[var(--c-accent)]">
            <Lock className="h-4 w-4" /> Confidential Mode — excluded
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BUNDLE.confidentialExcluded.map((x) => (
              <span key={x} className="inline-flex items-center gap-1 rounded-full border border-[var(--c-line)] bg-[var(--c-surface)] px-2 py-0.5 text-[11.5px] text-[var(--c-fg-muted)]">
                <Lock className="h-3 w-3" /> {x}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-[var(--c-fg-dim)]">Zoiko Support cannot access meeting content.</p>
        </div>

        <BundleGroup title="Requires your consent" tone="warn" items={BUNDLE.requiresConsent} />
        <BundleGroup title="Never included" tone="danger" items={BUNDLE.neverIncluded} />

        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[var(--c-accent)]" />
          <span className="text-[12.5px] text-[var(--c-fg-dim)]">I consent to sharing the items above with Zoiko Support. Nothing is uploaded until I send.</span>
        </label>
      </div>
    </Modal>
  )
}

function BundleGroup({ title, tone, items }) {
  return (
    <div>
      <SectionLabel><span className={TONE_TEXT[tone]}>{title}</span></SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {items.map((x) => (
          <span key={x} className={cn('rounded-full border px-2 py-0.5 text-[11.5px]', 'border-[var(--c-line)] bg-[var(--c-bg-2)] text-[var(--c-fg-dim)]')}>{x}</span>
        ))}
      </div>
    </div>
  )
}

/* ══════════════════════════════════ New case modal ══════════════════════════════════ */

// Honors the request type the opener asked for (e.g. a compliance path opens
// the security form). Remounted via `key` on each open so `type` re-inits.
function NewCaseModal({ open, onClose, act, prefill, formKey }) {
  const { CASE_FORMS } = useData()
  const [type, setType] = useState(formKey || 'enterprise')
  const form = CASE_FORMS[type] || CASE_FORMS.enterprise

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Support Case"
      description="Fields adapt to the request type. Diagnostics attach with your consent only."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" leftIcon={<Send className="h-4 w-4" />} onClick={() => { act(`Opened ${form.label}`, 'newCase'); onClose() }}>Create case</Button>
        </>
      }
    >
      <div className="mb-4">
        <SectionLabel>Request type</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CASE_FORMS).map(([key, f]) => (
            <button
              key={key}
              onClick={() => setType(key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                key === type ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-accent)]' : 'border-[var(--c-line)] text-[var(--c-fg-dim)] hover:bg-[var(--c-bg-3)]',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {form.fields.map((f) => <Field key={f.name} f={f} prefill={prefill} />)}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[11.5px] text-[var(--c-fg-muted)]">
        <Lock className="h-3.5 w-3.5" /> Confidential Mode content is never attached. Diagnostics are metadata only.
      </p>
    </Modal>
  )
}

function Field({ f, prefill }) {
  const wide = f.type === 'textarea' || f.name === 'summary'
  const val = prefill?.[f.name]
  const base = 'w-full rounded-lg border border-[var(--c-line)] bg-[var(--c-surface)] px-3 py-2 text-[13px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)] focus:ring-2 focus:ring-[var(--c-accent-ring)]'
  return (
    <label className={cn('block', wide && 'sm:col-span-2')}>
      <span className="mb-1 block text-[12px] font-medium text-[var(--c-fg-dim)]">
        {f.label}{f.required && <span className="text-[var(--c-danger)]"> *</span>}
      </span>
      {f.type === 'textarea' ? (
        <textarea rows={2} defaultValue={val} className={cn(base, 'resize-y')} />
      ) : f.type === 'select' ? (
        <select defaultValue={val || ''} className={base}>
          <option value="" disabled>Select…</option>
          {f.options.map((o) => <option key={o} value={o} className="bg-[var(--c-surface)]">{o}</option>)}
        </select>
      ) : f.type === 'consent' ? (
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3 py-2 text-[12.5px] text-[var(--c-fg-dim)]">
          <input type="checkbox" className="accent-[var(--c-accent)]" /> Attach diagnostic bundle (metadata only)
        </label>
      ) : (
        <input type={f.type === 'file' ? 'file' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} defaultValue={f.type === 'file' ? undefined : val} className={base} />
      )}
    </label>
  )
}

/* ══════════════════════════════════ page ══════════════════════════════════ */

function PageMessage({ children }) {
  return <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">{children}</div>
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
    <SupportDataContext.Provider value={data}>
      <SupportPage data={data} />
    </SupportDataContext.Provider>
  )
}

function SupportPage({ data }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [bundleOpen, setBundleOpen] = useState(false)
  const [caseModal, setCaseModal] = useState(null) // { prefill, formKey } | null

  const role = normalizeRole(data.role || user?.role)
  const actor = user?.email || user?.name || 'unknown'

  /* Single entry point for every action button. Mutating actions pass a
   * capability and get gated + audited; read-only ones omit it. `act.role`
   * lets child components check permissions without threading props. */
  const act = useMemo(() => {
    const fn = (label, cap) => {
      if (cap && !can(role, cap)) {
        toast({ variant: 'warning', title: 'Not permitted', description: `Your role (${role}) can’t: ${label}.` })
        return
      }
      if (cap) recordAudit({ action: label, actor, role })
      toast({ variant: 'success', title: label, description: 'Recorded — demo action (no backend yet).' })
    }
    fn.role = role
    fn.openCase = (prefill = null, formKey = null) => {
      if (!can(role, 'newCase')) {
        toast({ variant: 'warning', title: 'Not permitted', description: `Your role (${role}) can’t open cases.` })
        return
      }
      setCaseModal({ prefill, formKey })
    }
    return fn
  }, [role, actor, toast])

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      {/* Zone 1 */}
      <SupportHeader act={act} />
      <StatusBand act={act} />
      <AccountTeam act={act} />

      {/* Zone 2 */}
      <AITriage act={act} />
      <div className="grid gap-5 lg:grid-cols-2">
        <SupportCases act={act} />
        <DiagnosticsPanel act={act} onBundle={() => setBundleOpen(true)} />
      </div>
      <AgenticReview act={act} />
      <IncidentCenter act={act} />

      {/* Zone 3 */}
      <ComplianceSection act={act} />
      <ResourcesSection act={act} />

      <SecureBundleModal open={bundleOpen} onClose={() => setBundleOpen(false)} act={act} />
      <NewCaseModal
        key={caseModal ? caseModal.formKey || 'enterprise' : 'closed'}
        open={!!caseModal}
        onClose={() => setCaseModal(null)}
        act={act}
        prefill={caseModal?.prefill}
        formKey={caseModal?.formKey}
      />
    </div>
  )
}
