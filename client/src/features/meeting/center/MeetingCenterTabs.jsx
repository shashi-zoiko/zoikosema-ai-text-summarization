import { useRef } from 'react'

/**
 * WCAG 2.2 tablist for the Meeting Center. Manual activation (Arrow/Home/End move
 * focus via roving tabindex; Enter/Space/click activate) so lazy tab modules
 * aren't loaded just by arrowing past them. Only available tabs are rendered.
 *
 * @param {{tabs: Array<{id,label,badge}>, activeTab: string, onSelect:(id)=>void}} props
 */
export default function MeetingCenterTabs({ tabs, activeTab, onSelect }) {
  const refs = useRef([])

  const onKeyDown = (e, index) => {
    let next = null
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(tabs[index].id); return }
    if (next != null) {
      e.preventDefault()
      refs.current[next]?.focus()
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Meeting Center sections"
      aria-orientation="horizontal"
      className="flex items-center gap-1 border-b border-[#263244] px-2"
    >
      {tabs.map((t, i) => {
        const selected = t.id === activeTab
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el }}
            role="tab"
            id={`zk-center-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`zk-center-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={
              'relative flex items-center gap-1.5 !border-0 !bg-transparent !shadow-none px-3 py-2.5 text-[13px] font-medium transition ' +
              (selected ? 'text-white' : 'text-[#94A3B8] hover:text-white')
            }
          >
            {t.label}
            {t.badge > 0 && (
              <span
                aria-label={`${t.badge} pending`}
                className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-[#10B981] px-1 text-[10px] font-bold leading-4 text-[#04140D]"
              >
                {t.badge > 99 ? '99+' : t.badge}
              </span>
            )}
            {selected && <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#10B981]" />}
          </button>
        )
      })}
    </div>
  )
}
