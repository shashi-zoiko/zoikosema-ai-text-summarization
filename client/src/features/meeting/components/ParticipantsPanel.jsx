import { memo, useMemo } from 'react'
import { useParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { Crown, Hand, MicOff, Pin, PinOff, ShieldCheck, UserMinus, UserPlus, VideoOff } from 'lucide-react'
import { useRoomStore } from '../state/roomStore.js'
import DrawerShell from './DrawerShell.jsx'
import GuestBadge, { isGuestParticipant } from './GuestBadge.jsx'

function identityToUserId(identity) {
  if (!identity || !identity.startsWith('u:')) return null
  const n = Number(identity.slice(2))
  return Number.isFinite(n) ? n : null
}

const ROLE_LABEL = {
  host: 'Meeting host',
  co_host: 'Co-host',
  participant: 'Participant',
}

/**
 * Teams-style people drawer (dark). Rows are tap-friendly; pin/promote/kick
 * controls fade in on hover. Order: host → co-host → everyone else, with raised
 * hands bubbling within their tier.
 */
export default function ParticipantsPanel({ selfUserId, isHost, isHostOrCohost, onClose, onKick, onPromote }) {
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
    <DrawerShell title="People" count={sorted.length} onClose={onClose} bodyClassName="px-2 py-2">
      <ul>
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
    </DrawerShell>
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
  const isGuest = isGuestParticipant(participant)
  const avatarColor = pickColor(participant.identity || name)
  const canKick = isHostOrCohost && !isSelf && !isRowHost
  const canPromote = isHost && !isSelf && !isRowHost

  return (
    <li className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.04]">
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
        style={{ backgroundColor: avatarColor }}
      >{initial}</div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-white">
          <span className="truncate">{name}{isSelf && ' (you)'}</span>
          {isGuest && <GuestBadge />}
          {isRowHost && <Crown className="h-3 w-3 shrink-0 text-[#FBBF24]" title="Host" />}
          {isRowCohost && <ShieldCheck className="h-3 w-3 shrink-0 text-[#22D3EE]" title="Co-host" />}
          {raised && <Hand className="h-3 w-3 shrink-0 text-[#FBBF24]" title="Hand raised" />}
        </div>
        <div className="text-[11px] text-[#94A3B8]">{ROLE_LABEL[role]}</div>
      </div>

      <div className="flex items-center gap-1 text-[#64748B]">
        {micMuted && <MicOff className="h-3.5 w-3.5" />}
        {camOff && <VideoOff className="h-3.5 w-3.5" />}
      </div>

      <div className="ml-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <RowBtn onClick={onTogglePin} title={pinned ? 'Unpin' : 'Pin to main view'}>
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </RowBtn>
        {canPromote && (
          <RowBtn onClick={() => onPromote(uid)} title={isRowCohost ? 'Demote' : 'Make co-host'}>
            <UserPlus className="h-3.5 w-3.5" />
          </RowBtn>
        )}
        {canKick && (
          <RowBtn onClick={() => onKick(uid, participant.name)} title="Remove from meeting" destructive>
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
        'grid h-7 w-7 place-items-center rounded-full border-0 bg-transparent p-0 shadow-none transition ' +
        (destructive
          ? 'text-[#F87171] hover:bg-[#EF4444]/15'
          : 'text-[#94A3B8] hover:bg-white/[0.08] hover:text-white')
      }
    >
      {children}
    </button>
  )
}

const COLORS = ['#7C3AED', '#2563EB', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#3B82F6', '#8B5CF6']
function pickColor(seed) {
  if (!seed) return COLORS[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}
