import { useState } from 'react'

/**
 * Feature flag for the More Menu v2 package (ZS-MTG-IMP-03).
 *
 * DEFAULT: ON (shipped enabled to production, 2026-07-20). The legacy More menu is
 * retained in the code and reachable as a kill switch:
 *
 * Resolution order (first definitive wins):
 *   1. localStorage override  — `zoiko_ff_meeting_more_v2` = '1'/'true' | '0'/'false'
 *   2. build-time env kill switch — VITE_MEETING_MORE_V2 = '0'/'false' forces legacy
 *   3. ON (default)
 *
 * Read ONCE at mount (no live listeners); a change applies on the next reload.
 */

const STORAGE_KEY = 'zoiko_ff_meeting_more_v2'

export function isMoreMenuV2Enabled() {
  try {
    const override = localStorage.getItem(STORAGE_KEY)
    if (override === '1' || override === 'true') return true
    if (override === '0' || override === 'false') return false
  } catch {
    // localStorage blocked (private mode / SSR) — fall through to env / default.
  }
  // A build can still force the legacy menu with VITE_MEETING_MORE_V2=0.
  const env = import.meta.env?.VITE_MEETING_MORE_V2
  if (env === '0' || env === 'false') return false
  return true
}

export function useMoreMenuV2() {
  // Read once at mount. A flag change applies on the next reload (standard kill
  // switch), which keeps the OFF path free of any subscription/listener.
  const [enabled] = useState(isMoreMenuV2Enabled)
  return enabled
}
