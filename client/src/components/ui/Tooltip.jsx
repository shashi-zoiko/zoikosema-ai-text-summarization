import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '../../lib/cn'

/**
 * Lightweight tooltip — appears on hover/focus, dismisses on blur/leave.
 * No external dependency on Radix to keep bundle tight.
 */
export default function Tooltip({
  content,
  shortcut,
  children,
  side = 'top',
  delay = 250,
  className,
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const timer = useRef(null)
  const id = useId()

  const show = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!triggerRef.current) return
      const r = triggerRef.current.getBoundingClientRect()
      const offset = 10
      let top = r.top - offset
      let left = r.left + r.width / 2
      if (side === 'bottom') top = r.bottom + offset
      if (side === 'left') { top = r.top + r.height / 2; left = r.left - offset }
      if (side === 'right') { top = r.top + r.height / 2; left = r.right + offset }
      setPos({ top, left })
      setOpen(true)
    }, delay)
  }
  const hide = () => { clearTimeout(timer.current); setOpen(false) }
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!content) return children

  const transform =
    side === 'top'    ? 'translate(-50%, -100%)' :
    side === 'bottom' ? 'translate(-50%, 0)'     :
    side === 'left'   ? 'translate(-100%, -50%)' :
                        'translate(0, -50%)'

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? id : undefined}
        className="contents"
      >
        {children}
      </span>
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              id={id}
              role="tooltip"
              initial={{ opacity: 0, y: side === 'top' ? 4 : side === 'bottom' ? -4 : 0, x: side === 'left' ? 4 : side === 'right' ? -4 : 0, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              style={{ position: 'fixed', top: pos.top, left: pos.left, transform, zIndex: 9999, pointerEvents: 'none' }}
              className={cn(
                'relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] font-medium',
                'bg-[#0a0c12]/95 text-white border border-white/10 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)] backdrop-blur-md',
                className
              )}
            >
              <span>{content}</span>
              {shortcut && (
                <kbd className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/70 font-mono">
                  {shortcut}
                </kbd>
              )}
              {/* arrow tip */}
              <span
                aria-hidden
                className={cn(
                  'absolute h-2 w-2 rotate-45 border-white/10 bg-[#0a0c12]/95',
                  side === 'top'    && 'left-1/2 bottom-[-4px] -translate-x-1/2 border-b border-r',
                  side === 'bottom' && 'left-1/2 top-[-4px] -translate-x-1/2 border-t border-l',
                  side === 'left'   && 'top-1/2 right-[-4px] -translate-y-1/2 border-t border-r',
                  side === 'right'  && 'top-1/2 left-[-4px] -translate-y-1/2 border-b border-l',
                )}
              />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
