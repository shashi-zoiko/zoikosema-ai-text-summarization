import { useEffect } from 'react'

/**
 * Standard dialog resource lifecycle (ZS-MTG-IMP-03 §9.1, §15.2).
 *
 * `acquire()` runs once when the dialog opens and returns a disposer that runs
 * exactly once on close (or before re-acquiring when `acquire`'s identity
 * changes). This is the single, identical contract every More-menu dialog uses to
 * acquire → initialize → dispose, so resources release deterministically and
 * uniformly. Pass a `useCallback`-stable `acquire` so the effect runs once per open.
 */
export function useDisposable(acquire) {
  useEffect(() => {
    const dispose = acquire()
    return typeof dispose === 'function' ? dispose : undefined
  }, [acquire])
}
