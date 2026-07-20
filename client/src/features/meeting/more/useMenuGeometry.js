import { useCallback, useEffect, useState } from 'react'

/**
 * Layout-driven geometry for the More menu (ZS-MTG-IMP-03 §6.2).
 *
 * Derives column mode / width / max-height from the live viewport (so it adapts to
 * window size, DPI scaling and browser zoom — all reflected in CSS-px innerWidth/
 * innerHeight and getBoundingClientRect), and anchors above the trigger with
 * collision-aware clamping and 16px viewport clearance (§6.1).
 *
 * State is only ever set from a ref callback (commit) or a resize handler (event)
 * — never synchronously in an effect — so the full style comes from state and
 * survives re-renders (no imperative style that a re-render would wipe).
 */

const EDGE = 16 // viewport clearance
const RESERVE_TWO_COL = 176 // status + dock + 32 reserve for two-column max height

function viewportGeometry() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Two columns only on wide, tall-enough viewports; compact/short height and
  // zoom-narrowed viewports fall back to a single column (§6.2).
  let mode = vw >= 1280 && vh >= 720 ? 'two_column' : 'single_column'
  let width = mode === 'two_column' ? 560 : 360
  width = Math.min(width, vw - EDGE * 2)
  let maxHeight = mode === 'two_column'
    ? Math.min(780, vh - RESERVE_TWO_COL)
    : (vh < 720 ? vh - 96 : vh - 112)
  maxHeight = Math.max(240, maxHeight)
  return { mode, width, maxHeight }
}

export function useMenuGeometry(anchorRef) {
  const [mode, setMode] = useState(() => viewportGeometry().mode)
  const [style, setStyle] = useState(() => {
    const g = viewportGeometry()
    // Sensible default (right-anchored above the dock) until the ref callback
    // measures the trigger; avoids any flash of mispositioned content.
    return { position: 'fixed', right: EDGE, bottom: 96, width: g.width, maxHeight: g.maxHeight }
  })

  const compute = useCallback(() => {
    const g = viewportGeometry()
    setMode(g.mode)
    const next = { position: 'fixed', width: g.width, maxHeight: g.maxHeight }
    const a = anchorRef.current?.getBoundingClientRect()
    if (a) {
      // Above the trigger, right edge aligned to it, clamped within the viewport.
      const left = Math.min(Math.max(EDGE, a.right - g.width), window.innerWidth - EDGE - g.width)
      next.left = Math.max(EDGE, left)
      next.bottom = Math.max(EDGE, window.innerHeight - a.top + 14)
    } else {
      next.right = EDGE
      next.bottom = 96
    }
    setStyle(next)
  }, [anchorRef])

  // Measure at commit (before paint) via the ref callback, and on viewport change.
  const setPanel = useCallback((node) => { if (node) compute() }, [compute])

  useEffect(() => {
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [compute])

  return { mode, style, setPanel }
}
