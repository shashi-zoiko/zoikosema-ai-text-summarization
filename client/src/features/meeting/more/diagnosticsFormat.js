/**
 * Diagnostics value formatters. No shared bitrate/latency/percentage formatters
 * existed in the app (only file-local file-size / minutes helpers), so these are
 * the single canonical set for the diagnostics surface.
 */

export function fmtBitrate(bps) {
  if (bps == null || !Number.isFinite(bps) || bps < 0) return '—'
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  return `${Math.round(bps / 1000)} kbps`
}

export function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—'
  return `${Math.round(ms)} ms`
}

export function fmtPct(fraction) {
  if (fraction == null || !Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(1)}%`
}

export function fmtFps(fps) {
  if (fps == null || !Number.isFinite(fps)) return '—'
  return `${Math.round(fps)} fps`
}

export function fmtResolution(w, h) {
  if (!w || !h) return '—'
  return `${w}×${h}`
}
