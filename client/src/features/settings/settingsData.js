/* ─────────────────────────────────────────────────────────────────────────
 * Zoiko Sema — Enterprise Settings Control Center: permissions + audit.
 *
 * All page CONTENT is served dynamically from `GET /api/settings/overview`
 * (see server/app/api/settings.py) and consumed via useResource in the page —
 * there is no static content here. What remains is pure client-side logic:
 * the frontend permission model (advisory gating; the backend re-checks), the
 * audit hook, and the money formatter. Profile / theme / password stay wired
 * to the real AuthContext. ponytail: audit is in-memory; POST to
 * /api/settings/audit when the backend endpoint lands.
 * ──────────────────────────────────────────────────────────────────────── */

const CAPS = {
  'Workspace Owner': new Set(['*']),
  'Security Admin': new Set(['editWorkspace', 'compliance', 'requestException', 'editGovernance', 'rotateCredentials', 'viewAudit']),
  'Billing Admin': new Set(['editSpend', 'viewAudit']),
  'Standard User': new Set(['editUserPref', 'requestException']),
  'Enterprise Managed': new Set(['editUserPref']),
}

export function normalizeRole(role) {
  if (!role) return 'Workspace Owner'
  const r = String(role).toLowerCase()
  if (r.includes('owner') || r === 'admin' || r.includes('workspace')) return 'Workspace Owner'
  if (r.includes('security')) return 'Security Admin'
  if (r.includes('billing') || r.includes('finance')) return 'Billing Admin'
  if (r.includes('managed')) return 'Enterprise Managed'
  if (r.includes('member') || r === 'user' || r.includes('standard')) return 'Standard User'
  return 'Workspace Owner'
}

export function can(role, cap) {
  const set = CAPS[normalizeRole(role)] || CAPS['Standard User']
  return set.has('*') || set.has(cap)
}

const _auditTrail = []
export function recordAudit({ section, oldValue = null, newValue = null, actor, role, device = 'this device', revertible = true }) {
  const record = { timestamp: new Date().toISOString(), section, oldValue, newValue, actor, role, device, revertible }
  _auditTrail.push(record)
  if (typeof console !== 'undefined') console.debug('[settings:audit]', record)
  return record
}
export function getAuditTrail() {
  return _auditTrail.slice()
}

export const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0)
