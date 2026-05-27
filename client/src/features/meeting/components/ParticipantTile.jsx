import { memo, useCallback, useEffect, useState } from 'react'
import {
  VideoTrack,
  useIsSpeaking,
  useParticipantInfo,
  useTrackMutedIndicator,
} from '@livekit/components-react'
import { ConnectionQuality, Track } from 'livekit-client'
import { Hand, MicOff, Pin, PinOff } from 'lucide-react'
import { useRoomStore } from '../state/roomStore.js'

function identityToUserId(identity) {
  if (!identity || !identity.startsWith('u:')) return null
  const n = Number(identity.slice(2))
  return Number.isFinite(n) ? n : null
}

function useConnectionQuality(participant) {
  // LiveKit emits `connectionQualityChanged` per participant. The hook
  // subscribes and returns the current quality so the tile can render bars.
  const [quality, setQuality] = useState(participant?.connectionQuality)
  useEffect(() => {
    if (!participant) return
    setQuality(participant.connectionQuality)
    const onChange = () => setQuality(participant.connectionQuality)
    participant.on('connectionQualityChanged', onChange)
    return () => { participant.off('connectionQualityChanged', onChange) }
  }, [participant])
  return quality
}

function ParticipantTileImpl({ trackRef, isHero }) {
  const { name, identity } = useParticipantInfo({ participant: trackRef.participant })
  const isSpeaking = useIsSpeaking(trackRef.participant)
  const quality = useConnectionQuality(trackRef.participant)
  const { isMuted: micMuted } = useTrackMutedIndicator({
    participant: trackRef.participant,
    source: Track.Source.Microphone,
  })

  const pinnedIdentity = useRoomStore((s) => s.pinnedIdentity)
  const togglePinned = useRoomStore((s) => s.togglePinned)
  const raised = useRoomStore((s) => {
    const uid = identityToUserId(identity)
    return uid != null && s.raisedHands.has(uid)
  })

  const isPinned = pinnedIdentity === identity
  const onPinToggle = useCallback(
    (e) => { e.stopPropagation(); togglePinned(identity) },
    [identity, togglePinned],
  )

  const hasVideo = !!trackRef.publication && !trackRef.publication.isMuted
  const displayName = name || identity || 'Guest'
  // Deterministic colour per identity so the same user always gets the same
  // tile background — Meet does the same trick.
  const avatarColor = pickColor(identity || displayName)

  return (
    <div
      onDoubleClick={onPinToggle}
      title="Double-click to pin"
      className={
        'group relative isolate aspect-video overflow-hidden rounded-2xl bg-[#3c4043] transition-shadow ' +
        (isSpeaking ? 'ring-2 ring-[#8ab4f8]' : 'ring-1 ring-white/5')
      }
    >
      {hasVideo ? (
        <VideoTrack trackRef={trackRef} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div
          className="absolute inset-0 grid place-items-center"
          style={{
            background: `radial-gradient(circle at 50% 35%, ${avatarColor} 0%, color-mix(in srgb, ${avatarColor} 55%, #000) 100%)`,
          }}
        >
          <div className={
            'grid place-items-center rounded-full font-semibold text-white ring-1 ring-white/15 backdrop-blur-sm bg-white/[0.08] ' +
            (isHero ? 'h-36 w-36 text-5xl' : 'h-24 w-24 text-3xl')
          }>
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        </div>
      )}

      {/* Hand raised — top-left */}
      {raised && (
        <div className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-amber-400 text-zinc-900 shadow-md" title="Hand raised">
          <Hand className="h-4 w-4" />
        </div>
      )}

      {/* Mic-off badge — top-right (matches Meet) */}
      {micMuted && (
        <div className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm" title="Muted">
          <MicOff className="h-3.5 w-3.5 text-[#ea4335]" />
        </div>
      )}

      {/* Pin button — hover-revealed, slides left when mic-off badge present */}
      <button
        onClick={onPinToggle}
        aria-label={isPinned ? 'Unpin' : 'Pin'}
        title={isPinned ? 'Unpin' : 'Pin to main view'}
        className={
          'absolute top-3 grid h-9 w-9 place-items-center rounded-full transition ' +
          (micMuted ? 'right-12 ' : 'right-3 ') +
          (isPinned
            ? 'bg-[#8ab4f8]/20 text-[#8ab4f8] opacity-100'
            : 'bg-black/55 text-white/85 opacity-0 backdrop-blur hover:bg-black/70 group-hover:opacity-100')
        }
      >
        {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
      </button>

      <QualityBars quality={quality} />

      {/* Bottom name pill */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
        <div className="flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-[12.5px] font-medium text-white backdrop-blur-sm">
          <span className="truncate">{displayName}</span>
        </div>
      </div>
    </div>
  )
}

// Cheap deterministic colour hash. Same algorithm we use in the chat avatar
// helper so a participant looks the same across rooms.
const COLORS = ['#5b8def', '#a16cf4', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#f472b6']
function pickColor(seed) {
  if (!seed) return COLORS[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}

export const ParticipantTile = memo(
  ParticipantTileImpl,
  (a, b) =>
    a.trackRef.publication?.trackSid === b.trackRef.publication?.trackSid &&
    a.isHero === b.isHero,
)

function QualityBars({ quality }) {
  // EXCELLENT=2, GOOD=1, POOR=0, LOST=-1, UNKNOWN=undefined. We render three
  // bars and fill 1-3 based on quality. Lost = red, others = ascending green.
  if (quality === undefined || quality === ConnectionQuality.Excellent) {
    // Hide chrome when quality is good — fewer pixels for the common case.
    return null
  }
  const tone =
    quality === ConnectionQuality.Lost
      ? 'bg-red-500'
      : quality === ConnectionQuality.Poor
        ? 'bg-amber-500'
        : 'bg-emerald-500'
  const fillBars =
    quality === ConnectionQuality.Lost ? 1
      : quality === ConnectionQuality.Poor ? 1
        : 2 // Good
  return (
    <div className="absolute bottom-2 right-2 flex items-end gap-0.5 bg-black/60 rounded px-1 py-0.5" title={`Network: ${quality}`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={
            `block w-1 rounded-sm ${i <= fillBars ? tone : 'bg-zinc-600'}`
          }
          style={{ height: `${i * 4 + 2}px` }}
        />
      ))}
    </div>
  )
}
