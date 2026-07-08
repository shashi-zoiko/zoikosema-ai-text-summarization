import { useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowUpRight, BadgeCheck, Bell, Building2, CalendarClock,
  CheckCircle2, ChevronDown, CreditCard, Download, FileText, Gauge, Info,
  Landmark, Lock, Receipt, Search, Shield, ShieldCheck, Sparkles,
  Users, Wallet,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/ui/Toast'
import { Card } from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { cn } from '../lib/cn'
import {
  ACCOUNTING_EXPORTS, ADDONS, AGENTIC_ACTIONS, BILLING_ENTITY, BILLING_INFO,
  COST_BREAKDOWN, CURRENT_HEALTH, HEALTH_STATES, INVOICE_CURRENCIES,
  INVOICE_ENTITIES, INVOICE_STATUSES, INVOICES, NEXT_INVOICE, NOTIFICATIONS,
  PAYMENT_METHODS, PLAN, RECENT_ACTIVITY, SPEND_CONTROLS, SUPPORT_ENTERPRISE,
  SUPPORT_SMB, TRUST_POSTURE, USAGE, USD_RATES, WORKFORCE, can, money,
  normalizeRole, recordAudit,
} from '../features/billing/billingData'

/* ══════════════════════════════════ primitives ══════════════════════════════════ */

const TONE_TEXT = {
  success: 'text-[var(--c-success)]',
  accent: 'text-[var(--c-accent)]',
  warn: 'text-[var(--c-warn)]',
  danger: 'text-[var(--c-danger)]',
  neutral: 'text-[var(--c-fg-dim)]',
}
const TONE_SOFT = {
  success: 'bg-[var(--c-success-soft)] text-[var(--c-success)]',
  accent: 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]',
  warn: 'bg-[var(--c-warn-soft)] text-[var(--c-warn)]',
  danger: 'bg-[var(--c-danger-soft)] text-[var(--c-danger)]',
  neutral: 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)]',
}

/* A titled surface built on the shared Card so it inherits the dashboard's
 * radius / shadow / border language. */
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

/* Label / value row used across every card and section. */
function KV({ label, value, mono, strong, className }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', className)}>
      <dt className="shrink-0 text-[12.5px] text-[var(--c-fg-muted)]">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-[13px] text-[var(--c-fg)]', mono && 'font-mono tabular-nums', strong && 'font-semibold')}>
        {value}
      </dd>
    </div>
  )
}

function SectionLabel({ children }) {
  return <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--c-fg-muted)]">{children}</div>
}

/* ══════════════════════════════════ header + banner ══════════════════════════════════ */

function BillingHeader({ act }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Billing</h1>
        <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">Manage your plan, payments, and commercial terms</p>
        <p className="mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--c-fg-muted)]">
          <Building2 className="h-3.5 w-3.5" />
          Billed by <span className="font-medium text-[var(--c-fg-dim)]">{BILLING_ENTITY.billedBy}</span>
          <span aria-hidden className="h-1 w-1 rounded-full bg-[var(--c-line-strong)]" />
          Managed under <span className="font-medium text-[var(--c-fg-dim)]">{BILLING_ENTITY.managedUnder}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => act('Contact CSM')}>Contact CSM</Button>
        <Button variant="primary" size="sm" leftIcon={<ArrowUpRight className="h-4 w-4" />} onClick={() => act('Upgrade plan', 'managePlan')}>Upgrade</Button>
      </div>
    </div>
  )
}

function AccountHealthBanner({ act }) {
  const s = HEALTH_STATES[CURRENT_HEALTH]
  const Icon = { success: CheckCircle2, accent: Info, warn: AlertTriangle, danger: AlertTriangle, neutral: Building2 }[s.tone]
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between',
        'border-[color-mix(in_srgb,currentColor_22%,var(--c-line))]',
        TONE_SOFT[s.tone]
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <div className={cn('text-[14px] font-semibold', TONE_TEXT[s.tone])}>{s.title}</div>
          <div className="mt-0.5 text-[12.5px] text-[var(--c-fg-dim)]">{s.detail}</div>
        </div>
      </div>
      <Button variant="secondary" size="sm" className="shrink-0 self-start sm:self-center" onClick={() => act(s.cta)}>
        {s.cta}
      </Button>
    </div>
  )
}

/* ══════════════════════════════════ summary cards ══════════════════════════════════ */

function CardActions({ children }) {
  return <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--c-line)] pt-3">{children}</div>
}

function SummaryCards({ act }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {/* Plan & Contract */}
      <Card className="p-5" fill>
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)]"><FileText className="h-[17px] w-[17px]" /></span>
          <h3 className="text-[13.5px] font-semibold tracking-tight">Plan &amp; Contract</h3>
        </div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[18px] font-bold tracking-tight">{PLAN.name}</span>
          <Badge tone="accent" size="sm">{PLAN.billing}</Badge>
        </div>
        <dl className="mt-2">
          <KV label="Seats" value={`${PLAN.seats} seats`} />
          <KV label="Price / seat" value={money(PLAN.pricePerSeat)} />
          <KV label="Contract start" value={PLAN.contractStart} />
          <KV label="Contract end" value={PLAN.contractEnd} />
          <KV label="Renewal window" value={PLAN.renewalWindow} />
          <KV label="Auto renew" value={PLAN.autoRenew ? 'On' : 'Off'} strong />
          <KV label="MSA" value={PLAN.msaRef} mono />
          <KV label="SOW" value={PLAN.sowRef} mono />
        </dl>
        <CardActions>
          <Button variant="outline" size="xs" disabled={!can(act.role, 'managePlan')} onClick={() => act('Change plan', 'managePlan')}>Change plan</Button>
          <Button variant="outline" size="xs" disabled={!can(act.role, 'manageSeats')} onClick={() => act('Manage seats', 'manageSeats')}>Manage seats</Button>
          <Button variant="ghost" size="xs" onClick={() => act('View contract')}>View contract</Button>
        </CardActions>
      </Card>

      {/* Next Invoice — kept prominent (stays visible on mobile per spec) */}
      <Card className="p-5" fill glow>
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)]"><Receipt className="h-[17px] w-[17px]" /></span>
          <h3 className="text-[13.5px] font-semibold tracking-tight">Next Invoice</h3>
        </div>
        <div className="mb-1 text-[24px] font-bold tracking-tight tabular-nums">{money(NEXT_INVOICE.amount, NEXT_INVOICE.currency)}</div>
        <div className="text-[12px] text-[var(--c-fg-muted)]">Due {NEXT_INVOICE.date}</div>
        <dl className="mt-2">
          <KV label="Billing period" value={NEXT_INVOICE.period} />
          <KV label="Currency" value={NEXT_INVOICE.currency} />
          <KV label="Payment method" value={NEXT_INVOICE.paymentMethod} />
          <KV label="Tax estimate" value={money(NEXT_INVOICE.taxEstimate)} />
          <KV label="Credit balance" value={money(NEXT_INVOICE.creditBalance)} strong />
        </dl>
        <CardActions>
          <Button variant="outline" size="xs" onClick={() => act('Preview invoice')}>Preview</Button>
          <Button variant="ghost" size="xs" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => act('Download latest invoice')}>Latest</Button>
          <Button variant="ghost" size="xs" disabled={!can(act.role, 'managePayment')} onClick={() => act('Update payment', 'managePayment')}>Update payment</Button>
        </CardActions>
      </Card>

      {/* Usage This Cycle */}
      <Card className="p-5" fill>
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)]"><Gauge className="h-[17px] w-[17px]" /></span>
          <h3 className="text-[13.5px] font-semibold tracking-tight">Usage This Cycle</h3>
        </div>
        <dl className="mt-1">
          <KV label="Active seats" value={`${USAGE.activeSeats} / ${PLAN.seats}`} strong />
          <KV label="AI summaries" value={USAGE.aiSummaries.toLocaleString()} />
          <KV label="Agentic actions" value={USAGE.agenticActions.toLocaleString()} />
          <KV label="Agentic spend" value={money(USAGE.agenticSpend)} />
          <KV label="Storage" value={`${USAGE.storageUsedGb} / ${USAGE.storageQuotaGb} GB`} />
          <KV label="Confidential mode" value={`${USAGE.confidentialModePct}%`} />
          <KV label="Calling minutes" value={USAGE.callingMinutes.toLocaleString()} />
        </dl>
        <CardActions>
          <Button variant="outline" size="xs" onClick={() => act('View action log')}>Action log</Button>
          <Button variant="ghost" size="xs" disabled={!can(act.role, 'setCap')} onClick={() => act('Set spend cap', 'setCap')}>Set spend cap</Button>
        </CardActions>
      </Card>

      {/* Workforce Truth (ZoikoTime) */}
      <Card className="p-5" fill>
        <div className="mb-3 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)]"><Users className="h-[17px] w-[17px]" /></span>
          <h3 className="text-[13.5px] font-semibold tracking-tight">Workforce Truth</h3>
        </div>
        <p className="mb-3 text-[11.5px] text-[var(--c-fg-muted)]">Seat reality from ZoikoTime</p>
        <div className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[22px] font-bold tabular-nums leading-none">{WORKFORCE.verifiedUsers}<span className="text-[14px] text-[var(--c-fg-muted)]"> / {WORKFORCE.paidSeats}</span></div>
              <div className="mt-1 text-[11.5px] text-[var(--c-fg-muted)]">Verified active users</div>
            </div>
            <Badge tone={WORKFORCE.lowUsageSeats > 0 ? 'warn' : 'success'} size="sm">{WORKFORCE.lowUsageSeats} low-usage</Badge>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--c-bg-3)]">
            <div className="h-full rounded-full bg-[var(--c-accent)]" style={{ width: `${(WORKFORCE.verifiedUsers / WORKFORCE.paidSeats) * 100}%` }} />
          </div>
          <dl>
            <KV label="Paid seats" value={WORKFORCE.paidSeats} />
            <KV label="Verified" value={`${WORKFORCE.verifiedUsers} / ${WORKFORCE.paidSeats}`} />
            <KV label="Low-usage seats" value={WORKFORCE.lowUsageSeats} />
          </dl>
        </div>
        <CardActions>
          <Button variant="outline" size="xs" onClick={() => act('Open workforce report')}>Open workforce report</Button>
        </CardActions>
      </Card>
    </div>
  )
}

/* ══════════════════════════════════ tabs ══════════════════════════════════ */

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'settings', label: 'Settings' },
]

function Tabs({ value, onChange }) {
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.id === value)
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length
    onChange(TABS[next].id)
  }
  return (
    <div role="tablist" aria-label="Billing sections" onKeyDown={onKeyDown} className="flex gap-1 border-b border-[var(--c-line)]">
      {TABS.map((t) => {
        const active = value === t.id
        return (
          <button
            key={t.id}
            role="tab"
            id={`bt-${t.id}`}
            aria-selected={active}
            aria-controls={`bp-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2.5 text-[13.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--c-accent-ring)]',
              active ? 'border-[var(--c-accent)] text-[var(--c-fg)]' : 'border-transparent text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]'
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/* ══════════════════════════════════ Overview tab ══════════════════════════════════ */

function OverviewTab({ act }) {
  const cb = COST_BREAKDOWN
  return (
    <div className="space-y-4">
      {/* Commercial anchor */}
      <Panel title="Commercial Anchor" description="The contractual truth behind this account" icon={Landmark}>
        <dl className="grid gap-x-8 sm:grid-cols-2">
          <KV label="Plan" value={`${PLAN.name} · ${PLAN.billing}`} strong />
          <KV label="Contract term" value={`${PLAN.contractStart} → ${PLAN.contractEnd}`} />
          <KV label="MSA reference" value={PLAN.msaRef} mono />
          <KV label="SOW reference" value={PLAN.sowRef} mono />
          <KV label="Renewal date" value={PLAN.contractEnd} />
          <KV label="Billing entity" value={BILLING_ENTITY.billedBy} />
          <KV label="Auto renewal" value={PLAN.autoRenew ? `On · window ${PLAN.renewalWindow}` : 'Off'} />
          <KV label="Managed under" value={BILLING_ENTITY.managedUnder} />
        </dl>
      </Panel>

      {/* Cost breakdown */}
      <Panel title="Cost Breakdown" description="This billing cycle" icon={Wallet}>
        <dl>
          {cb.lines.map((l) => <KV key={l.label} label={l.label} value={money(l.amount)} />)}
          <div className="my-2 h-px bg-[var(--c-line)]" />
          <SectionLabel>Taxes by jurisdiction</SectionLabel>
          {cb.taxes.map((t) => <KV key={t.jurisdiction} label={t.jurisdiction} value={money(t.amount)} />)}
          <div className="my-2 h-px bg-[var(--c-line)]" />
          <KV label="Discounts" value={money(cb.discounts)} className="text-[var(--c-success)]" />
          <KV label="Credits" value={money(cb.credits)} className="text-[var(--c-success)]" />
          <div className="my-2 h-px bg-[var(--c-line-strong)]" />
          <div className="flex items-baseline justify-between py-1">
            <dt className="text-[13px] font-semibold">Total amount</dt>
            <dd className="text-[18px] font-bold tabular-nums">{money(cb.total)}</dd>
          </div>
        </dl>
      </Panel>

      {/* Agentic action meter */}
      <Panel
        title="Agentic Action Meter"
        description="Metered autonomous actions · immutable audit log available"
        icon={Sparkles}
        actions={
          <>
            <Button variant="outline" size="xs" disabled={!can(act.role, 'setCap')} onClick={() => act('Set spend cap', 'setCap')}>Set spend cap</Button>
            <Button variant="ghost" size="xs" disabled={!can(act.role, 'export')} leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => act('Export agentic meter', 'export')}>Export</Button>
            <Button variant="ghost" size="xs" onClick={() => act('View audit')}>View audit</Button>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--c-line)] text-[11px] uppercase tracking-wide text-[var(--c-fg-muted)]">
                <th scope="col" className="py-2 pr-4 font-semibold">Action category</th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">Count</th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">Cost</th>
                <th scope="col" className="py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {AGENTIC_ACTIONS.rows.map((r) => (
                <tr key={r.category} className="border-b border-[var(--c-line)] last:border-0">
                  <td className="py-2.5 pr-4">
                    <span className="flex items-center gap-2">
                      {r.category}
                      <span title="Immutable audit log available" className="text-[var(--c-fg-muted)]"><Lock className="h-3.5 w-3.5" /></span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{r.count.toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{money(r.cost)}</td>
                  <td className="py-2.5 text-right">
                    <Button variant="ghost" size="xs" onClick={() => act(`View audit — ${r.category}`)}>Audit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2.5 pr-4">Total</td>
                <td className="py-2.5 pr-4 text-right tabular-nums">{AGENTIC_ACTIONS.totalCount.toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums">{money(AGENTIC_ACTIONS.totalCost)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>

      {/* Add-ons */}
      <Panel title="Add-ons" description="Extend the platform for enterprise needs" icon={BadgeCheck}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ADDONS.map((a) => (
            <div key={a.name} className="flex flex-col justify-between rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-semibold">{a.name}</span>
                  <Badge tone={a.status === 'active' ? 'success' : 'neutral'} size="sm">{a.status === 'active' ? 'Active' : 'Available'}</Badge>
                </div>
                <p className="mt-1 text-[12px] text-[var(--c-fg-muted)]">{a.note}</p>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[13px] font-medium tabular-nums">{a.price != null ? `${money(a.price)}/mo` : 'Custom'}</span>
                <Button variant="ghost" size="xs" disabled={!can(act.role, 'managePlan')} onClick={() => act(`${a.status === 'active' ? 'Manage' : 'Add'} add-on — ${a.name}`, 'managePlan')}>
                  {a.status === 'active' ? 'Manage' : 'Add'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {/* Recent activity + Trust posture */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent Activity" description="Invoices, payments, credits, refunds, plan changes" icon={CalendarClock}>
          <ol className="relative space-y-4 pl-5">
            <span aria-hidden className="absolute left-[5px] top-1 bottom-1 w-px bg-[var(--c-line)]" />
            {RECENT_ACTIVITY.map((e, i) => (
              <li key={i} className="relative">
                <span aria-hidden className={cn('absolute -left-5 top-1 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--c-surface)]', {
                  invoice: 'bg-[var(--c-accent)]', payment: 'bg-[var(--c-success)]', credit: 'bg-[var(--c-warn)]', refund: 'bg-[var(--c-danger)]', plan: 'bg-[var(--c-fg-muted)]',
                }[e.type])} />
                <div className="text-[13px] text-[var(--c-fg)]">{e.text}</div>
                <div className="text-[11.5px] text-[var(--c-fg-muted)]">{e.date}</div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Trust Posture" description="Payment security & data residency" icon={ShieldCheck}>
          <dl>
            <KV label="PCI DSS status" value={<span className="inline-flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-[var(--c-success)]" />{TRUST_POSTURE.pciStatus}</span>} />
            <KV label="Tokenization" value={TRUST_POSTURE.tokenization} strong />
            <KV label="Billing data residency" value={TRUST_POSTURE.dataResidency} />
          </dl>
          <a href={TRUST_POSTURE.trustCenter} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--c-accent)] hover:underline">
            Open Trust Center <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </Panel>
      </div>
    </div>
  )
}

/* ══════════════════════════════════ Invoices tab ══════════════════════════════════ */

const STATUS_TONE = { paid: 'success', overdue: 'danger', refunded: 'warn', draft: 'neutral' }

function InvoicesTab({ act }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [currency, setCurrency] = useState('all')
  const [entity, setEntity] = useState('all')
  const [usd, setUsd] = useState(false) // multi-currency: show USD equivalent

  const rows = useMemo(() => INVOICES.filter((inv) => {
    if (status !== 'all' && inv.status !== status) return false
    if (currency !== 'all' && inv.currency !== currency) return false
    if (entity !== 'all' && inv.entity !== entity) return false
    if (query && !inv.number.toLowerCase().includes(query.toLowerCase()) && !(inv.po || '').toLowerCase().includes(query.toLowerCase())) return false
    return true
  }), [query, status, currency, entity])

  const shown = (inv) => usd ? { amount: inv.amount * (USD_RATES[inv.currency] ?? 1), tax: inv.tax * (USD_RATES[inv.currency] ?? 1), cur: 'USD' } : { amount: inv.amount, tax: inv.tax, cur: inv.currency }

  return (
    <div className="space-y-4">
      <Panel icon={FileText} title="Invoices" description="Search, filter, and export your invoice history"
        actions={
          <>
            <Button variant="outline" size="xs" disabled={!can(act.role, 'export')} leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => act('Export invoices CSV', 'export')}>Export CSV</Button>
            <Button variant="outline" size="xs" disabled={!can(act.role, 'export')} leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => act('Export invoices PDF', 'export')}>Export PDF</Button>
            <ExportMenu act={act} />
          </>
        }
      >
        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-[var(--c-line)] bg-[var(--c-surface)] px-3 focus-within:border-[var(--c-accent)]">
            <Search className="h-4 w-4 text-[var(--c-fg-muted)]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search invoice # or PO" aria-label="Search invoices" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-[var(--c-fg-muted)]" />
          </label>
          <Select label="Status" value={status} onChange={setStatus} options={INVOICE_STATUSES} />
          <Select label="Currency" value={currency} onChange={setCurrency} options={INVOICE_CURRENCIES} />
          <Select label="Entity" value={entity} onChange={setEntity} options={INVOICE_ENTITIES} />
          <label className="ml-auto flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-[var(--c-line)] bg-[var(--c-surface)] px-3 text-[12.5px] text-[var(--c-fg-dim)]">
            <input type="checkbox" checked={usd} onChange={(e) => setUsd(e.target.checked)} className="accent-[var(--c-accent)]" />
            USD equivalent
          </label>
        </div>

        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--c-line)] text-[11px] uppercase tracking-wide text-[var(--c-fg-muted)]">
                    {['Invoice #', 'Date', 'Period', 'Amount', 'Tax', 'Status', 'Paid', 'Entity', 'PO', 'Actions'].map((h) => (
                      <th key={h} scope="col" className="whitespace-nowrap py-2 pr-4 font-semibold last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((inv) => {
                    const v = shown(inv)
                    return (
                      <tr key={inv.number} className="border-b border-[var(--c-line)] last:border-0">
                        <td className="whitespace-nowrap py-2.5 pr-4 font-medium">
                          {inv.number}
                          {inv.hasCredit && <Badge tone="warn" size="sm" className="ml-2">Credit note</Badge>}
                        </td>
                        <td className="whitespace-nowrap py-2.5 pr-4 text-[var(--c-fg-dim)]">{inv.date}</td>
                        <td className="whitespace-nowrap py-2.5 pr-4 text-[var(--c-fg-dim)]">{inv.period}</td>
                        <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums">{money(v.amount, v.cur)}</td>
                        <td className="whitespace-nowrap py-2.5 pr-4 tabular-nums text-[var(--c-fg-dim)]">{money(v.tax, v.cur)}</td>
                        <td className="py-2.5 pr-4"><Badge tone={STATUS_TONE[inv.status]} size="sm" className="capitalize">{inv.status}</Badge></td>
                        <td className="whitespace-nowrap py-2.5 pr-4 text-[var(--c-fg-dim)]">{inv.paymentDate || '—'}</td>
                        <td className="whitespace-nowrap py-2.5 pr-4 text-[var(--c-fg-dim)]">{inv.entity}</td>
                        <td className="whitespace-nowrap py-2.5 pr-4 font-mono text-[12px] text-[var(--c-fg-dim)]">{inv.po}</td>
                        <td className="py-2.5"><InvoiceActions inv={inv} act={act} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: expandable cards */}
            <ul className="space-y-3 md:hidden">
              {rows.map((inv) => {
                const v = shown(inv)
                return (
                  <li key={inv.number}>
                    <details className="group rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3 [&_summary::-webkit-details-marker]:hidden">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{inv.number}</span>
                          <span className="block text-[12px] text-[var(--c-fg-muted)]">{inv.date} · {money(v.amount, v.cur)}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <Badge tone={STATUS_TONE[inv.status]} size="sm" className="capitalize">{inv.status}</Badge>
                          <ChevronDown className="h-4 w-4 text-[var(--c-fg-muted)] transition-transform group-open:rotate-180" />
                        </span>
                      </summary>
                      <dl className="mt-3 border-t border-[var(--c-line)] pt-3">
                        <KV label="Period" value={inv.period} />
                        <KV label="Tax" value={money(v.tax, v.cur)} />
                        <KV label="Paid" value={inv.paymentDate || '—'} />
                        <KV label="Entity" value={inv.entity} />
                        <KV label="PO" value={inv.po} mono />
                        {inv.hasCredit && <KV label="Credit note" value="Linked" />}
                      </dl>
                      <div className="mt-2"><InvoiceActions inv={inv} act={act} /></div>
                    </details>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Panel>
    </div>
  )
}

function InvoiceActions({ inv, act }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="xs" onClick={() => act(`View ${inv.number}`)}>View</Button>
      <Button variant="ghost" size="xs" disabled={!can(act.role, 'export')} onClick={() => act(`Download PDF ${inv.number}`, 'export')}>PDF</Button>
      <Button variant="ghost" size="xs" disabled={!can(act.role, 'export')} onClick={() => act(`Download CSV ${inv.number}`, 'export')}>CSV</Button>
      <Button variant="ghost" size="xs" onClick={() => act(`Receipt ${inv.number}`)}>Receipt</Button>
      {inv.status === 'overdue' && <Button variant="outline" size="xs" disabled={!can(act.role, 'managePayment')} onClick={() => act(`Retry payment ${inv.number}`, 'managePayment')}>Retry</Button>}
      <Button variant="ghost" size="xs" onClick={() => act(`Dispute ${inv.number}`)}>Dispute</Button>
    </div>
  )
}

function ExportMenu({ act }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button variant="ghost" size="xs" rightIcon={<ChevronDown className="h-3.5 w-3.5" />} aria-haspopup="menu" aria-expanded={open} disabled={!can(act.role, 'export')} onClick={() => setOpen((v) => !v)}>
        Accounting
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 z-50 mt-1 w-56 rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-surface)] p-1.5 shadow-xl">
            {ACCOUNTING_EXPORTS.map((x) => (
              <button key={x} role="menuitem" onClick={() => { setOpen(false); act(`Export to ${x}`, 'export') }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[var(--c-fg-dim)] transition hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)]">
                <Download className="h-4 w-4" /> {x}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 text-[12.5px] text-[var(--c-fg-dim)] focus-within:border-[var(--c-accent)]">
      <span className="text-[var(--c-fg-muted)]">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="border-0 bg-transparent text-[12.5px] font-medium text-[var(--c-fg)] outline-none">
        {options.map((o) => <option key={o} value={o} className="bg-[var(--c-surface)] capitalize">{o === 'all' ? `All ${label.toLowerCase()}` : o}</option>)}
      </select>
    </label>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--c-line-strong)] py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--c-bg-3)] text-[var(--c-fg-muted)]"><Receipt className="h-6 w-6" /></span>
      <p className="text-[14px] font-medium text-[var(--c-fg)]">No invoices yet</p>
      <p className="max-w-xs text-[12.5px] text-[var(--c-fg-muted)]">Invoice history will appear once billing begins.</p>
    </div>
  )
}

/* ══════════════════════════════════ Settings tab ══════════════════════════════════ */

function SettingsTab({ act }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Payment methods */}
      <Panel title="Payment Methods" description="Cards, ACH / wire, and auto-pay" icon={CreditCard}
        actions={<Button variant="outline" size="xs" disabled={!can(act.role, 'managePayment')} onClick={() => act('Add payment method', 'managePayment')}>Add</Button>}
      >
        <div className="space-y-2">
          <MethodRow method={PAYMENT_METHODS.primary} primary act={act} />
          <MethodRow method={PAYMENT_METHODS.backup} act={act} />
        </div>
        <dl className="mt-3 border-t border-[var(--c-line)] pt-3">
          <KV label="ACH / Wire" value={PAYMENT_METHODS.achWire ? 'Enabled' : 'Off'} />
          <KV label="Invoice payment" value={PAYMENT_METHODS.invoicePayment ? 'Enabled' : 'Off'} />
          <KV label="Auto-pay" value={PAYMENT_METHODS.autoPay ? 'On' : 'Off'} strong />
        </dl>
      </Panel>

      {/* Billing information */}
      <Panel title="Billing Information" description="Legal entity, tax IDs, and PO defaults" icon={Building2}
        actions={
          <>
            <Button variant="outline" size="xs" disabled={!can(act.role, 'editBilling')} onClick={() => act('Edit billing profile', 'editBilling')}>Edit profile</Button>
            <Button variant="ghost" size="xs" disabled={!can(act.role, 'editBilling')} onClick={() => act('Add tax details', 'editBilling')}>Add tax details</Button>
          </>
        }
      >
        <dl>
          <KV label="Legal entity" value={BILLING_INFO.legalEntity} strong />
          <KV label="Billing address" value={BILLING_INFO.address} />
          <KV label="VAT" value={BILLING_INFO.vat} />
          <KV label="GST" value={BILLING_INFO.gst} />
          <KV label="EIN" value={BILLING_INFO.ein} mono />
          <KV label="Tax IDs" value={BILLING_INFO.taxIds} mono />
          <KV label="PO default" value={BILLING_INFO.poDefault} mono />
          <KV label="Cost centers" value={BILLING_INFO.costCenters} />
        </dl>
        <p className="mt-2 text-[11.5px] text-[var(--c-fg-muted)]">Procurement can edit PO &amp; cost centers.</p>
      </Panel>

      {/* Notifications & exports */}
      <Panel title="Notifications &amp; Exports" description="Finance summaries and scheduled exports" icon={Bell}
        actions={
          <>
            <Button variant="outline" size="xs" disabled={!can(act.role, 'configureNotifications')} onClick={() => act('Configure recipients', 'configureNotifications')}>Recipients</Button>
            <Button variant="ghost" size="xs" disabled={!can(act.role, 'export')} onClick={() => act('Schedule exports', 'export')}>Schedule</Button>
          </>
        }
      >
        <dl>
          <KV label="Monthly finance summary" value={NOTIFICATIONS.monthlyFinanceSummary ? 'On' : 'Off'} strong />
          <KV label="Payment failure alerts" value={NOTIFICATIONS.paymentFailureAlerts ? 'On' : 'Off'} />
          <KV label="Renewal alerts" value={NOTIFICATIONS.renewalAlerts ? 'On' : 'Off'} />
          <KV label="Invoice export schedule" value={NOTIFICATIONS.invoiceExportSchedule} />
        </dl>
      </Panel>

      {/* Spend controls */}
      <Panel title="Spend Controls" description="Caps, thresholds, and approvals for agentic spend" icon={Gauge}
        actions={
          <>
            <Button variant="outline" size="xs" disabled={!can(act.role, 'setCap')} onClick={() => act('Set spend cap', 'setCap')}>Set cap</Button>
            <Button variant="ghost" size="xs" disabled={!can(act.role, 'editApprovers')} onClick={() => act('Edit approvers', 'editApprovers')}>Approvers</Button>
            <Button variant="ghost" size="xs" onClick={() => act('View exceptions')}>Exceptions</Button>
          </>
        }
      >
        <dl>
          <KV label="Agentic spend cap" value={`${money(SPEND_CONTROLS.agenticCap)} / mo`} strong />
          <KV label="Threshold alert" value={`${SPEND_CONTROLS.thresholdAlertPct}% of cap`} />
          <KV label="Approval workflow" value={SPEND_CONTROLS.approvalWorkflow} />
        </dl>
      </Panel>
    </div>
  )
}

function MethodRow({ method, primary, act }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--c-bg-3)] text-[var(--c-fg-dim)]"><CreditCard className="h-[18px] w-[18px]" /></span>
        <div>
          <div className="flex items-center gap-2 text-[13px] font-medium">{method.label}{primary && <Badge tone="accent" size="sm">Default</Badge>}</div>
          <div className="text-[11.5px] text-[var(--c-fg-muted)]">{method.detail}</div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!primary && <Button variant="ghost" size="xs" disabled={!can(act.role, 'managePayment')} onClick={() => act('Set default payment method', 'managePayment')}>Set default</Button>}
        <Button variant="ghost" size="xs" disabled={!can(act.role, 'managePayment')} onClick={() => act('Replace payment method', 'managePayment')}>Replace</Button>
        <Button variant="ghost" size="xs" disabled={!can(act.role, 'managePayment')} onClick={() => act('Remove payment method', 'managePayment')}>Remove</Button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════ Support ══════════════════════════════════ */

function SupportSection({ act }) {
  const enterprise = BILLING_ENTITY.accountType === 'enterprise'
  return (
    <Panel title="Support" description={enterprise ? 'Your enterprise billing contacts' : 'Get help with billing'} icon={Info}>
      {enterprise ? (
        <div className="grid gap-x-8 sm:grid-cols-2">
          <dl>
            <KV label="Customer Success Manager" value={SUPPORT_ENTERPRISE.csm} strong />
            <KV label="Billing lead" value={SUPPORT_ENTERPRISE.billingLead} />
            <KV label="Support route" value={SUPPORT_ENTERPRISE.supportRoute} />
            <KV label="Account owner" value={SUPPORT_ENTERPRISE.accountOwner} />
          </dl>
          <dl>
            <KV label="Priority email" value={SUPPORT_ENTERPRISE.priorityEmail} />
            <KV label="Dispute SLA" value={SUPPORT_ENTERPRISE.disputeSla} />
          </dl>
          <div className="mt-3 sm:col-span-2">
            <Button variant="outline" size="sm" leftIcon={<CalendarClock className="h-4 w-4" />} onClick={() => act('Book call with CSM')}>Book a call</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => act('Open live chat')}>Live chat</Button>
          <Button variant="ghost" size="sm" onClick={() => act('Email support')}>Email support</Button>
          <Button variant="ghost" size="sm" onClick={() => act('Open billing FAQ')}>Billing FAQ</Button>
          <Button variant="ghost" size="sm" onClick={() => act('Book a call')}>Book call</Button>
        </div>
      )}
    </Panel>
  )
}

/* ══════════════════════════════════ page ══════════════════════════════════ */

export default function Billing() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [tab, setTab] = useState('overview')

  const role = normalizeRole(user?.role)
  const actor = user?.email || user?.name || 'unknown'

  /* Single entry point for every action button. Read-only actions omit `cap`;
   * mutating ones pass a capability and get gated + audited. `act.role` lets
   * child components check permissions without threading props. */
  const act = useMemo(() => {
    const fn = (label, cap, change) => {
      if (cap && !can(role, cap)) {
        toast({ variant: 'warning', title: 'Not permitted', description: `Your role (${role}) can’t: ${label}.` })
        return
      }
      if (cap) recordAudit({ action: label, actor, role, before: change?.before ?? null, after: change?.after ?? null })
      toast({ variant: 'success', title: label, description: 'Recorded — demo action (no backend yet).' })
    }
    fn.role = role
    return fn
  }, [role, actor, toast])

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      <BillingHeader act={act} />
      <AccountHealthBanner act={act} />
      <SummaryCards act={act} />

      <div className="pt-1">
        <Tabs value={tab} onChange={setTab} />
        <div className="mt-5">
          <div role="tabpanel" id={`bp-${tab}`} aria-labelledby={`bt-${tab}`}>
            {tab === 'overview' && <OverviewTab act={act} />}
            {tab === 'invoices' && <InvoicesTab act={act} />}
            {tab === 'settings' && <SettingsTab act={act} />}
          </div>
        </div>
      </div>

      <SupportSection act={act} />
    </div>
  )
}
