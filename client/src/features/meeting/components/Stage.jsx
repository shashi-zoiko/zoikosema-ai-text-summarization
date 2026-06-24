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
export default function Stage({ layout = 'grid' }) {
  const pinnedIdentity = useRoomStore((s) => s.pinnedIdentity)
  const setPinned = useRoomStore((s) => s.setPinned)

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
  let hero = screen ?? heroFromCam
  // Speaker layout promotes one tile to a big hero + filmstrip — but only when
  // there are 2+ people (otherwise a lone participant fills the whole screen,
  // which looks worse than the centered grid tile). Prefer a remote participant
  // as the hero. Grid layout only heroes an explicit screen-share / pin.
  if (!hero && layout === 'speaker' && cams.length > 1) {
    hero = cams.find((t) => !t.participant.isLocal) || cams[0]
  }
  let others = hero ? cams.filter((t) => t.participant.identity !== hero.participant.identity) : cams

  // A screen share keeps the main stage — it is never replaced by a pinned
  // participant (Meet/Zoom behaviour). But the pin is still honoured: surface
  // the pinned participant FIRST in the filmstrip so they stay prominent
  // alongside the shared content. When the share stops, `hero` falls back to
  // the pinned camera automatically (see heroFromCam above).
  if (screen && pinnedIdentity && others.length > 1) {
    others = [...others].sort((a, b) =>
      (b.participant.identity === pinnedIdentity ? 1 : 0) -
      (a.participant.identity === pinnedIdentity ? 1 : 0),
    )
  }

  // If the pinned participant leaves (or stops publishing and is no longer
  // tracked), drop the stale pin so the layout returns to normal instead of
  // holding an empty hero or silently re-pinning a recycled identity.
  useEffect(() => {
    if (!pinnedIdentity) return
    const present =
      cams.some((t) => t.participant.identity === pinnedIdentity) ||
      screen?.participant?.identity === pinnedIdentity
    if (!present) setPinned(null)
  }, [pinnedIdentity, cams, screen, setPinned])

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
      {hero ? (
        // Filmstrip beneath the hero — fixed-height, horizontally scrollable.
        <div className="h-32 sm:h-40 flex gap-3 overflow-x-auto">
          {others.map((t) => (
            <div key={`${t.participant.sid}:${t.source}`} className="shrink-0 w-48 sm:w-56 aspect-video">
              <ParticipantTile trackRef={t} />
            </div>
          ))}
        </div>
      ) : (
        // Gallery grid. Cap the width by participant count and center it
        // (mirrors the mesh room's gridView) so a solo/small meeting doesn't
        // blow one tile up to fill the whole stage.
        <div className={`mx-auto flex min-h-0 w-full flex-1 ${gridMaxWidth(others.length)}`}>
          <div
            className="grid h-full w-full auto-rows-fr gap-3"
            style={{ gridTemplateColumns: `repeat(${gridCols(others.length)}, minmax(0, 1fr))` }}
          >
            {others.map((t) => (
              <div key={`${t.participant.sid}:${t.source}`} className="min-h-0">
                <ParticipantTile trackRef={t} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function gridCols(n) {
  if (n <= 1) return 1
  if (n <= 4) return 2
  if (n <= 9) return 3
  return 4
}

// Mirrors MeetRoom.jsx's maxWidthFor — keeps a solo or small gallery centered
// at a sane width instead of stretching a single tile across the whole stage.
function gridMaxWidth(n) {
  if (n <= 1) return 'max-w-4xl'
  if (n <= 4) return 'max-w-6xl'
  return 'max-w-none'
}
