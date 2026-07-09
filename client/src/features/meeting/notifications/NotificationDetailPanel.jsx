import { useEffect, useRef } from 'react'
import { Ban, Check, Shield, ShieldCheck, Sparkles, X } from 'lucide-react'
import { cn } from '../../../lib/cn'

/**
 * One theme-aware side drawer that renders the Policy / Trust Center /
 * Connection details content (data-driven — see getPanelContent). Opening it
 * never blocks the join flow: it's an overlay, Escape / backdrop close it, and
 * the meeting form stays mounted underneath.
 */

const ICONS = { shield: Shield, secure: ShieldCheck, ai: Sparkles }
const TONE = {
  amber: 'bg-[var(--lobby-warn-tint)] text-[var(--lobby-warn-fg)]',
  green: 'bg-[var(--lobby-success-tint)] text-[var(--lobby-success-fg)]',
  purple: 'bg-[var(--lobby-accent-tint)] text-[var(--lobby-accent-fg)]',
}

export default function NotificationDetailPanel({ content, onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    if (!content) return undefined
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [content, onClose])

  if (!content) return null
  const Icon = ICONS[content.icon] || Shield

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 cursor-default border-0 bg-black/40 p-0 shadow-none backdrop-blur-sm"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        className="zk-themed zk-drawer-enter relative z-10 flex h-full w-full max-w-[400px] flex-col bg-[var(--c-surface)] shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-[var(--c-line)] px-5 py-4">
          <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', TONE[content.tone] || TONE.purple)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="flex-1 text-[16px] font-bold text-[var(--c-fg)]">{content.title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-[var(--c-fg-muted)] transition hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {content.sections.map((s, i) => {
            const Marker = s.negative ? Ban : Check
            return (
              <section key={s.heading || i}>
                {s.heading && (
                  <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--c-fg-muted)]">{s.heading}</h3>
                )}
                {s.body && <p className="text-[13px] leading-relaxed text-[var(--c-fg-dim)]">{s.body}</p>}
                {s.list && (
                  <ul className="space-y-1.5">
                    {s.list.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-[13px] text-[var(--c-fg-dim)]">
                        <Marker className={cn('h-3.5 w-3.5 shrink-0', s.negative ? 'text-[var(--c-fg-muted)]' : 'text-[var(--lobby-success-fg)]')} aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </aside>
    </div>
  )
}
