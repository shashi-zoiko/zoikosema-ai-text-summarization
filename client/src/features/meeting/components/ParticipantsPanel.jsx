import { memo, useMemo } from 'react'
import { useParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { Crown, Hand, MicOff, Pin, PinOff, UserMinus, UserPlus, VideoOff, X } from 'lucide-react'
import { useRoomStore } from '../state/roomStore.js'

function identityToUserId(identity) {
  if (!identity || !identity.startsWith('u:')) return null
  const n = Number(identity.slice(2))
  return Number.isFinite(n) ? n : null
}

const ROLE_LABEL = {
  host: 'Host',
  co_host: 'Co-host',
  participant: 'Participant',
}

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

  // Sort: host → co_hosts → others; raised hands bubble up within their tier.
  const sorted = useMemo(() => {
    const rank = (p) => {
      const uid = identityToUserId(p.identity)
      const role = roles.get(uid) || 'participant'
      let base = role === 'host' ? 0 : role === 'co_host' ? 1 : 2
      // raised hands beat non-raised within tier
      if (uid != null && raisedHands.has(uid)) base -= 0.5
      return base
    }
    return [...all].sort((a, b) => rank(a) - rank(b) || a.name?.localeCompare(b.name || '') || 0)
  }, [all, roles, raisedHands])

  return (
    <aside className="w-80 max-w-[85vw] flex flex-col bg-zinc-900 border-l border-zinc-800 text-zinc-100">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold">
          People <span className="text-zinc-400">({sorted.length})</span>
        </h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
          title="Close"
        >
          <X size={18} />
        </button>
      </header>

      <ul className="flex-1 overflow-y-auto divide-y divide-zinc-800">
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

  const micPub = participant.getTrackPublication(Track.Source.Microphone)
  const camPub = participant.getTrackPublication(Track.Source.Camera)
  const micMuted = !micPub || micPub.isMuted
  const camOff = !camPub || camPub.isMuted

  const initials = (participant.name || participant.identity || '?').slice(0, 1).toUpperCase()
  const canKick = isHostOrCohost && !isSelf && !isRowHost
  const canPromote = isHost && !isSelf && !isRowHost

  return (
    <li className="px-3 py-2 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full grid place-items-center text-sm font-semibold bg-zinc-700 text-zinc-200 shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm truncate">{participant.name || 'Guest'}{isSelf && ' (you)'}</span>
          {isRowHost && <Crown size={12} className="text-amber-400 shrink-0" />}
          {raised && <Hand size={12} className="text-amber-400 shrink-0" />}
        </div>
        <div className="text-[10px] text-zinc-500 flex items-center gap-2">
          <span>{ROLE_LABEL[role] || role}</span>
          {micMuted && <MicOff size={10} />}
          {camOff && <VideoOff size={10} />}
        </div>
      </div>
      <RowBtn onClick={onTogglePin} title={pinned ? 'Unpin' : 'Pin'}>
        {pinned ? <PinOff size={12} /> : <Pin size={12} />}
      </RowBtn>
      {canPromote && (
        <RowBtn
          onClick={() => onPromote(uid)}
          title={role === 'co_host' ? 'Demote' : 'Make co-host'}
        >
          <UserPlus size={12} />
        </RowBtn>
      )}
      {canKick && (
        <RowBtn
          onClick={() => onKick(uid, participant.name)}
          title="Remove from meeting"
          destructive
        >
          <UserMinus size={12} />
        </RowBtn>
      )}
    </li>
  )
})

function RowBtn({ onClick, title, destructive, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        'p-1.5 rounded ' +
        (destructive
          ? 'bg-red-600/20 text-red-400 hover:bg-red-600/40'
          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')
      }
    >
      {children}
    </button>
  )
}
