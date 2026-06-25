import { useCallback, useState } from 'react'
import { Check, Loader2, UserMinus } from 'lucide-react'
import DrawerShell from './DrawerShell.jsx'

/**
 * Host-only waiting-room drawer (dark). Each action (admit / deny / admit-all)
 * shows a spinner and disables its control while in flight, so a host can't fire
 * duplicate requests by double-clicking.
 */
export default function WaitingRoomPanel({ waiting, onAdmit, onDeny, onAdmitAll, onClose }) {
  const [busy, setBusy] = useState(() => new Set())
  const [allBusy, setAllBusy] = useState(false)

  const runFor = useCallback(async (uid, fn) => {
    setBusy((prev) => {
      if (prev.has(uid)) return prev
      const next = new Set(prev)
      next.add(uid)
      return next
    })
    try {
      await fn()
    } finally {
      setBusy((prev) => {
        if (!prev.has(uid)) return prev
        const next = new Set(prev)
        next.delete(uid)
        return next
      })
    }
  }, [])

  const handleAdmitAll = useCallback(async () => {
    if (allBusy) return
    setAllBusy(true)
    try {
      await onAdmitAll()
    } finally {
      setAllBusy(false)
    }
  }, [allBusy, onAdmitAll])

  const subheader = waiting.length > 0 ? (
    <div className="shrink-0 border-b border-[#263244] px-3 py-2">
      <button
        onClick={handleAdmitAll}
        disabled={allBusy}
        aria-busy={allBusy}
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-[#10B981] px-3 text-[13px] font-semibold text-white transition hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {allBusy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Admitting…</> : 'Admit everyone'}
      </button>
    </div>
  ) : null

  return (
    <DrawerShell
      title="Waiting room"
      count={waiting.length > 0 ? waiting.length : undefined}
      onClose={onClose}
      subheader={subheader}
      bodyClassName="px-2 py-2"
    >
      {waiting.length === 0 ? (
        <div className="grid h-full place-items-center px-6 text-center text-[13px] leading-relaxed text-[#94A3B8]">
          No one is waiting to join right now. New requests will appear here.
        </div>
      ) : (
        <ul>
          {waiting.map((w) => (
            <li key={w.user_id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.04]">
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
                style={{ background: w.color || '#7C3AED' }}
              >
                {(w.name || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-white">{w.name || 'Guest'}</div>
                <div className="text-[11px] text-[#94A3B8]">Wants to join</div>
              </div>
              <button
                onClick={() => runFor(w.user_id, () => onDeny(w.user_id))}
                disabled={busy.has(w.user_id)}
                aria-label="Deny"
                title="Deny"
                className="grid h-8 w-8 place-items-center rounded-full border-0 bg-transparent p-0 text-[#94A3B8] shadow-none transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UserMinus className="h-4 w-4" />
              </button>
              <button
                onClick={() => runFor(w.user_id, () => onAdmit(w.user_id))}
                disabled={busy.has(w.user_id)}
                aria-busy={busy.has(w.user_id)}
                aria-label="Admit"
                title="Admit"
                className="grid h-8 w-8 place-items-center rounded-full bg-[#10B981] text-white transition hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy.has(w.user_id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </DrawerShell>
  )
}
