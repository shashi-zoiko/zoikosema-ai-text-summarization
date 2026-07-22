/* ─────────────────────────────────────────────────────────────────────────
 * Client analytics seam.
 *
 * The client has no telemetry backend yet, so this is a deliberately thin,
 * fail-safe dispatcher — NOT a framework. `trackEvent` never throws and is a
 * no-op unless a sink is attached, so wiring events now is free and pointing
 * them at a real backend later is a one-line change (attach `setAnalyticsSink`
 * or push onto `window.__zoikoAnalytics`).
 *
 * Event names are enumerated in EVENTS so call sites can't typo a name; adding
 * a real sink later gets a stable, de-duplicated vocabulary for free.
 * ──────────────────────────────────────────────────────────────────────── */

export const EVENTS = {
  JOIN_CLICKED: 'join_clicked',
  JOIN_SUCCESS: 'join_success',
  JOIN_FAILED: 'join_failed',
  DEVICE_CHANGED: 'device_changed',
  DEVICE_TEST_CLICKED: 'device_test_clicked',
  CONFIDENTIAL_DETAILS_OPENED: 'confidential_details_opened',
  COPY_INVITE_CLICKED: 'copy_invite_clicked',
  CONNECTION_DETAILS_OPENED: 'connection_details_opened',
  ADMISSION_POLICY_CHANGED: 'admission_policy_changed',

  // ── Meeting Center + People (ZS-MTG-IMP-04) ─────────────────────────────
  // Privacy-safe by construction: payloads carry only counts, durations (ms),
  // enums (tab id, group, filter, action verb, reason) and booleans — NEVER a
  // participant name, email, message or identity. Mirrors the audit-ledger rule.
  MEETING_CENTER_OPENED: 'meeting_center_opened',      // { tab, open_ms }
  MEETING_CENTER_CLOSED: 'meeting_center_closed',      // { tab }
  MEETING_CENTER_TAB_CHANGED: 'meeting_center_tab_changed', // { from, to, reason }
  MEETING_CENTER_TAB_AUTO_SWITCHED: 'meeting_center_tab_auto_switched', // { from, to }
  PEOPLE_MOUNTED: 'people_mounted',                    // { mount_ms, count }
  PEOPLE_SNAPSHOT_LOADED: 'people_snapshot_loaded',    // { count, seq }
  PEOPLE_DELTA_APPLIED: 'people_delta_applied',        // { type, reducer_ms }
  PEOPLE_GAP_DETECTED: 'people_gap_detected',          // { expected, got }
  PEOPLE_GAP_RECOVERED: 'people_gap_recovered',        // { recover_ms, via }
  PEOPLE_RECONNECT_RECOVERED: 'people_reconnect_recovered', // { recover_ms }
  PEOPLE_SEARCH: 'people_search',                      // { q_len, results, search_ms }
  PEOPLE_FILTER_CHANGED: 'people_filter_changed',      // { filter, active }
  PEOPLE_ACTION_REQUESTED: 'people_action_requested',  // { action }
  PEOPLE_ACTION_CONFIRMED: 'people_action_confirmed',  // { action, action_ms }
  PEOPLE_ACTION_FAILED: 'people_action_failed',        // { action, reason }
  PEOPLE_VIRTUALIZATION_ENGAGED: 'people_virtualization_engaged', // { rows }
  PEOPLE_RENDER_HEALTH: 'people_render_health',        // { rows, rendered, long_frame }
  PEOPLE_ROLLBACK: 'people_rollback',                  // { flag }
}

let _sink = null

/** Attach the real telemetry sink once a backend exists: fn(name, props). */
export function setAnalyticsSink(fn) {
  _sink = typeof fn === 'function' ? fn : null
}

/**
 * Fire an analytics event. Safe to call anywhere — swallows every error so a
 * telemetry problem can never break a user flow (join, device switch, copy).
 */
export function trackEvent(name, props = {}) {
  try {
    const payload = { name, ts: Date.now(), ...props }
    if (_sink) _sink(name, payload)
    // A page-level queue lets an integration drain events without this module
    // needing to know about it. Bounded so a missing drainer can't leak memory.
    if (typeof window !== 'undefined') {
      const q = (window.__zoikoAnalytics = window.__zoikoAnalytics || [])
      q.push(payload)
      if (q.length > 500) q.splice(0, q.length - 500)
    }
    if (import.meta.env?.DEV) console.debug('[analytics]', name, props)
  } catch { /* telemetry must never surface to the user */ }
}
