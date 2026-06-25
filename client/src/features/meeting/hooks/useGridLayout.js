import { useLayoutEffect, useMemo, useRef, useState } from 'react'

/**
 * Adaptive video-grid engine — the same "best-fit" strategy Google Meet / Zoom
 * use. Given a participant count and the pixel box we have to fill, it finds the
 * column count that makes every tile as LARGE as possible while keeping a fixed
 * aspect ratio, never overflowing the box, and never overlapping.
 *
 * Why this instead of `aspect-video` tiles in a CSS `auto-rows-fr` grid (the old
 * approach): an `aspect-video` element sizes its height from its WIDTH. In a
 * height-distributed grid the cell height is fixed by the row count, so the tile
 * computed a taller height than its cell and spilled into the row below — the
 * "tiles overlap" bug. Here we compute BOTH tile dimensions in JS so they always
 * fit their cell exactly.
 */

export const TILE_ASPECT = 16 / 9

/**
 * @returns {{cols:number, rows:number, tileW:number, tileH:number}}
 */
export function computeGridLayout(count, width, height, gap = 12, aspect = TILE_ASPECT) {
  if (count <= 0 || width <= 0 || height <= 0) {
    return { cols: 1, rows: 1, tileW: 0, tileH: 0 }
  }

  let best = { cols: 1, rows: count, tileW: 0, tileH: 0, area: 0 }
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const cellW = (width - gap * (cols - 1)) / cols
    const cellH = (height - gap * (rows - 1)) / rows
    if (cellW <= 0 || cellH <= 0) continue

    // Fit a fixed-aspect rectangle inside the cell — clamp by whichever axis
    // is the binding constraint.
    let tileW
    let tileH
    if (cellW / cellH > aspect) {
      tileH = cellH
      tileW = tileH * aspect
    } else {
      tileW = cellW
      tileH = tileW / aspect
    }

    const area = tileW * tileH
    // Strictly-greater keeps the FEWEST columns among equal-area options, which
    // looks more natural (e.g. 2 people → side-by-side, not stacked).
    if (area > best.area + 0.5) {
      best = { cols, rows, tileW, tileH, area }
    }
  }
  // Floor to whole pixels so a sub-pixel rounding error can never push the row
  // a hair over the container width and make flex-wrap drop to fewer columns.
  return {
    cols: best.cols,
    rows: best.rows,
    tileW: Math.floor(best.tileW),
    tileH: Math.floor(best.tileH),
  }
}

/**
 * Observe an element's content box. Coalesces bursts (resize, sidebar open,
 * device-pixel changes) into a single rAF-throttled update so layout math runs
 * at most once per frame.
 */
export function useElementSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined

    let raf = 0
    const apply = (rect) => {
      raf = 0
      setSize((prev) =>
        Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
          ? prev
          : { width: rect.width, height: rect.height },
      )
    }

    const ro = new ResizeObserver((entries) => {
      const cr = entries[entries.length - 1].contentRect
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => apply(cr))
    })
    ro.observe(el)
    // Seed immediately so the first paint isn't a 0×0 frame.
    const r = el.getBoundingClientRect()
    apply({ width: r.width, height: r.height })

    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return [ref, size]
}

/**
 * Convenience wrapper: measures `ref` and returns the grid solution for `count`.
 */
export function useGridLayout(count, gap = 12) {
  const [ref, size] = useElementSize()
  const layout = useMemo(
    () => computeGridLayout(count, size.width, size.height, gap),
    [count, size.width, size.height, gap],
  )
  return [ref, layout, size]
}
