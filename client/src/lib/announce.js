/**
 * Screen-reader live-region announcer.
 *
 * The client scattered ad-hoc role="status"/role="alert" nodes but had no shared
 * announcer. This is the single one: two visually-hidden live regions (polite +
 * assertive) lazily appended to <body>, updated imperatively. Used to announce
 * admissions, tab changes, and action results for WCAG 2.2 AA.
 *
 * Text-only, transient — never stores PII beyond the moment it is spoken.
 */
let politeEl = null
let assertiveEl = null

function ensureRegion(assertive) {
  if (typeof document === 'undefined') return null
  const existing = assertive ? assertiveEl : politeEl
  if (existing && existing.isConnected) return existing
  const el = document.createElement('div')
  el.setAttribute('aria-live', assertive ? 'assertive' : 'polite')
  el.setAttribute('aria-atomic', 'true')
  el.setAttribute('role', assertive ? 'alert' : 'status')
  el.className = 'sr-only'
  // Inline styles so it works even before the stylesheet loads.
  el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;'
  document.body.appendChild(el)
  if (assertive) assertiveEl = el
  else politeEl = el
  return el
}

/**
 * Announce a message to assistive tech.
 * @param {string} message
 * @param {{assertive?: boolean}} [opts]
 */
export function announce(message, { assertive = false } = {}) {
  const el = ensureRegion(assertive)
  if (!el || !message) return
  // Clearing first forces SRs to re-announce an identical string.
  el.textContent = ''
  // Double rAF avoids the clear+set collapsing into one mutation.
  const set = () => { el.textContent = String(message) }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(set))
  } else {
    set()
  }
}

/** Test-only: tear down the regions. */
export function __resetAnnouncer() {
  for (const el of [politeEl, assertiveEl]) {
    if (el && el.isConnected) el.remove()
  }
  politeEl = null
  assertiveEl = null
}
