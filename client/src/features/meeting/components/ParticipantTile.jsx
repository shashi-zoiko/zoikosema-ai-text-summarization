import { memo, useCallback, useEffect, useState } from 'react'
import {
  VideoTrack,
  useIsSpeaking,
  useParticipantInfo,
  useTrackMutedIndicator,
} from '@livekit/components-react'
import { ConnectionQuality, Track } from 'livekit-client'
import { Hand, MicOff } from 'lucide-react'
import { useRoomStore } from '../state/roomStore.js'
import { useRoomTheme } from '../RoomThemeContext.jsx'
import { PinButton, PinnedNameIcon } from '../../../components/meeting/PinControls.jsx'

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
  const theme = useRoomTheme()
  const { name, identity } = useParticipantInfo({ participant: trackRef.participant })
  const isSpeaking = useIsSpeaking(trackRef.participant)
  const quality = useConnectionQuality(trackRef.participant)
  const { isMuted: micMuted } = useTrackMutedIndicator({
    participant: trackRef.participant,
    source: Track.Source.Microphone,
  })
  // Subscribe to THIS track's mute state (camera or screen-share). Without a
  // subscription, toggling the camera off→on never re-renders the tile and it
  // stays stuck on the avatar placeholder even though video is publishing
  // again. Driving `hasVideo` off this hook (not a raw publication read) keeps
  // the tile in sync through every mute/unmute cycle.
  const { isMuted: videoMuted } = useTrackMutedIndicator({
    participant: trackRef.participant,
    source: trackRef.source,
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

  const hasVideo = !!trackRef.publication && !videoMuted
  const displayName = name || identity || 'Guest'
  // Deterministic colour per identity so the same user always gets the same
  // tile background — Meet does the same trick.
  const avatarColor = pickColor(identity || displayName)

  // Mask the gap between "track subscribed" and "first frame decoded". That
  // gap is keyframe latency — short on a healthy link, but long when the
  // publisher's encoder is starved (e.g. heavy local effects) or the network
  // is poor. Without this the remote tile showed a BLACK rectangle until the
  // first keyframe landed; now we keep the avatar up until the <video> paints,
  // exactly like Meet/Zoom.
  const [videoReady, setVideoReady] = useState(false)
  const trackSid = trackRef.publication?.trackSid
  useEffect(() => {
    setVideoReady(false)
    if (!hasVideo) return undefined
    // Safety net: reveal the video even if the load event never fires, so a
    // working stream can never get stuck hidden behind the placeholder.
    const t = setTimeout(() => setVideoReady(true), 6000)
    return () => clearTimeout(t)
  }, [trackSid, hasVideo])
  const onVideoLive = useCallback(() => setVideoReady(true), [])

  return (
    <div
      onDoubleClick={onPinToggle}
      title="Double-click to pin"
      className={
        'group relative isolate aspect-video overflow-hidden rounded-2xl transition-shadow ' +
        (isSpeaking ? 'ring-2' : 'ring-1 ring-white/10')
      }
      style={isSpeaking ? { boxShadow: `0 0 0 2px ${theme.accent}` } : undefined}
    >
      {/* Render the video as soon as the track exists so it can start decoding,
          but keep the avatar overlaid on top until the first frame paints
          (videoReady) so a subscribe/keyframe delay shows the avatar, not black. */}
      {hasVideo && (
        <VideoTrack
          trackRef={trackRef}
          onLoadedData={onVideoLive}
          onPlaying={onVideoLive}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {(!hasVideo || !videoReady) && (
        <div
          className="absolute inset-0 grid place-items-center"
          style={{ background: theme.tileBg }}
        >
          <div
            className={
              'grid place-items-center rounded-full font-semibold text-white ' +
              (isHero ? 'h-36 w-36 text-5xl' : 'h-24 w-24 text-3xl')
            }
            style={{
              backgroundColor: avatarColor,
              boxShadow: `0 0 0 1px rgba(255,255,255,0.18), 0 0 0 5px color-mix(in srgb, ${theme.accent} 22%, transparent), 0 18px 44px -18px rgba(0,0,0,0.65)`,
            }}
          >
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        </div>
      )}

      {/* Hand raised — top-left, warm gradient chip (matches mesh PeerTile) */}
      {raised && (
        <div className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-b from-amber-300 to-amber-400 text-amber-950 shadow-[0_4px_12px_-3px_rgba(217,119,6,0.6),inset_0_1px_0_rgba(255,255,255,0.5)] ring-1 ring-white/40" title="Hand raised">
          <Hand className="h-4 w-4" />
        </div>
      )}

      {/* Mic-off badge — top-right, glass chip */}
      {micMuted && (
        <div className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white shadow-sm ring-1 ring-white/15 backdrop-blur-md" title="Muted">
          <MicOff className="h-4 w-4 text-[#ff6b5e]" />
        </div>
      )}

      {/* Pin button — hover-revealed on desktop, always visible on touch,
          slides left to clear the mic-off badge when present. */}
      <PinButton
        pinned={isPinned}
        onClick={onPinToggle}
        shifted={micMuted}
        groupName=""
      />

      <QualityBars quality={quality} />

      {/* Bottom scrim — keeps the name pill legible over bright video. */}
      {hasVideo && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/35 to-transparent" />
      )}

      {/* Bottom name pill — glass chip (matches mesh PeerTile) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
        <div className="flex items-center gap-1.5 rounded-lg bg-black/45 px-2.5 py-1 text-[12.5px] font-medium text-white shadow-sm ring-1 ring-white/10 backdrop-blur-md">
          {isPinned && <PinnedNameIcon />}
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
