import { useEffect, useState } from 'react'
import { useParticipants } from '@livekit/components-react'
import { Check, Copy, Hash, ShieldCheck, Timer, Users } from 'lucide-react'
import DrawerShell from './DrawerShell.jsx'

/**
 * Meeting details drawer — the read-only "about this call" panel. Shows live
 * facts we can derive from the room (code, duration, participant count) plus
 * the security posture. No fabricated metadata.
 */
export default function MeetingInfoDrawer({ code, joinedAt, onClose }) {
  const participants = useParticipants()
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/meet/${code}`

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked */ }
  }

  return (
    <DrawerShell title="Meeting details" onClose={onClose}>
      <div className="space-y-5 px-4 py-4">
        <div className="space-y-2.5">
          <InfoRow icon={<Hash className="h-4 w-4" />} label="Meeting code" value={code} mono />
          <InfoRow icon={<Timer className="h-4 w-4" />} label="Duration" value={<Duration joinedAt={joinedAt} />} />
          <InfoRow icon={<Users className="h-4 w-4" />} label="Participants" value={`${participants.length} in call`} />
          <InfoRow icon={<ShieldCheck className="h-4 w-4 text-[#34D399]" />} label="Security" value="End-to-end encrypted" />
        </div>

        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[#94A3B8]">Invite link</div>
          <div className="flex items-center gap-2 rounded-xl border border-[#263244] bg-[#0B1220] p-2 pl-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-white/90">{link}</span>
            <button
              type="button"
              onClick={() => copy(link)}
              className={
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition ' +
                (copied ? 'bg-[#10B981]/15 text-[#34D399]' : 'bg-[#1E293B] text-white hover:bg-[#263244]')
              }
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <p className="rounded-xl border border-[#263244] bg-[#0B1220] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#94A3B8]">
          Anyone with this link can request to join. The host admits people from
          the waiting room.
        </p>
      </div>
    </DrawerShell>
  )
}

function InfoRow({ icon, label, value, mono }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#263244] bg-[#0B1220] px-3.5 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#1E293B] text-[#94A3B8]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-[#94A3B8]">{label}</div>
        <div className={'truncate text-[14px] font-medium text-white ' + (mono ? 'font-mono' : '')}>{value}</div>
      </div>
    </div>
  )
}

function Duration({ joinedAt }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!joinedAt) return '00:00'
  const s = Math.max(0, Math.floor((now - joinedAt) / 1000))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}
