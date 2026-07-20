/**
 * Shared vocabulary for the More Menu v2 package (ZS-MTG-IMP-03).
 *
 * Declarative constants only — the single set of enums the registry, resolver and
 * render layer all speak. No behavior lives here. Mirrors the spec's
 * ResolvedPersonalControl shape (§14.2) so the resolver has one contract.
 */

// Menu sections (§14.2 `section`, §5.1 order).
export const SECTION = Object.freeze({
  VIEW: 'view',
  APPEARANCE_MEDIA: 'appearance_media',
  DIAGNOSTICS: 'diagnostics',
  SUPPORT_SAFETY: 'support_safety',
  WINDOW: 'window',
})

// How an item presents/behaves (§14.2 `presentation`, extended with 'dialog'
// which Appendix A uses for bounded subflows like speaker test / stats).
export const PRESENTATION = Object.freeze({
  RADIO: 'radio',
  CHECK: 'check',
  COMMAND: 'command',
  ROUTE: 'route',
  SUBMENU: 'submenu',
  DIALOG: 'dialog',
})

// Resolved access state (§14.2 `state`). Only the resolver assigns these.
export const CONTROL_STATE = Object.freeze({
  AVAILABLE: 'available',
  ACTIVE: 'active',
  MANAGED: 'managed',
  APPROVAL_REQUIRED: 'approval_required',
  UNAVAILABLE: 'unavailable',
  TEMPORARY: 'temporary',
  REVOKED: 'revoked',
})

// Where a preference lives (§14.2 `persistence`, §16).
export const PERSISTENCE = Object.freeze({
  ACCOUNT_DEVICE: 'account_device',
  DEVICE: 'device',
  MEETING: 'meeting',
  SESSION: 'session',
  EPHEMERAL: 'ephemeral',
  NONE: 'none',
})

// Which input(s) determined the resolved state (§14.2 `provenance`).
export const PROVENANCE = Object.freeze({
  MEETING: 'meeting',
  POLICY: 'policy',
  ENTITLEMENT: 'entitlement',
  DEVICE: 'device',
  PLATFORM: 'platform',
  PREFERENCE: 'preference',
})

// Declared owner of an item's action (§15.1, Appendix A `Owner`). Routing/ownership
// metadata — the resolver never invents capability, it defers to these owners.
export const OWNER = Object.freeze({
  SHELL: 'shell',
  PLATFORM: 'platform',
  MEDIA: 'media',
  AUDIO: 'audio',
  DEVICE: 'device',
  SETTINGS: 'settings',
  DIAGNOSTICS: 'diagnostics',
  SUPPORT: 'support',
  TRUST_SAFETY: 'trust_safety',
  ACCESSIBILITY: 'accessibility',
  SHORTCUT_SERVICE: 'shortcut_service',
  NATIVE_ADAPTER: 'native_adapter',
})

/**
 * @typedef {Object} PersonalControlDescriptor  Declarative registry entry (metadata only).
 * @property {string} id            Canonical item ID (Appendix A).
 * @property {string} section       One of SECTION.
 * @property {string} presentation  One of PRESENTATION.
 * @property {string} owner         One of OWNER.
 * @property {string} persistence   One of PERSISTENCE.
 * @property {string} availability  Raw Appendix A availability rule (interpreted by the resolver).
 * @property {string} localeKey     Canonical `meeting.more.*` localization key (§5.2).
 * @property {string} icon          Icon name (mapped to a component in the render layer).
 */

/**
 * @typedef {Object} ResolvedPersonalControl  Resolver output (§14.2). The render layer
 *   consumes only this — never the raw registry — so state is single-sourced.
 * @property {string} id
 * @property {string} section
 * @property {string} presentation
 * @property {string} persistence
 * @property {string} owner
 * @property {string} localeKey
 * @property {string} icon
 * @property {string} state              One of CONTROL_STATE.
 * @property {boolean} [checked]         Selected/active truth (radio/check), set from actual state.
 * @property {string} [reasonTextKey]    Localization key explaining a non-available state.
 * @property {string[]} provenance       Subset of PROVENANCE.
 * @property {number} revision
 */
