/**
 * Bounded, disposable stats collector (ZS-MTG-IMP-03 §10, §18).
 *
 * A pure controller around a SINGLE interval — no React, no LiveKit — so its
 * lifecycle is deterministic and unit-testable:
 *   - `start()` is idempotent: it never creates a second interval.
 *   - `stop()` clears the interval AND aborts any in-flight `collect()` so a late
 *     resolution can't call `onSample` after close.
 * Nothing runs until `start()`; after `stop()` there is exactly zero active work.
 */

// The single, configurable diagnostics refresh cadence (§10.1: 1–2s while open).
// Defined here once — no interval literals scattered across components.
export const DIAGNOSTICS_POLL_MS = 2000

export function createStatsCollector({ collect, onSample, intervalMs = DIAGNOSTICS_POLL_MS }) {
  let timer = null
  let aborted = false

  const runOnce = async () => {
    try {
      const sample = await collect()
      if (!aborted && sample) onSample(sample)
    } catch {
      // transient stats error — skip this tick, never throw into the interval
    }
  }

  return {
    start() {
      if (timer != null) return // idempotent — guarantees a single interval
      aborted = false
      runOnce() // immediate first sample
      timer = setInterval(runOnce, intervalMs)
    },
    stop() {
      aborted = true
      if (timer != null) {
        clearInterval(timer)
        timer = null
      }
    },
    isRunning() {
      return timer != null
    },
  }
}
