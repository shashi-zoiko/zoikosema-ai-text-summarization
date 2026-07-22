import { useSyncExternalStore } from 'react'

/**
 * Reactive CSS media-query hook. The client had no JS media-query primitive
 * (only CSS @media + the More Menu's bespoke useMenuGeometry); this is the first
 * shared one, backing the Meeting Center responsive adapter.
 *
 * Uses useSyncExternalStore so it is concurrent-safe and SSR/test-safe (a stub
 * matchMedia is provided in the test setup).
 */
export const BREAKPOINTS = Object.freeze({ sm: 640, md: 768, lg: 1024, xl: 1280 })

function subscribe(query) {
  return (cb) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mql = window.matchMedia(query)
    // Safari <14 uses addListener/removeListener.
    if (mql.addEventListener) mql.addEventListener('change', cb)
    else mql.addListener(cb)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', cb)
      else mql.removeListener(cb)
    }
  }
}

export function useMediaQuery(query) {
  return useSyncExternalStore(
    subscribe(query),
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/** Below the `sm` breakpoint → compact/overlay layout (matches DrawerShell's sm:). */
export function useIsCompact() {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.sm - 1}px)`)
}

/** Honor the OS reduced-motion setting in JS (CSS already handles zk-* animations). */
export function usePrefersReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}
