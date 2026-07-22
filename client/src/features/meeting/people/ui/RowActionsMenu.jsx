import { useContext, useRef, useState, useEffect, useCallback } from 'react'
import { MoreVertical } from 'lucide-react'
import { OverlayHostContext } from '../../more/OverlayHost.jsx'

/**
 * Row overflow menu. Lazy: the menu panel mounts ONLY while open (never all row
 * menus at once — spec §Virtualization). Reuses the single OverlayHost when one
 * is present (no parallel portal); falls back to an inline popover otherwise
 * (isolated tests). Keyboard: Arrow/Home/End/Escape, roving tabindex.
 *
 * @param {{items: Array<{id,label,onSelect,danger?,disabled?}>, label?: string}} props
 */
export default function RowActionsMenu({ items, label = 'More actions' }) {
  const host = useContext(OverlayHostContext)
  const triggerRef = useRef(null)
  const [inlineOpen, setInlineOpen] = useState(false)
  const closeRef = useRef(null)

  const enabledItems = items.filter((i) => !i.disabled)

  const openViaHost = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    const { close } = host.openOverlay({
      ignoreRef: triggerRef,
      restoreFocus: true,
      render: ({ close }) => (
        <MenuPanel items={items} anchorRect={rect} onClose={close} label={label} />
      ),
    })
    closeRef.current = close
  }, [host, items, label])

  const onTrigger = () => {
    if (host) openViaHost()
    else setInlineOpen((v) => !v)
  }

  if (enabledItems.length === 0) return null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={inlineOpen || undefined}
        onClick={onTrigger}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full !bg-transparent !border-0 !p-0 !shadow-none text-[#94A3B8] transition hover:!bg-white/10 hover:text-white"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {!host && inlineOpen && (
        <MenuPanel items={items} inline onClose={() => setInlineOpen(false)} label={label} restoreTo={triggerRef} />
      )}
    </>
  )
}

function MenuPanel({ items, anchorRect, inline, onClose, label, restoreTo }) {
  const ref = useRef(null)
  const visible = items.filter((i) => !i.disabled)

  useEffect(() => {
    // Initial focus + restore on close (inline path; OverlayHost owns restore for
    // the hosted path).
    const first = ref.current?.querySelector('[role="menuitem"]')
    first?.focus()
    const restoreEl = restoreTo?.current
    return () => {
      if (inline && restoreEl && typeof restoreEl.focus === 'function') restoreEl.focus()
    }
  }, [inline, restoreTo])

  const onKeyDown = (e) => {
    const nodes = Array.from(ref.current?.querySelectorAll('[role="menuitem"]') || [])
    const idx = nodes.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); nodes[(idx + 1) % nodes.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nodes[(idx - 1 + nodes.length) % nodes.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); nodes[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); nodes[nodes.length - 1]?.focus() }
    else if (e.key === 'Escape' && inline) { e.preventDefault(); onClose?.() }
  }

  const style = anchorRect
    ? { position: 'fixed', top: Math.round(anchorRect.bottom + 4), left: Math.round(Math.max(8, anchorRect.right - 200)), width: 200 }
    : undefined

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={style}
      className={
        (inline ? 'absolute right-0 top-9 ' : '') +
        'z-[60] w-[200px] overflow-hidden rounded-xl border border-[#263244] bg-[#111827] py-1 shadow-2xl'
      }
    >
      {visible.map((item) => (
        <button
          key={item.id}
          role="menuitem"
          tabIndex={-1}
          type="button"
          onClick={() => { item.onSelect?.(); onClose?.() }}
          className={
            'flex w-full items-center gap-2 !bg-transparent !border-0 !shadow-none px-3 py-2 text-left text-[13px] ' +
            (item.danger ? 'text-red-300 hover:!bg-red-500/10' : 'text-white hover:!bg-white/10')
          }
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
