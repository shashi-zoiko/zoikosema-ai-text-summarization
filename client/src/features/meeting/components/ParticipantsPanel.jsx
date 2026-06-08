import { memo, useMemo } from 'react'
import { useParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { Crown, Hand, MicOff, Pin, PinOff, ShieldCheck, UserMinus, UserPlus, VideoOff, X } from 'lucide-react'
import { useRoomStore } from '../state/roomStore.js'

function identityToUserId(identity) {
  if (!identity || !identity.startsWith('u:')) return null
  const n = Number(identity.slice(2))
  return Number.isFinite(n) ? n : null
}

const ROLE_LABEL = {
  host: 'Meeting host',
  co_host: 'Co-host',
  participant: '',
}

/**
 * Meet-style people panel. Rows are tap-friendly; pin/promote/kick controls
 * fade in on hover so the rest line stays calm. Order is host → co-host →
 * everyone else, with raised hands bubbling within their tier.
 */
export default function ParticipantsPanel({
  selfUserId,
  isHost,
  isHostOrCohost,
  onClose,
  onKick,
  onPromote,
}) {
  const all = useParticipants()
  const pinnedIdentity = useRoomStore((s) => s.pinnedIdentity)
  const togglePinned = useRoomStore((s) => s.togglePinned)
  const raisedHands = useRoomStore((s) => s.raisedHands)
  const roles = useRoomStore((s) => s.roles)

  const sorted = useMemo(() => {
    const rank = (p) => {
      const uid = identityToUserId(p.identity)
      const role = roles.get(uid) || 'participant'
      let base = role === 'host' ? 0 : role === 'co_host' ? 1 : 2
      if (uid != null && raisedHands.has(uid)) base -= 0.5
      return base
    }
    return [...all].sort((a, b) => rank(a) - rank(b) || a.name?.localeCompare(b.name || '') || 0)
  }, [all, roles, raisedHands])

  return (
    <aside className="m-2 flex h-[calc(100%-1rem)] w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl bg-white text-[#202124] shadow-[0_12px_40px_-16px_rgba(0,0,0,0.25)] ring-1 ring-black/[0.06]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.06] px-4">
        <h2 className="text-[15px] font-medium">
          People <span className="text-[#5f6368]">· {sorted.length}</span>
        </h2>
        <button
          onClick={onClose}
          aria-label="Close people panel"
          className="grid h-8 w-8 place-items-center rounded-full text-[#5f6368] transition hover:bg-black/[0.06] hover:text-[#202124]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {sorted.map((p) => (
          <ParticipantRow
            key={p.identity}
            participant={p}
            selfUserId={selfUserId}
            isHost={isHost}
            isHostOrCohost={isHostOrCohost}
            role={roles.get(identityToUserId(p.identity)) || 'participant'}
            raised={raisedHands.has(identityToUserId(p.identity))}
            pinned={pinnedIdentity === p.identity}
            onTogglePin={() => togglePinned(p.identity)}
            onKick={onKick}
            onPromote={onPromote}
          />
        ))}
      </ul>
    </aside>
  )
}

const ParticipantRow = memo(function ParticipantRow({
  participant, selfUserId, isHost, isHostOrCohost, role, raised, pinned, onTogglePin, onKick, onPromote,
}) {
  const uid = identityToUserId(participant.identity)
  const isSelf = uid === selfUserId
  const isRowHost = role === 'host'
  const isRowCohost = role === 'co_host'

  const micPub = participant.getTrackPublication(Track.Source.Microphone)
  const camPub = participant.getTrackPublication(Track.Source.Camera)
  const micMuted = !micPub || micPub.isMuted
  const camOff = !camPub || camPub.isMuted

  const name = participant.name || participant.identity || 'Guest'
  const initial = name.slice(0, 1).toUpperCase()
  const avatarColor = pickColor(participant.identity || name)
  const canKick = isHostOrCohost && !isSelf && !isRowHost
  const canPromote = isHost && !isSelf && !isRowHost

  return (
    <li className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-black/[0.04]">
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
        style={{ backgroundColor: avatarColor }}
      >{initial}</div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-[#202124]">
          <span className="truncate">{name}{isSelf && ' (you)'}</span>
          {isRowHost && <Crown className="h-3 w-3 shrink-0 text-amber-500" title="Host" />}
          {isRowCohost && <ShieldCheck className="h-3 w-3 shrink-0 text-cyan-600" title="Co-host" />}
          {raised && <Hand className="h-3 w-3 shrink-0 text-amber-500" title="Hand raised" />}
        </div>
        {ROLE_LABEL[role] && (
          <div className="text-[11px] text-[#5f6368]">{ROLE_LABEL[role]}</div>
        )}
      </div>

      <div className="flex items-center gap-1 text-[#5f6368]">
        {micMuted && <MicOff className="h-3.5 w-3.5 text-[#9aa0a6]" />}
        {camOff && <VideoOff className="h-3.5 w-3.5 text-[#9aa0a6]" />}
      </div>

      <div className="ml-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <RowBtn onClick={onTogglePin} title={pinned ? 'Unpin' : 'Pin to main view'}>
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </RowBtn>
        {canPromote && (
          <RowBtn
            onClick={() => onPromote(uid)}
            title={isRowCohost ? 'Demote' : 'Make co-host'}
          >
            <UserPlus className="h-3.5 w-3.5" />
          </RowBtn>
        )}
        {canKick && (
          <RowBtn
            onClick={() => onKick(uid, participant.name)}
            title="Remove from meeting"
            destructive
          >
            <UserMinus className="h-3.5 w-3.5" />
          </RowBtn>
        )}
      </div>
    </li>
  )
})

function RowBtn({ onClick, title, destructive, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        'grid h-7 w-7 place-items-center rounded-full transition ' +
        (destructive
          ? 'text-[#ea4335] hover:bg-[#ea4335]/12'
          : 'text-[#5f6368] hover:bg-black/[0.06] hover:text-[#202124]')
      }
    >
      {children}
    </button>
  )
}

const COLORS = ['#5b8def', '#a16cf4', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#f472b6']
function pickColor(seed) {
  if (!seed) return COLORS[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}
