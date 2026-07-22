import { useEffect, useState } from 'react'

/**
 * Minimal fixed-height row virtualizer (no runtime dependency — reuse-first).
 *
 * Windows a long, uniform-height row list to a bounded set of mounted rows so
 * 200–500 participants scroll at 60fps and row menus/avatars aren't all mounted
 * at once. The People list flattens groups+members to a uniform ROW_H band so
 * offset math stays exact (sticky group headers are rendered by the list, the
 * window math treats every row equally).
 *
 * The window math is a pure function (computeWindow) so it is unit-testable
 * without a DOM.
 */

/**
 * @returns {{start:number, end:number, padTop:number, padBottom:number}}
 *   `end` is exclusive.
 */
export function computeWindow({ scrollTop, viewportH, rowH, count, overscan = 6 }) {
  if (count <= 0 || rowH <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 }
  const first = Math.floor(scrollTop / rowH)
  const visible = Math.ceil(viewportH / rowH)
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, first + visible + overscan)
  return {
    start,
    end,
    padTop: start * rowH,
    padBottom: Math.max(0, (count - end) * rowH),
  }
}

/**
 * The caller owns the scroll-container ref and passes it in (so this hook returns
 * ONLY plain window values, never a ref — keeps render free of ref reads).
 *
 * @param {object} args
 * @param {import('react').RefObject<HTMLElement>} args.scrollRef scroll container
 * @param {number} args.count total rows
 * @param {number} args.rowH row height (px)
 * @param {boolean} args.enabled virtualize only when true (>threshold)
 * @param {number} [args.overscan]
 * @returns {{start:number, end:number, padTop:number, padBottom:number, enabled:boolean}}
 */
export function useVirtualRows({ scrollRef, count, rowH, enabled, overscan = 6 }) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  useEffect(() => {
    const node = scrollRef?.current
    if (!node || !enabled) return undefined
    const onScroll = () => setScrollTop(node.scrollTop)
    // Initial measurement is deferred to a rAF so it does not run synchronously
    // in the effect body (avoids the cascading-render lint + is a paint-safe read).
    const raf = requestAnimationFrame(() => {
      setScrollTop(node.scrollTop)
      setViewportH(node.clientHeight)
    })
    node.addEventListener('scroll', onScroll, { passive: true })

    let ro
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => setViewportH(node.clientHeight))
      ro.observe(node)
    }
    return () => {
      cancelAnimationFrame(raf)
      node.removeEventListener('scroll', onScroll)
      if (ro) ro.disconnect()
    }
  }, [scrollRef, enabled, count])

  if (!enabled) return { start: 0, end: count, padTop: 0, padBottom: 0, enabled: false }
  return { ...computeWindow({ scrollTop, viewportH: viewportH || 600, rowH, count, overscan }), enabled: true }
}
