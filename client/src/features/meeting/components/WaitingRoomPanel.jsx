import { X, Check, UserMinus } from 'lucide-react'

export default function WaitingRoomPanel({ waiting, onAdmit, onDeny, onAdmitAll, onClose }) {
  return (
    <aside className="w-80 max-w-[85vw] flex flex-col bg-zinc-900 border-l border-zinc-800 text-zinc-100">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold">
          Waiting room {waiting.length > 0 && <span className="text-zinc-400">({waiting.length})</span>}
        </h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
          title="Close"
        >
          <X size={18} />
        </button>
      </header>

      {waiting.length === 0 ? (
        <div className="flex-1 grid place-items-center text-xs text-zinc-500 px-6 text-center">
          No one is waiting to join.
        </div>
      ) : (
        <>
          <div className="px-4 py-2 border-b border-zinc-800">
            <button
              onClick={onAdmitAll}
              className="w-full text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              Admit everyone
            </button>
          </div>
          <ul className="flex-1 overflow-y-auto divide-y divide-zinc-800">
            {waiting.map((w) => (
              <li key={w.user_id} className="px-4 py-3 flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-full grid place-items-center text-sm font-semibold text-white"
                  style={{ background: w.color || '#5b8def' }}
                >
                  {(w.name || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{w.name || 'Guest'}</div>
                </div>
                <button
                  onClick={() => onAdmit(w.user_id)}
                  className="p-2 rounded bg-emerald-600 hover:bg-emerald-700"
                  title="Admit"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => onDeny(w.user_id)}
                  className="p-2 rounded bg-zinc-700 hover:bg-zinc-600"
                  title="Deny"
                >
                  <UserMinus size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  )
}
