/**
 * Shared vocabulary for the normalized People module (ZS-MTG-IMP-04).
 *
 * Declarative constants only — the single set of enums the reducer, store,
 * selectors, capability/action resolvers and render layer all speak. No behavior
 * lives here. Mirrors the More Menu v2 `constants.js` discipline.
 *
 * IMPORTANT — grouping vs the server role model. The server has only three roles
 * (`host` / `co_host` / `participant`; see server/app/models/meeting.py). The
 * spec's canonical groups are therefore DERIVED, not read from a role field:
 *   • Presenters      ← runtime screen-share flag (`presenting`)
 *   • External Guests ← `is_guest` boolean (also surfaced as a BADGE)
 *   • View Only       ← no server concept yet → resolves empty (present, unused)
 *   • Meeting Services← bot/egress identities → resolves empty today
 * External is BOTH a badge (always, on any row) and, for guests not otherwise
 * grouped, their canonical group — one participant still occupies exactly ONE
 * group (see selectors.assignGroup).
 */

// Server roles (authoritative). Mirror of models/meeting.py ROLE_*.
export const ROLE = Object.freeze({
  HOST: 'host',
  COHOST: 'co_host',
  PARTICIPANT: 'participant',
})

// Membership status of a person within the meeting.
export const STATUS = Object.freeze({
  WAITING: 'waiting', // in the admission queue (control plane)
  ACTIVE: 'active', // admitted + present in the media plane
  LEFT: 'left', // transient, pending removal
})

// Canonical groups, in stable render order. One participant → exactly one group.
export const GROUP = Object.freeze({
  WAITING: 'waiting',
  HOSTS: 'hosts',
  COHOSTS: 'cohosts',
  PRESENTERS: 'presenters',
  EXTERNAL_GUESTS: 'external_guests',
  PARTICIPANTS: 'participants',
  VIEW_ONLY: 'view_only',
  MEETING_SERVICES: 'meeting_services',
})

export const GROUP_ORDER = Object.freeze([
  GROUP.WAITING,
  GROUP.HOSTS,
  GROUP.COHOSTS,
  GROUP.PRESENTERS,
  GROUP.EXTERNAL_GUESTS,
  GROUP.PARTICIPANTS,
  GROUP.VIEW_ONLY,
  GROUP.MEETING_SERVICES,
])

// Media device state — 'unknown' until the media plane reports (never assume).
export const DEVICE = Object.freeze({
  ON: 'on',
  OFF: 'off',
  UNKNOWN: 'unknown',
})

// Connection health. ATTENTION drives the "connection attention" indicator/filter.
export const CONN = Object.freeze({
  GOOD: 'good',
  ATTENTION: 'attention',
  UNKNOWN: 'unknown',
})

// Search filters (spec §Search). Preserved across tab switches by the store.
export const FILTER = Object.freeze({
  WAITING: 'waiting',
  HOSTS: 'hosts',
  PRESENTERS: 'presenters',
  EXTERNAL: 'external',
  RAISED_HANDS: 'raised_hands',
  MUTED: 'muted',
  CAMERA_OFF: 'camera_off',
  SHARING: 'sharing',
  CONNECTION_ATTENTION: 'connection_attention',
})

/**
 * Participant actions THAT EXIST in this product. Deliberately excludes
 * remote-unmute and remote-camera-start (must never exist), and mute-others /
 * remove / spotlight (deliberately removed / owned by later Host Console
 * packages). The capability resolver returns availability only for these;
 * anything else resolves unavailable-with-reason, never rendered as actionable.
 */
export const ACTION = Object.freeze({
  ADMIT: 'admit',
  DENY: 'deny',
  ADMIT_ALL: 'admit_all',
  PROMOTE: 'promote', // participant → co_host
  DEMOTE: 'demote', // co_host → participant
  PIN: 'pin', // local-only (client view), never a server mutation
  UNPIN: 'unpin',
  LOWER_HAND: 'lower_hand', // lower one's OWN or (host) another's raised hand
})

// Privileged actions that must be audited server-side (opaque IDs, no PII).
export const AUDITED_ACTIONS = Object.freeze([
  ACTION.ADMIT,
  ACTION.DENY,
  ACTION.ADMIT_ALL,
  ACTION.PROMOTE,
  ACTION.DEMOTE,
])

// Lifecycle of a pending action. NO optimistic completion: an action stays
// PENDING until an authoritative server event confirms/denies it.
export const PENDING_STATE = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
})

// Normalized internal delta kinds (control plane, seq-ordered).
export const DELTA = Object.freeze({
  JOINED: 'joined',
  LEFT: 'left',
  ROLE: 'role',
  HAND: 'hand',
  WAITING_ADD: 'waiting_add',
  WAITING_REMOVE: 'waiting_remove',
  WAITING_RESET: 'waiting_reset', // full waiting-list replace (idempotent)
  PERMISSIONS: 'permissions',
})

// Reducer event envelope types.
export const EVENT = Object.freeze({
  SNAPSHOT: 'snapshot', // authoritative full reconciliation (seq-stamped)
  DELTA: 'delta', // one seq-ordered control-plane mutation
  MEDIA_PRESENCE: 'media_presence', // authoritative LiveKit roster upsert (not seq'd)
  PENDING: 'pending',
  PENDING_CLEARED: 'pending_cleared',
  PENDING_FAILED: 'pending_failed',
  RESET: 'reset',
})

// Bounded out-of-order buffer. A gap wider than this forces a snapshot resync
// rather than unbounded memory growth.
export const MAX_BUFFERED_DELTAS = 256

// Virtualization engages automatically above this many rendered rows (spec).
export const VIRTUALIZE_THRESHOLD = 75
