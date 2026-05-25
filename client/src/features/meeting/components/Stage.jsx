import { useEffect } from 'react'
import { useTracks } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { ParticipantTile } from './ParticipantTile.jsx'
import { useRoomStore } from '../state/roomStore.js'

/**
 * Camera + screen-share grid. Honours the global `pinnedIdentity` slice — if
 * present, that participant's camera is promoted to the hero slot and gets
 * the high video quality; everyone else is downgraded to low.
 */
export default function Stage() {
  const pinnedIdentity = useRoomStore((s) => s.pinnedIdentity)

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )

  const screen = tracks.find((t) => t.source === Track.Source.ScreenShare)
  const cams = tracks.filter((t) => t.source === Track.Source.Camera)

  // Active screen-share or explicit pin both promote a single tile to hero.
  // Pin takes precedence — a host can spotlight a presenter without forcing
  // them to share screen.
  const heroIdentity = pinnedIdentity || screen?.participant?.identity
  const heroFromCam = cams.find((t) => t.participant.identity === heroIdentity)
  const hero = screen ?? heroFromCam
  const others = hero ? cams.filter((t) => t.participant.identity !== hero.participant.identity) : cams

  // Push per-subscriber video quality so the hero stays sharp and tiny tiles
  // don't waste bandwidth on a 720p stream.
  useEffect(() => {
    if (!hero) return
    const heroId = hero.participant.identity
    for (const t of cams) {
      const pub = t.publication
      if (!pub || !pub.setVideoQuality) continue
      try {
        // 0 = LOW, 1 = MEDIUM, 2 = HIGH (livekit-client enum). Skip remote
        // checks — pub is always remote for non-local participants and the
        // call no-ops for local publications.
        pub.setVideoQuality(t.participant.identity === heroId ? 2 : 0)
      } catch { /* fine */ }
    }
  }, [hero, cams])

  return (
    <div className="flex-1 flex flex-col gap-3 p-3 overflow-hidden">
      {hero && (
        <div className="flex-2 min-h-0">
          <ParticipantTile trackRef={hero} isHero />
        </div>
      )}
      <div
        className={
          (hero ? 'h-32 sm:h-40 flex gap-3 overflow-x-auto' : 'flex-1 grid gap-3 min-h-0')
        }
        style={
          hero
            ? undefined
            : { gridTemplateColumns: `repeat(${gridCols(others.length)}, minmax(0, 1fr))` }
        }
      >
        {others.map((t) => (
          <div key={`${t.participant.sid}:${t.source}`} className={hero ? 'shrink-0 w-48 sm:w-56 aspect-video' : ''}>
            <ParticipantTile trackRef={t} />
          </div>
        ))}
      </div>
    </div>
  )
}

function gridCols(n) {
  if (n <= 1) return 1
  if (n <= 4) return 2
  if (n <= 9) return 3
  return 4
}
