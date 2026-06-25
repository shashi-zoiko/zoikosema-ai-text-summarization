import { X } from 'lucide-react'

/**
 * Reusable dark side-drawer shell for the meeting (chat, people, waiting,
 * info, settings). One material, one set of motion + responsive rules:
 *   • desktop  → floating rounded panel docked to the right of the stage
 *   • mobile   → full-screen modal over the stage (spec: chat = full-screen)
 *
 * Slots: `subheader` (sticky, below the title bar) and `footer` (sticky bottom,
 * e.g. the chat composer). `children` is the scrollable body.
 */
export default function DrawerShell({ title, count, onClose, subheader, footer, bodyClassName = '', children }) {
  return (
    <aside
      className={
        'absolute inset-0 z-40 flex flex-col overflow-hidden bg-[#111827] text-white shadow-2xl ' +
        'sm:relative sm:inset-auto sm:z-auto sm:m-2 sm:h-[calc(100%-1rem)] sm:w-[380px] sm:shrink-0 ' +
        'sm:rounded-2xl sm:border sm:border-[#263244]'
      }
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#263244] px-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white">
          {title}
          {count != null && <span className="text-[#94A3B8]">· {count}</span>}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${typeof title === 'string' ? title.toLowerCase() : 'panel'}`}
          className="grid h-8 w-8 place-items-center rounded-full text-[#94A3B8] transition hover:bg-white/[0.06] hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {subheader}

      <div className={'zk-filmstrip min-h-0 flex-1 overflow-y-auto ' + bodyClassName}>
        {children}
      </div>

      {footer}
    </aside>
  )
}
