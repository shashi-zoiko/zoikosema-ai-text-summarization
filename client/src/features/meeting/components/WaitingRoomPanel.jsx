import { Check, UserMinus, X } from 'lucide-react'

/**
 * Host-only panel showing pending join requests. Same floating-sidebar
 * chrome as the chat/people panels.
 */
export default function WaitingRoomPanel({ waiting, onAdmit, onDeny, onAdmitAll, onClose }) {
  return (
    <aside className="m-2 flex h-[calc(100%-1rem)] w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl bg-white text-[#202124] shadow-[0_12px_40px_-16px_rgba(0,0,0,0.25)] ring-1 ring-black/[0.06]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.06] px-4">
        <h2 className="text-[15px] font-medium">
          Waiting room {waiting.length > 0 && <span className="text-[#5f6368]">· {waiting.length}</span>}
        </h2>
        <button
          onClick={onClose}
          aria-label="Close waiting room"
          className="grid h-8 w-8 place-items-center rounded-full text-[#5f6368] transition hover:bg-black/[0.06] hover:text-[#202124]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {waiting.length === 0 ? (
        <div className="grid flex-1 place-items-center px-6 text-center text-[13px] leading-relaxed text-[#5f6368]">
          No one is waiting to join right now. New requests will appear here.
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-black/[0.06] px-3 py-2">
            <button
              onClick={onAdmitAll}
              className="inline-flex h-8 w-full items-center justify-center rounded-full bg-[#1a73e8]/12 px-3 text-[13px] font-medium text-[#1a73e8] transition hover:bg-[#1a73e8]/18"
            >
              Admit everyone
            </button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {waiting.map((w) => (
              <li
                key={w.user_id}
                className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-black/[0.04]"
              >
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
                  style={{ background: w.color || '#5b8def' }}
                >
                  {(w.name || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-[#202124]">{w.name || 'Guest'}</div>
                  <div className="text-[11px] text-[#5f6368]">Wants to join</div>
                </div>
                <button
                  onClick={() => onDeny(w.user_id)}
                  aria-label="Deny"
                  title="Deny"
                  className="grid h-8 w-8 place-items-center rounded-full text-[#5f6368] transition hover:bg-black/[0.06] hover:text-[#202124]"
                >
                  <UserMinus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onAdmit(w.user_id)}
                  aria-label="Admit"
                  title="Admit"
                  className="grid h-8 w-8 place-items-center rounded-full bg-[#1a73e8]/12 text-[#1a73e8] transition hover:bg-[#1a73e8]/18"
                >
                  <Check className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
