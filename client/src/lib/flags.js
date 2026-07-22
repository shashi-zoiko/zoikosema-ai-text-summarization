import { useSyncExternalStore } from 'react'

/**
 * Keyed client feature flags.
 *
 * Generalizes the single-flag pattern established by
 * `features/meeting/more/flags.js` (ZS-MTG-IMP-03) into one keyed reader so the
 * seven ZS-MTG-IMP-04 flags don't each need their own module. Same naming
 * convention as the original: localStorage key `zoiko_ff_<name>`, build-time env
 * `VITE_<NAME>`.
 *
 * Resolution order (first definitive wins):
 *   1. runtime override (setFlag) — in-memory, highest precedence so rollback is
 *      instant and works even when localStorage is blocked.
 *   2. localStorage `zoiko_ff_<name>` — '1'/'true' → on, '0'/'false' → off.
 *   3. build-time env `VITE_<NAME>` — '1'/'true' → on, '0'/'false' → off.
 *   4. DEFAULTS[name] (all OFF for the IMP-04 package — ships dark, legacy stays
 *      live until a flag is explicitly enabled).
 *
 * Unlike the More Menu flag (read once at mount), these support **runtime
 * rollback without a reload**: `useFlag` subscribes to changes, so flipping a
 * flag via `setFlag` (or another tab writing localStorage) re-renders consumers.
 * That is the mechanism the Rollback contract relies on — flip
 * `people_realtime_v3`/`people_tab_v3` off and the legacy path is restored live.
 */

export const FLAGS = Object.freeze({
  MEETING_CENTER_V3: 'meeting_center_v3',
  PEOPLE_TAB_V3: 'people_tab_v3',
  ADMISSIONS_V3: 'admissions_v3',
  PEOPLE_ACTIONS_V3: 'people_actions_v3',
  PEOPLE_SEARCH_FILTERS_V3: 'people_search_filters_v3',
  PEOPLE_REALTIME_V3: 'people_realtime_v3',
  MOBILE_MEETING_CENTER_SHARED_MODEL: 'mobile_meeting_center_shared_model',
})

// The two gating flags ship ON (Meeting Center + People are the default in
// production). Legacy stays a kill switch: set localStorage `zoiko_ff_<name>=0`
// or build with VITE_<NAME>=0 to fall back to the old ParticipantsPanel — no
// redeploy needed for the localStorage path. The other five aren't wired to a
// live gate yet, so their default is inert.
const DEFAULTS = Object.freeze({
  [FLAGS.MEETING_CENTER_V3]: true,
  [FLAGS.PEOPLE_TAB_V3]: true,
  [FLAGS.ADMISSIONS_V3]: false,
  [FLAGS.PEOPLE_ACTIONS_V3]: false,
  [FLAGS.PEOPLE_SEARCH_FILTERS_V3]: false,
  [FLAGS.PEOPLE_REALTIME_V3]: false,
  [FLAGS.MOBILE_MEETING_CENTER_SHARED_MODEL]: false,
})

const PREFIX = 'zoiko_ff_'
const _overrides = new Map() // name -> boolean, set via setFlag (in-memory, wins)
const _listeners = new Set()

function storageKey(name) {
  return PREFIX + name
}
function envKey(name) {
  return 'VITE_' + name.toUpperCase()
}

function truthy(v) {
  return v === '1' || v === 'true' || v === true
}
function falsy(v) {
  return v === '0' || v === 'false' || v === false
}

/** Pure resolver — no React. Safe to call from tests and non-component code. */
export function isFlagEnabled(name) {
  if (_overrides.has(name)) return _overrides.get(name)
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey(name)) : null
    if (truthy(raw)) return true
    if (falsy(raw)) return false
  } catch {
    // localStorage blocked (private mode / SSR) — fall through to env / default.
  }
  try {
    const env = import.meta.env?.[envKey(name)]
    if (truthy(env)) return true
    if (falsy(env)) return false
  } catch {
    // import.meta.env unavailable in some test contexts — fall through.
  }
  return DEFAULTS[name] ?? false
}

/** Snapshot of all known flags — used by telemetry and the rollback path. */
export function allFlags() {
  const out = {}
  for (const name of Object.values(FLAGS)) out[name] = isFlagEnabled(name)
  return out
}

function notify() {
  for (const fn of _listeners) {
    try {
      fn()
    } catch {
      // a listener must never break flag propagation
    }
  }
}

/**
 * Set a flag at runtime (rollback / operator toggle). Persists to localStorage
 * when available AND records an in-memory override so the change takes effect
 * immediately and survives a blocked storage. Pass `null` to clear the override
 * and fall back to storage/env/default. Notifies all `useFlag` consumers.
 */
export function setFlag(name, value) {
  if (value === null || value === undefined) {
    _overrides.delete(name)
  } else {
    _overrides.set(name, !!value)
  }
  try {
    if (typeof localStorage !== 'undefined') {
      if (value === null || value === undefined) localStorage.removeItem(storageKey(name))
      else localStorage.setItem(storageKey(name), value ? '1' : '0')
    }
  } catch {
    // storage optional — in-memory override still applies
  }
  notify()
}

/** Subscribe to any flag change (setFlag or cross-tab storage). Returns unsubscribe. */
export function subscribeFlags(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

// Cross-tab: another tab flipping a kill switch propagates here too.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e && typeof e.key === 'string' && e.key.startsWith(PREFIX)) notify()
  })
}

/**
 * React hook: current value of one flag, re-rendering on runtime change.
 * getServerSnapshot returns the same pure resolution (no SSR divergence).
 */
export function useFlag(name) {
  return useSyncExternalStore(
    subscribeFlags,
    () => isFlagEnabled(name),
    () => isFlagEnabled(name),
  )
}

/** Test-only: drop all in-memory overrides. */
export function __resetFlagOverrides() {
  _overrides.clear()
  notify()
}
