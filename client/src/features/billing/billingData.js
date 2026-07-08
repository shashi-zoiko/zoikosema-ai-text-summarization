/* ─────────────────────────────────────────────────────────────────────────
 * Zoiko Sema — Billing data, permissions, and audit scaffolding.
 *
 * All figures here are dummy JSON matching the Billing Wireframe v1.1. The
 * page reads ONLY from these shapes, so wiring a real backend later means
 * swapping each export for a `/api/billing/*` fetch — nothing in the UI
 * changes. ponytail: no API layer yet; add fetches when the endpoints exist.
 * ──────────────────────────────────────────────────────────────────────── */

export function money(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount ?? 0)
}

/* USD-equivalent rates for the invoices multi-currency toggle (dummy). */
export const USD_RATES = { USD: 1, EUR: 1.08, GBP: 1.27, AED: 0.27 }

export const BILLING_ENTITY = {
  billedBy: 'Zoiko Tech Inc (US)',
  managedUnder: 'Organization MSA',
  accountType: 'enterprise', // enterprise | smb — switches the Support panel
}

/* ── Account health banner ─────────────────────────────────────────────────
 * `CURRENT_HEALTH` selects which state renders. Change it to preview any of the
 * six banner states without touching the component. */
export const CURRENT_HEALTH = 'healthy'
export const HEALTH_STATES = {
  healthy: {
    tone: 'success',
    title: 'Billing active',
    detail: 'Next invoice Sep 1, 2026 · $12,480.00',
    cta: 'Preview invoice',
  },
  trial: {
    tone: 'accent',
    title: 'Trial ends in 12 days',
    detail: 'Add a payment method to keep Sema Business after your trial ends.',
    cta: 'Add payment method',
  },
  payment_attention: {
    tone: 'warn',
    title: 'Card expires Sep 30',
    detail: 'Update your payment method to avoid a failed charge next cycle.',
    cta: 'Update payment',
  },
  overdue: {
    tone: 'danger',
    title: 'Payment failed',
    detail: 'Your last invoice could not be charged. Retry to restore service.',
    cta: 'Retry payment',
  },
  renewal: {
    tone: 'accent',
    title: 'MSA renewal window open',
    detail: 'Your master agreement is up for renewal on Dec 31, 2026.',
    cta: 'Review renewal',
  },
  managed: {
    tone: 'neutral',
    title: 'Managed by your organization',
    detail: 'Billing for this workspace is handled centrally under the Organization MSA.',
    cta: 'Contact billing admin',
  },
}

/* ── Summary cards ─────────────────────────────────────────────────────── */

export const PLAN = {
  name: 'Sema Business',
  billing: 'Annual',
  seats: 42,
  pricePerSeat: 30,
  contractStart: 'Jan 1, 2026',
  contractEnd: 'Dec 31, 2026',
  renewalWindow: 'Oct 1 – Dec 1, 2026',
  autoRenew: true,
  msaRef: 'MSA-2026-0142',
  sowRef: 'SOW-2026-0091',
}

export const NEXT_INVOICE = {
  date: 'Sep 1, 2026',
  amount: 12480,
  period: 'Sep 1 – Sep 30, 2026',
  currency: 'USD',
  paymentMethod: 'Visa •••• 4242',
  taxEstimate: 998.4,
  creditBalance: 250,
}

export const USAGE = {
  activeSeats: 38,
  aiSummaries: 1204,
  agenticActions: 4127,
  agenticSpend: 412.7,
  storageUsedGb: 214,
  storageQuotaGb: 500,
  confidentialModePct: 62,
  callingMinutes: 8640,
}

export const WORKFORCE = {
  paidSeats: 42,
  verifiedUsers: 28,
  lowUsageSeats: 14,
}

/* ── Overview tab ──────────────────────────────────────────────────────── */

export const COST_BREAKDOWN = {
  lines: [
    { label: 'Base subscription', amount: 9000 },
    { label: 'Seat charges (42 × $30)', amount: 1260 },
    { label: 'Add-ons', amount: 640 },
    { label: 'Agentic AI spend', amount: 412.7 },
    { label: 'Storage', amount: 180 },
  ],
  taxes: [
    { jurisdiction: 'US — Federal', amount: 720 },
    { jurisdiction: 'US — CA State', amount: 278.4 },
  ],
  discounts: -500,
  credits: -250,
  get total() {
    const sub = this.lines.reduce((n, l) => n + l.amount, 0)
    const tax = this.taxes.reduce((n, t) => n + t.amount, 0)
    return sub + tax + this.discounts + this.credits
  },
}

export const AGENTIC_ACTIONS = {
  rows: [
    { category: 'Meeting follow-up drafts', count: 1842, cost: 184.2 },
    { category: 'ZoikoTime workflow triggers', count: 967, cost: 96.7 },
    { category: 'Zoiko One operations', count: 618, cost: 61.8 },
    { category: 'CRM update actions', count: 452, cost: 45.2 },
    { category: 'Custom governed actions', count: 248, cost: 24.8 },
  ],
  get totalCount() { return this.rows.reduce((n, r) => n + r.count, 0) },
  get totalCost() { return this.rows.reduce((n, r) => n + r.cost, 0) },
}

export const ADDONS = [
  { name: 'Governed agentic tier', status: 'active', price: 400, note: 'Policy-scoped autonomous actions' },
  { name: 'Additional storage', status: 'active', price: 180, note: '+500 GB pooled' },
  { name: 'Telecom compliance pack', status: 'active', price: 60, note: 'Call recording retention' },
  { name: 'BAA / HIPAA', status: 'available', price: 250, note: 'Signed BAA + audit controls' },
  { name: 'Dedicated deployment', status: 'available', price: null, note: 'Single-tenant region — contact CSM' },
]

export const RECENT_ACTIVITY = [
  { type: 'invoice', date: 'Aug 1, 2026', text: 'Invoice INV-2026-0008 issued — $12,480.00' },
  { type: 'payment', date: 'Aug 1, 2026', text: 'Payment received — Visa •••• 4242' },
  { type: 'credit', date: 'Jul 18, 2026', text: 'Credit note CN-2026-0003 applied — $250.00' },
  { type: 'plan', date: 'Jul 1, 2026', text: 'Seats increased 38 → 42' },
  { type: 'refund', date: 'Jun 22, 2026', text: 'Refund processed — $120.00' },
]

export const TRUST_POSTURE = {
  pciStatus: 'PCI DSS Level 1',
  tokenization: 'Enabled',
  dataResidency: 'United States (us-east)',
  trustCenter: 'https://trust.zoiko.com',
}

/* ── Invoices tab ──────────────────────────────────────────────────────── */

export const INVOICES = [
  { number: 'INV-2026-0008', date: 'Aug 1, 2026', period: 'Aug 2026', amount: 12480, currency: 'USD', tax: 998.4, status: 'paid', paymentDate: 'Aug 1, 2026', entity: 'Zoiko Tech Inc (US)', po: 'PO-4471', hasCredit: true },
  { number: 'INV-2026-0007', date: 'Jul 1, 2026', period: 'Jul 2026', amount: 12480, currency: 'USD', tax: 998.4, status: 'paid', paymentDate: 'Jul 1, 2026', entity: 'Zoiko Tech Inc (US)', po: 'PO-4471', hasCredit: false },
  { number: 'INV-2026-0006', date: 'Jun 1, 2026', period: 'Jun 2026', amount: 11760, currency: 'USD', tax: 940.8, status: 'paid', paymentDate: 'Jun 2, 2026', entity: 'Zoiko Tech Inc (US)', po: 'PO-4471', hasCredit: false },
  { number: 'INV-2026-0005', date: 'May 1, 2026', period: 'May 2026', amount: 11760, currency: 'USD', tax: 940.8, status: 'refunded', paymentDate: 'May 1, 2026', entity: 'Zoiko Tech Inc (US)', po: 'PO-4470', hasCredit: true },
  { number: 'INV-2026-0004', date: 'Apr 1, 2026', period: 'Apr 2026', amount: 11040, currency: 'USD', tax: 883.2, status: 'overdue', paymentDate: null, entity: 'Zoiko Tech Inc (US)', po: 'PO-4470', hasCredit: false },
]

export const INVOICE_STATUSES = ['all', 'paid', 'overdue', 'refunded', 'draft']
export const INVOICE_CURRENCIES = ['all', 'USD', 'EUR', 'GBP', 'AED']
export const INVOICE_ENTITIES = ['all', 'Zoiko Tech Inc (US)', 'Zoiko Tech Ltd (UK)']
export const ACCOUNTING_EXPORTS = ['Xero', 'QuickBooks', 'NetSuite', 'SAP / Oracle (CSV)']

/* ── Settings tab ──────────────────────────────────────────────────────── */

export const PAYMENT_METHODS = {
  primary: { label: 'Visa •••• 4242', detail: 'Expires 09/26', default: true },
  backup: { label: 'ACH — Wells Fargo •••• 8821', detail: 'US bank account' },
  achWire: true,
  invoicePayment: true,
  autoPay: true,
}

export const BILLING_INFO = {
  legalEntity: 'Acme Robotics, Inc.',
  address: '500 Market St, Suite 400, San Francisco, CA 94105, US',
  vat: '—',
  gst: '—',
  ein: '84-1234567',
  taxIds: 'US-EIN-84-1234567',
  poDefault: 'PO-4471',
  costCenters: 'ENG-01, OPS-02, SALES-03',
}

export const NOTIFICATIONS = {
  monthlyFinanceSummary: true,
  paymentFailureAlerts: true,
  renewalAlerts: true,
  invoiceExportSchedule: 'Monthly — 1st',
}

export const SPEND_CONTROLS = {
  agenticCap: 500,
  thresholdAlertPct: 80,
  approvalWorkflow: 'Required over $1,000',
}

/* ── Support ───────────────────────────────────────────────────────────── */

export const SUPPORT_ENTERPRISE = {
  csm: 'Dana Okafor',
  billingLead: 'finance@zoiko.com',
  supportRoute: 'Priority — Enterprise queue',
  bookingLink: 'https://cal.zoiko.com/csm',
  priorityEmail: 'priority@zoiko.com',
  disputeSla: '2 business days',
  accountOwner: 'Harish Reddy',
}
export const SUPPORT_SMB = {
  liveChat: 'In-app, 9–6 local',
  email: 'support@zoiko.com',
  faq: 'https://help.zoiko.com/billing',
  bookCall: 'https://cal.zoiko.com/sales',
}

/* ─────────────────────────────────────────────────────────────────────────
 * Permission model. Frontend gating only — the backend must re-check every
 * mutation. `can()` drives whether an action button is enabled.
 * ──────────────────────────────────────────────────────────────────────── */

export const ROLES = ['Workspace Owner', 'Billing Admin', 'Finance Viewer', 'Procurement Viewer', 'Standard User']

const CAPS = {
  'Workspace Owner': new Set(['*']),
  'Billing Admin': new Set([
    'managePayment', 'editBilling', 'setCap', 'editApprovers', 'export',
    'editPO', 'viewAllInvoices', 'managePlan', 'manageSeats', 'configureNotifications',
  ]),
  'Finance Viewer': new Set(['export', 'viewAllInvoices']),
  'Procurement Viewer': new Set(['editPO', 'viewAllInvoices']),
  'Standard User': new Set([]), // own invoices only
}

/* Map whatever `user.role` the backend sends onto a billing role. Unknown or
 * missing roles fall back to Workspace Owner so the primary account can see the
 * full surface in this demo; tighten this once real billing roles exist. */
export function normalizeRole(role) {
  if (!role) return 'Workspace Owner'
  const r = String(role).toLowerCase()
  if (r.includes('owner') || r === 'admin' || r.includes('workspace')) return 'Workspace Owner'
  if (r.includes('billing')) return 'Billing Admin'
  if (r.includes('finance')) return 'Finance Viewer'
  if (r.includes('procure')) return 'Procurement Viewer'
  if (r.includes('member') || r === 'user' || r.includes('standard')) return 'Standard User'
  return 'Workspace Owner'
}

export function can(role, cap) {
  const set = CAPS[normalizeRole(role)] || CAPS['Standard User']
  return set.has('*') || set.has(cap)
}

/* ── Audit hooks ───────────────────────────────────────────────────────────
 * Every billing mutation flows through recordAudit so actor/role/before/after
 * are captured at the point of change. In-memory for now.
 * ponytail: POST to /api/billing/audit when the backend lands. */
const _auditTrail = []
export function recordAudit(entry) {
  const record = { timestamp: new Date().toISOString(), ...entry }
  _auditTrail.push(record)
  if (typeof console !== 'undefined') console.debug('[billing:audit]', record)
  return record
}
export function getAuditTrail() {
  return _auditTrail.slice()
}
