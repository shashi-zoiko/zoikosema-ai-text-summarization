import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Singular overlay host for the meeting surface (ZS-MTG-IMP-03 §6.1).
 *
 * One portal, one z-index stack, one dismissal + focus-return owner — the single
 * entry point that feature packages open overlays through instead of minting their
 * own portals. Generic on purpose: the More menu is the first consumer, but device
 * menus, the reaction picker and dialogs can migrate onto it later.
 *
 * Inert when idle: with no open overlay it renders NO portal node and attaches NO
 * document listeners, so mounting the provider is a no-op until something opens.
 *
 * Dismissal side-effects (onClose + focus restore) run OUTSIDE React's render/
 * reducer — `openOverlay` returns a `close()` handle bound to its own entry, so no
 * ref is read during render and the state updater stays pure.
 *
 * Positioning is intentionally NOT owned here — each overlay positions itself.
 */

// Exported so consumers can OPTIONALLY detect a host (useContext) and degrade to
// an inline overlay when rendered outside a provider (e.g. isolated tests),
// instead of the throwing useOverlayHost().
export const OverlayHostContext = createContext(null)

export function useOverlayHost() {
  const ctx = useContext(OverlayHostContext)
  if (!ctx) throw new Error('useOverlayHost must be used within <OverlayHostProvider>')
  return ctx
}

let seq = 0
const nextId = () => `overlay-${++seq}`

export function OverlayHostProvider({ children }) {
  const [overlays, setOverlays] = useState([])

  // Close a specific entry: pure state removal, then side-effects (owner notify +
  // focus restore) outside the reducer. `entry` is always in scope at call sites.
  const dismiss = useCallback((entry) => {
    if (!entry) return
    setOverlays((list) => list.filter((o) => o.id !== entry.id))
    entry.onClose?.()
    const el = entry.restoreEl
    if (el && typeof el.focus === 'function' && document.contains(el)) {
      requestAnimationFrame(() => { try { el.focus() } catch { /* element gone */ } })
    }
  }, [])

  const openOverlay = useCallback((opts) => {
    const id = opts.id || nextId()
    const entry = {
      id,
      render: opts.render,
      onClose: opts.onClose,
      dismissOnOutside: opts.dismissOnOutside !== false,
      ignoreRef: opts.ignoreRef || null, // trigger element: clicks on it don't dismiss
      restoreEl: opts.restoreFocus === false ? null : document.activeElement,
    }
    entry.close = () => dismiss(entry)
    // Same id re-open replaces the prior entry (toggle-safe, no duplicate portal).
    setOverlays((list) => [...list.filter((o) => o.id !== id), entry])
    return { id, close: entry.close }
  }, [dismiss])

  // Escape closes the top overlay; outside pointer-down dismisses the top overlay
  // when it opted in. Attached only while at least one overlay is open — the effect
  // re-subscribes whenever the stack changes, so the closure always sees the top.
  useEffect(() => {
    if (!overlays.length) return undefined
    const topOverlay = overlays[overlays.length - 1]

    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      dismiss(topOverlay)
    }
    const onDown = (e) => {
      if (!topOverlay.dismissOnOutside) return
      const content = document.querySelector(`[data-zk-overlay="${topOverlay.id}"]`)
      const ignore = topOverlay.ignoreRef?.current
      const inContent = content && content.contains(e.target)
      const inIgnore = ignore && ignore.contains(e.target)
      if (!inContent && !inIgnore) dismiss(topOverlay)
    }

    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [overlays, dismiss])

  const value = useMemo(() => ({ openOverlay }), [openOverlay])

  return (
    <OverlayHostContext.Provider value={value}>
      {children}
      {overlays.length > 0 && createPortal(
        <div data-zk-overlay-host="">
          {overlays.map((o) => (
            <div key={o.id} data-zk-overlay={o.id}>
              {o.render({ close: o.close })}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </OverlayHostContext.Provider>
  )
}
