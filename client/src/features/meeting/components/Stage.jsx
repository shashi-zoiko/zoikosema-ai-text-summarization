import { useEffect, useMemo } from 'react'
import { useTracks } from '@livekit/components-react'
import { Track, VideoQuality } from 'livekit-client'
import { ParticipantTile } from './ParticipantTile.jsx'
import StageLayout from './StageLayout.jsx'
import { useRoomStore } from '../state/roomStore.js'
import { useActiveSpeaker } from '../hooks/useActiveSpeaker.js'

// Stable per-tile key. Keyed on the LiveKit IDENTITY (e.g. "u:42"), NOT the
// track sid — sid changes on reconnect, which would remount the tile and break
// its position. Identity is stable across reconnects, so a reconnecting user
// keeps their slot and the layout never jumps.
const tileKey = (t) => `${t.participant.identity ?? t.participant.sid}:${t.source}`

// Fixed per-participant accent palette (Teams / Meet / Discord style). Assigned
// by a participant's stable slot in the sorted roster so each person keeps ONE
// colour for the whole call — P1 emerald, P2 blue, P3 purple, P4 orange, P5
// pink, P6 cyan, then it wraps. Every tile glows in its accent; the active
// speaker brightens it.
const ACCENTS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4']

/**
 * The meeting stage. Resolves the LiveKit track list into an ordered tile list
 * + an optional hero, then hands the geometry to {@link StageLayout}.
 *
 * Hero priority:  screen share  >  pinned  >  active speaker (speaker layout).
 */
export default function Stage({ layout = 'grid' }) {
  const pinnedIdentity = useRoomStore((s) => s.pinnedIdentity)
  const setPinned = useRoomStore((s) => s.setPinned)
  const activeSpeaker = useActiveSpeaker()

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )

  const screen = tracks.find((t) => t.source === Track.Source.ScreenShare)

  // Stable accent per participant, keyed off the sorted camera order below.

  // Deterministic, stable camera order so tiles don't reshuffle when LiveKit
  // re-emits its track list (e.g. on mute toggles / reconnects). FLIP animates
  // any real change; this just removes the spurious churn.
  const cams = useMemo(
    () =>
      tracks
        .filter((t) => t.source === Track.Source.Camera)
        .sort((a, b) =>
          (a.participant.identity ?? '').localeCompare(b.participant.identity ?? ''),
        ),
    [tracks],
  )

  // Assign each participant a stable accent from their slot in the sorted
  // roster. Stable order → stable colour; nobody's tile changes hue mid-call.
  const accentByIdentity = useMemo(() => {
    const map = new Map()
    cams.forEach((t, i) => map.set(t.participant.identity, ACCENTS[i % ACCENTS.length]))
    return map
  }, [cams])

  // ── Resolve the hero ──────────────────────────────────────────────────────
  const heroCamIdentity =
    pinnedIdentity ||
    (layout === 'speaker' && cams.length > 1
      ? activeSpeaker ||
        cams.find((t) => !t.participant.isLocal)?.participant.identity ||
        cams[0]?.participant.identity
      : null)

  const heroCam = heroCamIdentity
    ? cams.find((t) => t.participant.identity === heroCamIdentity)
    : null

  // Screen share always owns the main stage and is never displaced by a pin
  // (Meet/Zoom behaviour). Otherwise the resolved camera hero takes it.
  const hero = screen ?? heroCam

  // ── Drop a stale pin when the pinned participant leaves ─────────────────────
  useEffect(() => {
    if (!pinnedIdentity) return
    const present =
      cams.some((t) => t.participant.identity === pinnedIdentity) ||
      screen?.participant?.identity === pinnedIdentity
    if (!present) setPinned(null)
  }, [pinnedIdentity, cams, screen, setPinned])

  // ── Per-subscriber video quality ────────────────────────────────────────────
  // Hero stays sharp; tiny tiles don't burn bandwidth on 720p. In a pure gallery
  // we scale quality by how big the tiles actually are (i.e. how many there are).
  useEffect(() => {
    const heroId = hero?.participant.identity
    const galleryQ = cams.length <= 4 ? VideoQuality.MEDIUM : VideoQuality.LOW
    for (const t of cams) {
      const pub = t.publication
      if (!pub?.setVideoQuality) continue
      try {
        pub.setVideoQuality(
          heroId
            ? t.participant.identity === heroId
              ? VideoQuality.HIGH
              : VideoQuality.LOW
            : galleryQ,
        )
      } catch {
        /* local publication / not subscribed — ignore */
      }
    }
  }, [hero, cams])

  // ── Build the ordered tile list for the layout ──────────────────────────────
  // Screen share floats the pinned participant to the front of the filmstrip so
  // they stay prominent next to the shared content.
  const items = useMemo(() => {
    const list = [...cams]
    if (screen && pinnedIdentity) {
      list.sort(
        (a, b) =>
          (b.participant.identity === pinnedIdentity ? 1 : 0) -
          (a.participant.identity === pinnedIdentity ? 1 : 0),
      )
    }
    const tiles = list.map((t) => ({
      key: tileKey(t),
      track: t,
      accent: accentByIdentity.get(t.participant.identity),
    }))
    if (screen) {
      tiles.unshift({
        key: tileKey(screen),
        track: screen,
        accent: accentByIdentity.get(screen.participant.identity) || ACCENTS[1],
      })
    }
    return tiles
  }, [cams, screen, pinnedIdentity, accentByIdentity])

  return (
    <StageLayout
      items={items}
      heroKey={hero ? tileKey(hero) : null}
      heroFit={screen ? 'contain' : 'cover'}
      filmstrip={screen ? 'bottom' : 'right'}
      renderTile={(item, { isHero, fit }) => (
        <ParticipantTile trackRef={item.track} accent={item.accent} isHero={isHero} fit={fit} />
      )}
    />
  )
}
