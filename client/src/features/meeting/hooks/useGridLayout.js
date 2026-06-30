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
 * Pick the grid options for the GALLERY layout from the participant count and
 * the container orientation. Two distinct strategies, exactly like Google Meet:
 *
 *   • Landscape / desktop → aspect-PRESERVING best-fit. Tiles keep a 16:9 frame
 *     and are letter-boxed inside the box; premium, lots of breathing room.
 *   • Portrait phone      → FILL best-fit. Tiles tile the screen edge-to-edge
 *     (video object-cover crops to taste), with a hard column cap so faces stay
 *     large instead of collapsing into tiny 16:9 slivers. Big rooms switch to a
 *     vertically-scrolling grid rather than shrinking past a legible minimum.
 */
export function galleryGridOpts(count, portrait) {
  if (portrait) {
    // 1–2 people → one big tile per row; then 2 columns; only very large rooms
    // go to 3 columns (with scroll). Keeps every face comfortably large.
    const maxCols = count <= 2 ? 1 : count <= 12 ? 2 : 3
    return { fill: true, maxCols, minTileH: 150 }
  }
  // Landscape phones, tablets and desktops keep the cinematic 16:9 gallery; only
  // a very large roster falls back to a capped, scrolling grid.
  return { aspect: TILE_ASPECT, maxCols: count <= 20 ? Infinity : 6, minTileH: 110 }
}

/**
 * @param {object} [opts]
 * @param {number} [opts.aspect]    Fixed tile aspect for the aspect-preserving mode.
 * @param {number} [opts.maxCols]   Hard column cap.
 * @param {number} [opts.minTileH]  Below this tile height, switch to a scrolling grid.
 * @param {boolean}[opts.fill]      Fill cells edge-to-edge (cover) instead of letter-boxing.
 * @returns {{cols:number, rows:number, tileW:number, tileH:number, scroll:boolean}}
 */
export function computeGridLayout(count, width, height, gap = 12, opts = {}) {
  const { aspect = TILE_ASPECT, maxCols = Infinity, minTileH = 0, fill = false } = opts
  if (count <= 0 || width <= 0 || height <= 0) {
    return { cols: 1, rows: 1, tileW: 0, tileH: 0, scroll: false }
  }
  const colCap = Math.min(count, Math.max(1, Math.floor(maxCols)))

  // ── FILL mode (portrait phones) ────────────────────────────────────────────
  // Tiles take the whole cell; we just pick the column count whose cells are the
  // largest while not getting freakishly wide/tall, then let object-cover crop.
  if (fill) {
    let best = null
    for (let cols = 1; cols <= colCap; cols++) {
      const rows = Math.ceil(count / cols)
      const cellW = (width - gap * (cols - 1)) / cols
      const cellH = (height - gap * (rows - 1)) / rows
      if (cellW <= 0 || cellH <= 0) continue
      const ar = cellW / cellH
      const arPenalty = ar > 2.4 || ar < 0.42 ? 0.55 : 1 // discourage extreme shapes
      const score = cellW * cellH * arPenalty
      if (!best || score > best.score + 0.5) best = { cols, rows, cellW, cellH, score }
    }
    if (!best) return { cols: 1, rows: count, tileW: width, tileH: height, scroll: false }
    if (minTileH > 0 && best.cellH < minTileH) {
      const cols = colCap
      const cellW = Math.floor((width - gap * (cols - 1)) / cols)
      const tileH = Math.max(Math.round(minTileH), Math.round(cellW)) // square-ish, legible
      return { cols, rows: Math.ceil(count / cols), tileW: cellW, tileH, scroll: true }
    }
    return {
      cols: best.cols,
      rows: best.rows,
      tileW: Math.floor(best.cellW),
      tileH: Math.floor(best.cellH),
      scroll: false,
    }
  }

  // ── ASPECT-PRESERVING best-fit (landscape / desktop) ─────────────────────────
  let best = { cols: 1, rows: count, tileW: 0, tileH: 0, area: 0 }
  for (let cols = 1; cols <= colCap; cols++) {
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

  // Too small to be legible → fall back to a fixed-size, vertically-scrolling
  // grid at the column cap instead of shrinking tiles into unreadable specks.
  if (minTileH > 0 && best.tileH < minTileH && best.tileH > 0) {
    const cols = colCap
    const tileW = Math.floor((width - gap * (cols - 1)) / cols)
    const tileH = Math.round(tileW / aspect)
    if (tileH >= minTileH * 0.8) {
      return { cols, rows: Math.ceil(count / cols), tileW, tileH, scroll: true }
    }
  }

  // Floor to whole pixels so a sub-pixel rounding error can never push the row
  // a hair over the container width and make flex-wrap drop to fewer columns.
  return {
    cols: best.cols,
    rows: best.rows,
    tileW: Math.floor(best.tileW),
    tileH: Math.floor(best.tileH),
    scroll: false,
  }
}

/**
 * How many tiles can share ONE gallery page while every tile stays at or above a
 * legible size — the cap that turns an endless scrolling wall into Google-Meet
 * style pagination. We grow the per-page count until the best-fit solution would
 * start scrolling (i.e. tiles dip under the legible floor), then back off by one.
 * The result is clamped to a hard ceiling (Meet tops out near 49 on desktop, far
 * fewer on a phone) so a page is never an unreadable mosaic.
 *
 * @returns {number} tiles per page, ≥ 1
 */
export function computePageSize(count, width, height, gap = 12, portrait = false) {
  if (count <= 0 || width <= 0 || height <= 0) return Math.max(1, count)
  const hardCap = portrait ? 6 : 49
  const cap = Math.min(count, hardCap)
  // Walk down from the cap and return the largest count that fits on ONE page
  // without scrolling AND keeps every tile at or above the legible floor. We
  // check the floor directly (not just the grid's `scroll` flag) because the
  // aspect-preserving fall-back lets tiles dip a little under the floor before
  // it switches to scroll — on a short/narrow landscape that would otherwise
  // pack 49 unreadable specks onto one page instead of paginating. c=1 always
  // clears the floor, so this never returns nothing. galleryGridOpts encodes the
  // same orientation strategy the live grid renders, so page math matches paint.
  for (let c = cap; c >= 1; c--) {
    const opts = galleryGridOpts(c, portrait)
    const g = computeGridLayout(c, width, height, gap, opts)
    const floor = opts.minTileH || 0
    if (!g.scroll && g.tileH > 0 && g.tileH >= floor) return c
  }
  return 1
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
 * Without explicit `opts` it auto-selects the orientation-aware gallery strategy
 * (portrait fill vs landscape 16:9 best-fit). Pass `opts` to force a strategy.
 */
export function useGridLayout(count, gap = 12, opts) {
  const [ref, size] = useElementSize()
  const layout = useMemo(() => {
    const portrait = size.height > 0 && size.height >= size.width
    const resolved = opts ?? galleryGridOpts(count, portrait)
    return computeGridLayout(count, size.width, size.height, gap, resolved)
  }, [count, size.width, size.height, gap, opts])
  return [ref, layout, size]
}
