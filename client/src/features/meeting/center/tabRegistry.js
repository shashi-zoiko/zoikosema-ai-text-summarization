/**
 * Meeting Center tab registry (ZS-MTG-IMP-04).
 *
 * Declarative metadata only — the single list of tabs the resolver turns into
 * ResolvedTabs. Mirrors the More Menu v2 registry/resolver split. NO behavior,
 * NO React, NO module loading here (loaders are thunks the content host calls).
 *
 * Scope: this package implements ONLY People (and hosts the existing Chat panel
 * as the Chat tab). Steward / Tools / Host are DECLARED so the tab surface and
 * ordering are canonical and a later package only flips availability — but they
 * carry no loader and resolve unavailable, so their content is never mounted
 * ("never render inaccessible content").
 */
import { FLAGS } from '../../../lib/flags.js'

export const TAB = Object.freeze({
  PEOPLE: 'people',
  CHAT: 'chat',
  STEWARD: 'steward',
  TOOLS: 'tools',
  HOST: 'host',
})

/**
 * @typedef {Object} TabDescriptor
 * @property {string} id
 * @property {string} label            display label (i18n-ready; English default)
 * @property {number} order            stable tab order
 * @property {string} [flag]           feature flag gating availability
 * @property {'implemented'|'deferred'} status
 * @property {(ctx:object)=>boolean} [requiresCapability]  role/capability gate
 * @property {(ctx:object)=>number} [badge]  unread/pending count (0 = none)
 * @property {()=>Promise<any>} [load] lazy module loader (content host imports)
 */

/** @type {TabDescriptor[]} */
export const TAB_REGISTRY = Object.freeze([
  {
    id: TAB.PEOPLE,
    label: 'People',
    order: 0,
    flag: FLAGS.PEOPLE_TAB_V3,
    status: 'implemented',
    isDefault: true,
    badge: (ctx) => (ctx.waitingCount || 0) + (ctx.raisedCount || 0),
    load: () => import('../people/ui/PeopleTab.jsx'),
  },
  {
    id: TAB.CHAT,
    label: 'Chat',
    order: 1,
    status: 'implemented',
    badge: (ctx) => ctx.unreadChat || 0,
    // Rendered via an injected slot that reuses the existing ChatPanel — the
    // Center hosts it rather than duplicating chat. No lazy module here. Visible
    // only where the integration wires the chat slot (`chatHosted`); until then
    // Chat stays its existing drawer, so the tab isn't shown with no content.
    usesSlot: true,
    requiresCapability: (ctx) => ctx.chatHosted === true,
  },
  // ── Declared but owned by later packages — resolve unavailable, no loader ──
  { id: TAB.STEWARD, label: 'Steward', order: 2, status: 'deferred', requiresCapability: () => false },
  { id: TAB.TOOLS, label: 'Tools', order: 3, status: 'deferred', requiresCapability: () => false },
  { id: TAB.HOST, label: 'Host', order: 4, status: 'deferred', requiresCapability: (ctx) => !!ctx.isHostOrCohost },
])

export const DEFAULT_TAB = TAB.PEOPLE
