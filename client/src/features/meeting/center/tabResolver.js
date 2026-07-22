/**
 * Tab resolver — pure. Turns the declarative registry into ResolvedTabs using
 * feature flags, role/capability context and live badge counts. The render layer
 * consumes ONLY this output (never the registry), so no component re-derives
 * availability. Mirrors the More Menu resolver contract.
 */
import { TAB_REGISTRY, DEFAULT_TAB } from './tabRegistry.js'
import { isFlagEnabled } from '../../../lib/flags.js'

/**
 * @typedef {Object} ResolvedTab
 * @property {string} id
 * @property {string} label
 * @property {number} order
 * @property {boolean} available   flag + capability + implemented
 * @property {boolean} visible     shown in the tab strip (unavailable+deferred → hidden)
 * @property {number} badge
 * @property {string} [reason]     why unavailable (for a11y / future disabled UI)
 */

/**
 * @param {object} ctx  { isHostOrCohost, waitingCount, raisedCount, unreadChat, isFlagEnabled? }
 * @returns {ResolvedTab[]}
 */
export function resolveTabs(ctx = {}) {
  const flagOn = ctx.isFlagEnabled || isFlagEnabled
  return TAB_REGISTRY.map((t) => {
    let available = true
    let reason
    if (t.status === 'deferred') { available = false; reason = 'not_in_release' }
    if (available && t.flag && !flagOn(t.flag)) { available = false; reason = 'flag_off' }
    if (available && t.requiresCapability && !t.requiresCapability(ctx)) { available = false; reason = 'not_authorized' }
    const badge = (() => { try { return t.badge ? t.badge(ctx) | 0 : 0 } catch { return 0 } })()
    return {
      id: t.id,
      label: t.label,
      order: t.order,
      available,
      // Deferred tabs are hidden entirely (no disabled placeholder); a tab that
      // is merely flag-off or unauthorized is also hidden — never render a tab
      // whose content can't be shown.
      visible: available,
      badge,
      reason,
      isDefault: !!t.isDefault,
    }
  }).sort((a, b) => a.order - b.order)
}

/** The ordered list of tabs that should render in the strip. */
export function visibleTabs(resolved) {
  return resolved.filter((t) => t.visible)
}

/**
 * Nearest available tab to `activeId`. If the active tab is still available it
 * stays; otherwise the default (People) if available, else the first available
 * by order, else null. Drives "automatically switch to nearest available tab"
 * when permissions/flags change.
 */
export function nearestAvailableTab(resolved, activeId) {
  const avail = resolved.filter((t) => t.available)
  if (avail.length === 0) return null
  if (avail.some((t) => t.id === activeId)) return activeId
  const def = avail.find((t) => t.id === DEFAULT_TAB) || avail.find((t) => t.isDefault)
  if (def) return def.id
  return avail[0].id
}

/** The tab a freshly-opened center should show. */
export function initialTab(resolved) {
  return nearestAvailableTab(resolved, DEFAULT_TAB)
}
