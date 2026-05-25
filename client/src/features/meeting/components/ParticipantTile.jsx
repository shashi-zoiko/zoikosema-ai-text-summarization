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

  return (
    <div
      onDoubleClick={onPinToggle}
      title="Double-click to pin"
      className="relative rounded-xl overflow-hidden bg-zinc-900 aspect-video shadow ring-2 transition-shadow group"
      style={{
        boxShadow: isSpeaking ? '0 0 0 3px rgb(91 141 239)' : undefined,
      }}
    >
      {hasVideo ? (
        <VideoTrack trackRef={trackRef} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full grid place-items-center text-zinc-400">
          <div className={
            'rounded-full bg-zinc-700 grid place-items-center font-semibold text-zinc-200 ' +
            (isHero ? 'w-24 h-24 text-4xl' : 'w-16 h-16 text-2xl')
          }>
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        </div>
      )}

      <button
        onClick={onPinToggle}
        title={isPinned ? 'Unpin' : 'Pin'}
        className="absolute top-2 right-2 p-1.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-black/70 transition-opacity"
      >
        {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
      </button>

      <QualityBars quality={quality} />


      {raised && (
        <div className="absolute top-2 left-2 bg-amber-500 text-white rounded-full p-1">
          <Hand size={12} />
        </div>
      )}

      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2">
        <span className="text-xs bg-black/60 text-white px-2 py-1 rounded">
          {displayName}
        </span>
        {micMuted && (
          <span className="bg-red-500/90 text-white p-1 rounded">
            <MicOff size={12} />
          </span>
        )}
      </div>
    </div>
  )
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
