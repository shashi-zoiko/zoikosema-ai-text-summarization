import { useEffect, useRef } from 'react'

/**
 * WCAG 2.2 focus trap for a modal/overlay region. The client had no focus-trap
 * primitive (OverlayHost only does focus RESTORE, Modal does neither); this is
 * the shared one used by the Meeting Center overlay drawer and row menus.
 *
 * When `active`, Tab/Shift-Tab cycle within the container, initial focus moves
 * inside, and focus is restored to the previously-focused element on release.
 *
 * @param {boolean} active
 * @returns {import('react').RefObject<HTMLElement>} ref to attach to the region
 */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useFocusTrap(active) {
  const ref = useRef(null)

  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node || typeof document === 'undefined') return

    const previouslyFocused = document.activeElement

    const focusables = () =>
      Array.from(node.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)

    // Move focus inside (first focusable, else the container itself).
    const initial = focusables()[0] || node
    if (initial && typeof initial.focus === 'function') {
      if (initial === node && !node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1')
      initial.focus()
    }

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const activeEl = document.activeElement
      if (e.shiftKey && (activeEl === first || activeEl === node)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault()
        first.focus()
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      // Restore focus to where it was before the trap engaged.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [active])

  return ref
}
