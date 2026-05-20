import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { cn } from '../../lib/cn'

const ToastContext = createContext({ toast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

let _id = 0
const nextId = () => ++_id

const icons = {
  success: <CheckCircle2 className="h-5 w-5 text-[var(--c-success)]" />,
  error:   <XCircle      className="h-5 w-5 text-[var(--c-danger)]"  />,
  warning: <AlertCircle  className="h-5 w-5 text-[var(--c-warn)]"    />,
  info:    <Info         className="h-5 w-5 text-[var(--c-accent)]"  />,
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setItems((xs) => xs.filter((x) => x.id !== id))
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
  }, [])

  const toast = useCallback((opts) => {
    const id = nextId()
    const item = { id, variant: 'info', duration: 4200, ...opts }
    setItems((xs) => [...xs, item])
    if (item.duration > 0) {
      const t = setTimeout(() => dismiss(id), item.duration)
      timers.current.set(id, t)
    }
    return id
  }, [dismiss])

  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)) }, [])

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {typeof document !== 'undefined' && createPortal(
        <div
          className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2"
          aria-live="polite"
          aria-atomic="true"
        >
          <AnimatePresence>
            {items.map((it) => (
              <motion.div
                key={it.id}
                role="status"
                layout
                initial={{ opacity: 0, x: 24, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.97 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 shadow-2xl backdrop-blur-md',
                  'bg-[color-mix(in_srgb,var(--c-surface)_85%,transparent)] border-[var(--c-line-strong)] text-[var(--c-fg)]'
                )}
              >
                <span className="mt-0.5 shrink-0">{icons[it.variant]}</span>
                <div className="min-w-0 flex-1">
                  {it.title && <div className="text-[13.5px] font-semibold tracking-tight">{it.title}</div>}
                  {it.description && (
                    <div className={cn('text-[12.5px] text-[var(--c-fg-muted)] leading-snug', it.title && 'mt-0.5')}>
                      {it.description}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => dismiss(it.id)}
                  aria-label="Dismiss"
                  className="ml-1 rounded-md p-1 text-[var(--c-fg-muted)] transition hover:bg-white/5 hover:text-[var(--c-fg)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}
