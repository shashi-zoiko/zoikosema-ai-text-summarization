import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTracks } from '@livekit/components-react'
import { Track, VideoQuality } from 'livekit-client'
import { ParticipantTile } from './ParticipantTile.jsx'
import StageLayout from './StageLayout.jsx'
import { useRoomStore } from '../state/roomStore.js'
import { useActiveSpeaker } from '../hooks/useActiveSpeaker.js'
import { useRecentSpeakers } from '../hooks/useRecentSpeakers.js'

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

// Stable palette index for a LiveKit identity (e.g. "u:42"). Deterministic, so a
// participant keeps the SAME accent for the whole call regardless of who joins
// or leaves — the property the sorted-slot version only claimed to have.
function accentIndex(identity) {
  let h = 0
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) | 0
  return Math.abs(h) % ACCENTS.length
}

/**
 * The meeting stage. Resolves the LiveKit track list into an ordered tile list
 * + an optional hero, then hands the geometry to {@link StageLayout}.
 *
 * Hero priority:  screen share  >  pinned  >  active speaker (speaker layout).
 */
function Stage({ layout = 'grid' }) {
  const pinnedIdentity = useRoomStore((s) => s.pinnedIdentity)
  const setPinned = useRoomStore((s) => s.setPinned)
  const setHeroActive = useRoomStore((s) => s.setHeroActive)
  const activeSpeaker = useActiveSpeaker()
  const recentSpeakers = useRecentSpeakers()

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )

  // ── Single, latest-wins presentation ───────────────────────────────────────
  // LiveKit lets several participants publish a ScreenShare track at once, but a
  // Meet-style stage shows exactly ONE — the most recently started share. We
  // stamp each share with a monotonic sequence the first time we see it (kept in
  // a ref, written only inside the effect, pruned when the share ends) and
  // promote the highest sequence. So when User B starts sharing while User A is
  // presenting, B's share becomes the hero and A's is dropped — no ghost, no
  // duplicate. Until the effect runs we fall back to the first share, so a fresh
  // presentation never flickers as "no one presenting".
  const shareTracks = useMemo(
    () => tracks.filter((t) => t.source === Track.Source.ScreenShare),
    [tracks],
  )
  const shareId = (t) => t.publication?.trackSid || t.participant.identity
  const shareSeq = useRef(new Map())
  const shareCounter = useRef(0)
  const [presenterId, setPresenterId] = useState(null)
  useEffect(() => {
    const seq = shareSeq.current
    const present = new Set()
    for (const t of shareTracks) {
      const id = shareId(t)
      present.add(id)
      if (!seq.has(id)) seq.set(id, ++shareCounter.current)
    }
    for (const id of [...seq.keys()]) if (!present.has(id)) seq.delete(id)
    let best = null
    let bestSeq = -1
    for (const t of shareTracks) {
      const s = seq.get(shareId(t)) ?? 0
      if (s > bestSeq) { bestSeq = s; best = shareId(t) }
    }
    setPresenterId((prev) => (prev === best ? prev : best))
  }, [shareTracks])
  const screen = useMemo(
    () => shareTracks.find((t) => shareId(t) === presenterId) || shareTracks[0] || null,
    [shareTracks, presenterId],
  )

  // Real aspect ratio of the active share, reported by the <video> once its
  // metadata loads (and again on surface-switch). Drives the hero box so the
  // frame hugs the shared screen with no black letterbox bars.
  const [screenAspect, setScreenAspect] = useState(16 / 9)
  // When the presenter changes, reseed from the new track's published dimensions
  // (if known) so the hero doesn't briefly keep the previous share's shape; the
  // <video>'s onLoadedMetadata then refines it to the exact ratio.
  useEffect(() => {
    const d = screen?.publication?.dimensions
    if (d?.width && d?.height) setScreenAspect(d.width / d.height)
  }, [presenterId, screen])

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

  // Accent is a deterministic hash of the (stable) LiveKit identity, NOT the
  // participant's slot in the sorted roster. Slot-based assignment was a
  // render-storm bug: when an admitted user whose identity sorts earlier joined,
  // every existing participant's index shifted, so their `accent` prop changed
  // and ParticipantTile's memo (which compares `accent`) re-rendered EVERY
  // existing tile — O(N) per join, O(N²) for an admit-all burst, and a prime
  // cause of the freeze when several users were admitted at once. Hashing the
  // identity makes each tile's accent permanent and independent of who else is
  // present, so admitting someone re-renders ONLY their new tile. (Same idiom as
  // the per-identity avatar colour; an occasional shared accent is cosmetic.)
  const accentByIdentity = useMemo(() => {
    const map = new Map()
    for (const t of cams) {
      const id = t.participant.identity
      if (id == null) continue
      map.set(id, ACCENTS[accentIndex(id)])
    }
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

  // Publish hero state so <CaptionOverlay> can lift the caption stack above the
  // bottom participant carousel that hero mode shows on phones (Phase 8).
  useEffect(() => {
    setHeroActive(!!hero)
    return () => setHeroActive(false)
  }, [hero, setHeroActive])

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
    const presenterIdentity = screen?.participant?.identity
    const tiles = list.map((t) => ({
      key: tileKey(t),
      track: t,
      accent: accentByIdentity.get(t.participant.identity),
      // Tag the presenter's own camera tile so the strip shows a "Presenting"
      // chip next to it (their video stays in the strip; the screen is the hero).
      isPresenting: !!presenterIdentity && t.participant.identity === presenterIdentity,
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

  // ── Priority order: WHO keeps a tile when the room overflows ────────────────
  // A full ranking of every camera tile, most-important first. StageLayout keeps
  // the top tiles on stage and folds the rest into a single "+N others" tile
  // (Google-Meet big-room layout). The ranking is exactly Meet's promotion rule:
  // pinned, then the presenter, then whoever is talking (active + recently
  // active, so a speaker lingers a few seconds instead of flickering out), then
  // anyone with their camera on, then camera-off. Yourself is nudged up so you
  // never vanish into "+N others". Ties break on the stable identity string so
  // the order never churns on equal-rank changes.
  const presenterIdentity = screen?.participant?.identity || null
  const priorityOrder = useMemo(() => {
    const rank = (t) => {
      const id = t.participant.identity
      if (id && id === pinnedIdentity) return 0
      if (presenterIdentity && id === presenterIdentity) return 1
      if (id && id === activeSpeaker) return 2
      if (id && recentSpeakers.has(id)) return 3
      const camOn = !!t.publication && !t.publication.isMuted
      let r = camOn ? 4 : 6
      if (t.participant.isLocal) r = Math.min(r, 5) // keep yourself on stage
      return r
    }
    return [...cams]
      .map((t) => ({ key: tileKey(t), r: rank(t), id: t.participant.identity ?? '' }))
      .sort((a, b) => a.r - b.r || a.id.localeCompare(b.id))
      .map((x) => x.key)
  }, [cams, pinnedIdentity, presenterIdentity, activeSpeaker, recentSpeakers])

  // Stable across renders so memo(StageLayout) isn't defeated by a fresh closure
  // on every active-speaker tick. setScreenAspect is a stable useState setter.
  const renderTile = useCallback((item, { isHero, fit, dense }) => (
    <ParticipantTile
      trackRef={item.track}
      accent={item.accent}
      isHero={isHero}
      fit={fit}
      dense={dense}
      isPresenting={item.isPresenting}
      onAspectRatio={item.track.source === Track.Source.ScreenShare ? setScreenAspect : undefined}
    />
  ), [])
  const renderOverflow = useCallback((overflowItems, { dense } = {}) => (
    <OverflowTile items={overflowItems} dense={dense} />
  ), [])

  return (
    <StageLayout
      items={items}
      heroKey={hero ? tileKey(hero) : null}
      heroFit={screen ? 'contain' : 'cover'}
      heroAspect={screen ? screenAspect : null}
      priorityOrder={priorityOrder}
      renderTile={renderTile}
      renderOverflow={renderOverflow}
    />
  )
}

// First letter of a participant's display name for the overflow avatars. Strips
// a LiveKit identity scheme prefix (`u:`, `guest:`) so we key off the human name.
function overflowInitial(participant) {
  const raw = participant?.name || participant?.identity || ''
  const stripped = raw.replace(/^[a-z]+:/i, '').trim()
  return (stripped[0] || '?').toUpperCase()
}

/**
 * The Google-Meet "+N others" tile: a stack of a few participant avatars and a
 * count, occupying a single grid slot for everyone who didn't make the visible
 * cut. Purely a summary — the people it represents are the lowest-priority
 * (quiet, camera-off) participants, and any of them re-appears with their own
 * tile the moment they speak or turn their camera on.
 */
function OverflowTile({ items, dense = false }) {
  const shown = items.slice(0, 3)
  const size = dense ? 34 : 'min(24cqmin, 92px)'
  return (
    <div
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-[28px] ring-1 ring-[#263244]"
      style={{
        background: 'linear-gradient(160deg, #1B2233 0%, #131824 100%)',
        containerType: 'size',
        gap: dense ? 8 : '5cqmin',
      }}
    >
      <div className="flex items-center">
        {shown.map((it, i) => {
          const c = it.accent || '#3B82F6'
          return (
            <div
              key={it.key}
              className="grid aspect-square place-items-center rounded-full font-semibold leading-none text-white ring-2 ring-[#131824]"
              style={{
                width: size,
                fontSize: dense ? 14 : 'min(11cqmin, 36px)',
                marginLeft: i ? (dense ? -12 : '-6cqmin') : 0,
                background: `linear-gradient(145deg, ${c} 0%, ${c}b3 100%)`,
              }}
            >
              {overflowInitial(it.track?.participant)}
            </div>
          )
        })}
      </div>
      <span className="font-semibold text-white" style={{ fontSize: dense ? 13 : 'clamp(13px, 4.6cqmin, 22px)' }}>
        {items.length} {items.length === 1 ? 'other' : 'others'}
      </span>
    </div>
  )
}

// Memoised: <Stage> only takes `layout`, so MeetRoom's frequent control-plane
// state churn (waiting-room, chat, recording, sidebar toggles) no longer
// re-renders the entire stage subtree. Track/speaker/pin changes still re-render
// it through its own LiveKit + zustand subscriptions (memo doesn't block those).
export default memo(Stage)
