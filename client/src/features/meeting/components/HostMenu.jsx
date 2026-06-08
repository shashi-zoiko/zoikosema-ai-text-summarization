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
        className="px-3 py-2 rounded-full border border-black/[0.08] bg-white shadow-sm hover:bg-[#f1f3f4] text-xs font-medium text-[#444746] flex items-center gap-1"
      >
        Host
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl bg-white border border-black/[0.06] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)] z-30 overflow-hidden">
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
          <div className="border-t border-black/[0.06]" />
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
        'w-full px-3 py-2 text-left text-sm flex items-center gap-2 ' +
        (destructive ? 'text-[#d93829] hover:bg-[#ea4335]/10' : 'text-[#202124] hover:bg-black/[0.05]')
      }
    >
      <span className="text-[#5f6368]">{icon}</span>
      {label}
    </button>
  )
}
