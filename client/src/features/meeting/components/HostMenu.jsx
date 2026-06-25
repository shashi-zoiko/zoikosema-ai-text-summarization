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
        className="flex h-9 items-center gap-1 rounded-full border border-[#263244] bg-[#111827] px-3 text-xs font-medium text-[#94A3B8] transition hover:bg-[#1E293B] hover:text-white"
      >
        Host
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="zk-glass zk-pop-in absolute right-0 z-30 mt-2 w-60 origin-top-right overflow-hidden rounded-xl">
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
          <div className="mx-2 my-1 h-px bg-[#263244]" />
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
        'flex w-full items-center gap-2.5 border-0 bg-transparent px-3 py-2.5 text-left text-sm shadow-none transition-colors ' +
        (destructive ? 'text-[#F87171] hover:bg-[#EF4444]/12' : 'text-white/90 hover:bg-white/[0.06]')
      }
    >
      <span className={destructive ? 'text-[#F87171]' : 'text-[#94A3B8]'}>{icon}</span>
      {label}
    </button>
  )
}
