/* ─────────────────────────────────────────────────────────────────────────
 * Zoiko Sema — Enterprise Support Command Center: permissions + audit.
 *
 * All page CONTENT is served dynamically from `GET /api/support/overview`
 * (see server/app/api/support.py) and consumed via useResource in the page —
 * there is no static content here. What remains is pure client-side logic:
 * the frontend permission model (advisory gating; the backend re-checks) and
 * the audit hook. ponytail: audit is in-memory; POST to /api/support/audit
 * when the backend endpoint lands.
 * ──────────────────────────────────────────────────────────────────────── */

const CAPS = {
  'Workspace Owner': new Set(['*']),
  'Support Admin': new Set(['*']),
  'Security Admin': new Set(['securityCases', 'compliance', 'approveDiagnostics', 'viewAllCases', 'runDiagnostic', 'incidents']),
  'Billing Admin': new Set(['billingCases', 'viewOwnCases']),
  'Standard User': new Set(['viewOwnCases', 'newCase', 'runDiagnostic']),
  'Enterprise Managed': new Set(['viewOwnCases', 'newCase']), // policy-controlled
}

/* Map whatever `user.role` the backend sends onto a support role. Unknown or
 * missing roles fall back to Workspace Owner so the primary account sees the
 * full surface in this demo; tighten this once real support roles exist. */
export function normalizeRole(role) {
  if (!role) return 'Workspace Owner'
  const r = String(role).toLowerCase()
  if (r.includes('owner') || r === 'admin' || r.includes('workspace')) return 'Workspace Owner'
  if (r.includes('support')) return 'Support Admin'
  if (r.includes('security')) return 'Security Admin'
  if (r.includes('billing') || r.includes('finance')) return 'Billing Admin'
  if (r.includes('managed') || r.includes('enterprise')) return 'Enterprise Managed'
  if (r.includes('member') || r === 'user' || r.includes('standard')) return 'Standard User'
  return 'Workspace Owner'
}

export function can(role, cap) {
  const set = CAPS[normalizeRole(role)] || CAPS['Standard User']
  return set.has('*') || set.has(cap)
}

const _auditTrail = []
export function recordAudit(entry) {
  const record = { timestamp: new Date().toISOString(), ...entry }
  _auditTrail.push(record)
  if (typeof console !== 'undefined') console.debug('[support:audit]', record)
  return record
}
export function getAuditTrail() {
  return _auditTrail.slice()
}
