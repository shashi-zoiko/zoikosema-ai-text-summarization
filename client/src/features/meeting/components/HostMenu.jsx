import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Lock, Unlock, MessageSquare, Monitor, PhoneOff } from 'lucide-react'

export default function HostMenu({ meeting, onToggleLock, onToggleChat, onToggleScreenshare, onEndMeeting }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-xs font-medium text-zinc-100 flex items-center gap-1"
      >
        Host
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-lg bg-zinc-900 border border-zinc-800 shadow-lg z-30 overflow-hidden">
          <Item
            icon={meeting.locked ? <Unlock size={14} /> : <Lock size={14} />}
            label={meeting.locked ? 'Unlock meeting' : 'Lock meeting'}
            onClick={() => { onToggleLock(!meeting.locked); setOpen(false) }}
          />
          <Item
            icon={<MessageSquare size={14} />}
            label={meeting.chat_enabled ? 'Disable chat' : 'Enable chat'}
            onClick={() => { onToggleChat(!meeting.chat_enabled); setOpen(false) }}
          />
          <Item
            icon={<Monitor size={14} />}
            label={meeting.screenshare_enabled ? 'Disable screen share' : 'Enable screen share'}
            onClick={() => { onToggleScreenshare(!meeting.screenshare_enabled); setOpen(false) }}
          />
          <div className="border-t border-zinc-800" />
          <Item
            icon={<PhoneOff size={14} />}
            label="End meeting for all"
            destructive
            onClick={() => { onEndMeeting(); setOpen(false) }}
          />
        </div>
      )}
    </div>
  )
}

function Item({ icon, label, onClick, destructive }) {
  return (
    <button
      onClick={onClick}
      className={
        'w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-zinc-800 ' +
        (destructive ? 'text-red-400 hover:bg-red-950/40' : 'text-zinc-200')
      }
    >
      <span className="text-zinc-400">{icon}</span>
      {label}
    </button>
  )
}
