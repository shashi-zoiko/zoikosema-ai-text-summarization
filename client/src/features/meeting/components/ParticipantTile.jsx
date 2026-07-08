import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  VideoTrack,
  useIsSpeaking,
  useParticipantInfo,
  useTrackMutedIndicator,
} from '@livekit/components-react'
import { ConnectionQuality, Track } from 'livekit-client'
import { AlertTriangle, Eye, Hand, Loader2, MicOff, MonitorUp, Square } from 'lucide-react'
import { useRoomStore } from '../state/roomStore.js'
import { PinButton, PinnedNameIcon } from '../../../components/meeting/PinControls.jsx'
import GuestBadge, { isGuestParticipant, participantAvatarUrl } from './GuestBadge.jsx'
import { assetUrl } from '../../../api/client'

// Enterprise dark palette (mirrors index.css meeting tokens).
const CARD = '#161B26'

// Tint a hex accent to an rgba string for glows / soft rings.
function withAlpha(hex, a) {
  const h = (hex || '#10B981').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// Calm, low-saturation tile canvas (Google-Meet / Teams dark): a neutral dark
// card with only a FAINT wash of the participant's accent in the top-left, so
// each person still reads as their own colour without the old neon glare. The
// accent lives on the thin border + status dot + speaking ring, not the fill.
function tileBackground(accent) {
  return (
    `radial-gradient(120% 120% at 14% 0%, ${withAlpha(accent, 0.16)} 0%, transparent 55%),` +
    `linear-gradient(160deg, ${withAlpha(accent, 0.07)} 0%, ${CARD} 62%)`
  )
}

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

function ParticipantTileImpl({ trackRef, fit = 'cover', accent, isPresenting = false, onAspectRatio, dense = false }) {
  const { name, identity, metadata } = useParticipantInfo({ participant: trackRef.participant })
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
  const isSelf = !!trackRef.participant?.isLocal
  const onPinToggle = useCallback(
    (e) => { e.stopPropagation(); togglePinned(identity) },
    [identity, togglePinned],
  )

  // The presenter must NOT see their own screen-share rendered back into the
  // stage: if they shared the tab/window that contains this meeting, painting
  // the capture here feeds it straight back into the capture → infinite "hall of
  // mirrors". Remote participants still get the live frame; the presenter gets a
  // calm placeholder, exactly like Google Meet ("You're presenting").
  const isOwnScreenShare =
    trackRef.source === Track.Source.ScreenShare && trackRef.participant?.isLocal

  const hasVideo = !!trackRef.publication && !videoMuted
  const displayName = name || identity || 'Guest'
  // Read guest/avatar off the REACTIVE metadata from useParticipantInfo, not
  // the raw participant.metadata — remote participants' metadata arrives after
  // the tile first mounts, and reading it non-reactively left their photo/guest
  // badge stuck on the first (empty) render.
  const isGuest = isGuestParticipant({ metadata })
  const rawAvatar = participantAvatarUrl({ metadata })
  // Fall back to the initial if the photo 404s (e.g. an upload that didn't
  // persist) instead of showing a blank circle. Reset when the URL changes.
  const [avatarFailed, setAvatarFailed] = useState(false)
  useEffect(() => { setAvatarFailed(false) }, [rawAvatar])
  const avatarUrl = avatarFailed ? null : assetUrl(rawAvatar)
  // Deterministic colour per identity so the same user always gets the same
  // avatar — Meet does the same trick.
  const avatarColor = pickColor(identity || displayName)
  // Per-participant accent assigned by Stage from a fixed palette. Falls back to
  // the deterministic avatar colour when a tile is rendered outside Stage.
  const tileAccent = accent || avatarColor

  // Mask the gap between "track subscribed" and "first frame decoded". That
  // gap is keyframe latency — short on a healthy link, but long when the
  // publisher's encoder is starved or the network is poor. Without this the
  // remote tile showed a BLACK rectangle until the first keyframe landed; now
  // we keep the avatar up until the <video> paints, exactly like Meet/Zoom.
  const [videoReady, setVideoReady] = useState(false)
  const trackSid = trackRef.publication?.trackSid
  useEffect(() => {
    setVideoReady(false)
    if (!hasVideo) return undefined
    const t = setTimeout(() => setVideoReady(true), 6000)
    return () => clearTimeout(t)
  }, [trackSid, hasVideo])
  const onVideoLive = useCallback(() => setVideoReady(true), [])

  // Report the share's real aspect ratio up to the stage so the hero box can hug
  // the shared screen (no black letterbox bars). Fires on first metadata and
  // again whenever the presenter switches the captured surface (size changes).
  const reportAspect = useCallback(
    (e) => {
      const v = e?.currentTarget
      if (!onAspectRatio || !v?.videoWidth || !v?.videoHeight) return
      onAspectRatio(v.videoWidth / v.videoHeight)
    },
    [onAspectRatio],
  )

  // Local presenter self-view: hidden by default to break the "hall of mirrors"
  // loop. `showMirror` opts into the live self-preview for testing.
  const [showMirror, setShowMirror] = useState(false)
  const stopOwnShare = useCallback(() => {
    trackRef.participant?.setScreenShareEnabled?.(false)?.catch?.(() => {})
  }, [trackRef.participant])

  // ── Local presenter self-view ───────────────────────────────────────────────
  if (isOwnScreenShare) {
    if (showMirror) {
      return (
        <div className="group relative isolate h-full w-full overflow-hidden rounded-[20px] bg-black ring-1 ring-[#263244]">
          {hasVideo && (
            <VideoTrack
              trackRef={trackRef}
              onLoadedMetadata={reportAspect}
              onResize={reportAspect}
              className="absolute inset-0 h-full w-full bg-black object-contain"
            />
          )}
          <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#F59E0B] px-3 py-1 text-[12px] font-semibold text-[#0B1220] shadow-md">
            <AlertTriangle className="h-3.5 w-3.5" />
            Mirror preview — this is your own screen
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-3">
            <button
              type="button"
              onClick={() => setShowMirror(false)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-[13px] font-medium text-white ring-1 ring-white/15 backdrop-blur-md transition hover:bg-white/20"
            >
              <Eye className="h-4 w-4" />
              Hide preview
            </button>
            <button
              type="button"
              onClick={stopOwnShare}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#EF4444] px-3.5 text-[13px] font-semibold text-white shadow-lg transition hover:bg-[#DC2626]"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop sharing
            </button>
          </div>
        </div>
      )
    }

    return (
      <div
        className="group relative isolate grid h-full w-full place-items-center overflow-hidden rounded-[20px] ring-1 ring-[#263244]"
        style={{ background: CARD }}
        role="img"
        aria-label="You are presenting your screen to everyone"
      >
        <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-[#10B981] text-[#0B1220] shadow-lg">
            <MonitorUp className="h-7 w-7" />
          </div>
          <div>
            <div className="text-lg font-semibold text-white">You're presenting</div>
            <p className="mt-1 text-sm text-[#94A3B8]">
              Everyone else can see your screen. Your own view is hidden here to
              prevent a mirror loop.
            </p>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl bg-[#F59E0B]/10 px-3.5 py-2.5 text-left ring-1 ring-[#F59E0B]/25">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FBBF24]" />
            <p className="text-[12.5px] leading-snug text-[#FBBF24]">
              If you're sharing the window that contains this meeting, previewing
              it may create a repeated mirror effect.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setShowMirror(true)}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-4 text-[13px] font-medium text-white ring-1 ring-white/15 transition hover:bg-white/20"
            >
              <Eye className="h-4 w-4" />
              Continue to preview
            </button>
            <button
              type="button"
              onClick={stopOwnShare}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#EF4444] px-4 text-[13px] font-semibold text-white shadow-lg transition hover:bg-[#DC2626]"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              Stop sharing
            </button>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
          <div className="flex items-center gap-1.5 rounded-lg bg-black/50 px-2.5 py-1 text-[12.5px] font-medium text-white ring-1 ring-white/10 backdrop-blur-md">
            <MonitorUp className="h-3.5 w-3.5" />
            <span className="truncate">Your screen</span>
          </div>
        </div>
      </div>
    )
  }

  // ── Remote presentation tile ────────────────────────────────────────────────
  // A REMOTE screen share renders as a neutral, black-letterboxed surface — no
  // accent wash, no speaking ring (it's content, not a face). While the first
  // frame is still decoding we show a calm "Loading presentation…" spinner
  // instead of a black rectangle.
  if (trackRef.source === Track.Source.ScreenShare) {
    return (
      <div className="group relative isolate h-full w-full overflow-hidden rounded-[20px] bg-black shadow-2xl ring-1 ring-[#263244]">
        {hasVideo && (
          <VideoTrack
            trackRef={trackRef}
            onLoadedData={onVideoLive}
            onPlaying={onVideoLive}
            onLoadedMetadata={reportAspect}
            onResize={reportAspect}
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        )}
        {(!hasVideo || !videoReady) && (
          <div className="absolute inset-0 grid place-items-center bg-[#0B1018]">
            <div className="flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#10B981]" />
              <span className="text-[13px] font-medium text-[#94A3B8]">Loading presentation…</span>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end p-3">
          <div className="flex items-center gap-1.5 rounded-lg bg-black/55 px-2.5 py-1 text-[12.5px] font-medium text-white ring-1 ring-white/10 backdrop-blur-md">
            <MonitorUp className="h-3.5 w-3.5 text-emerald-400" />
            <span className="truncate">{displayName}'s screen</span>
          </div>
        </div>
      </div>
    )
  }

  const speaking = isSpeaking && !micMuted

  return (
    <div
      className={
        'group relative isolate h-full w-full overflow-hidden rounded-[28px] ' +
        'transition-[transform,box-shadow] duration-[250ms] ease-out ' +
        (speaking ? 'zk-tile-speak scale-[1.015]' : 'zk-tile-rest')
      }
      style={{
        // Calm per-participant canvas, plus accent custom props that drive the
        // rest / speaking glow keyframes in CSS. Resting tiles get only a THIN
        // accent border; the active speaker still pulses a brighter ring so
        // "who's talking" stays unmistakable — just without the old neon glare.
        background: tileBackground(tileAccent),
        // `size` containment makes this a query container, so the avatar/text
        // below can scale to the tile via cqmin units — fixes the "huge avatar
        // in a small strip tile" bug at every tile size.
        containerType: 'size',
        '--tile-accent': tileAccent,
        '--tile-soft': withAlpha(tileAccent, 0.22),
        '--tile-faint': withAlpha(tileAccent, 0.12),
        '--tile-glow': withAlpha(tileAccent, 0.32),
        '--tile-glow-soft': withAlpha(tileAccent, 0.10),
      }}
    >
      {hasVideo && (
        <VideoTrack
          trackRef={trackRef}
          onLoadedData={onVideoLive}
          onPlaying={onVideoLive}
          className={
            'absolute inset-0 h-full w-full ' +
            (fit === 'contain' ? 'bg-black object-contain' : 'object-cover')
          }
        />
      )}

      {(!hasVideo || !videoReady) && (
        // Reserve the bottom name band so the centred avatar + "Camera off"
        // caption never overlaps the name label pinned to the bottom edge. Short
        // tiles (desktop rail, mobile carousel, portrait grid) collided before —
        // the placeholder centred in the FULL height, so its lower edge ran into
        // the name. Padding the bottom recentres the content in the space ABOVE
        // the name in every layout (dense fixed px; gallery/hero scale via cqmin).
        <div
          className={'absolute inset-0 grid place-items-center ' + (dense ? 'pb-8' : 'pb-[14cqmin]')}
          style={{ background: tileBackground(tileAccent) }}
        >
          <div className={'flex flex-col items-center ' + (dense ? 'gap-2' : 'gap-[4cqmin]')}>
            <div
              className="grid aspect-square shrink-0 place-items-center overflow-hidden rounded-full font-semibold leading-none text-white"
              style={{
                // Filmstrip tiles size from `aspect-video` (auto height), where a
                // `container-type: size` query container doesn't reliably establish
                // — so cqmin would fall back to the viewport and balloon. Those
                // tiles use FIXED sizes (`dense`); gallery / hero tiles have explicit
                // px dimensions, so cqmin resolves correctly and scales with the tile.
                width: dense ? 56 : 'min(42cqmin, 132px)',
                fontSize: dense ? 22 : 'min(19cqmin, 52px)',
                background: `linear-gradient(145deg, ${withAlpha(tileAccent, 1)} 0%, ${withAlpha(tileAccent, 0.7)} 100%)`,
                boxShadow: speaking
                  ? `0 0 0 3px ${tileAccent}, 0 0 0 10px ${withAlpha(tileAccent, 0.18)}, 0 0 28px 2px ${withAlpha(tileAccent, 0.5)}`
                  : `inset 0 1px 0 rgba(255,255,255,0.25), 0 0 0 4px ${withAlpha(tileAccent, 0.12)}, 0 8px 24px -8px ${withAlpha(tileAccent, 0.5)}`,
              }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  onError={() => setAvatarFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                displayName.slice(0, 1).toUpperCase()
              )}
            </div>
            {speaking ? (
              <VoiceBars participant={trackRef.participant} accent={tileAccent} />
            ) : dense ? null : (
              // Compact tiles (dense rail / carousel) show avatar + name only, like
              // Meet — a third "Camera off" line would clip in the smallest rail
              // tiles and duplicate the info the empty avatar already conveys.
              <span
                className="font-medium text-[#94A3B8]"
                style={{ fontSize: 'min(11cqmin,12.5px)' }}
              >
                Camera off
              </span>
            )}
          </div>
        </div>
      )}

      {/* Top-left status chips — "Presenting" (this person owns the shared screen)
          and a raised hand. Stacked in one row so they never overlap. */}
      {(isPresenting || raised) && (
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          {isPresenting && (
            <span className="flex items-center gap-1 rounded-full bg-[#10B981] px-2 py-1 text-[11px] font-semibold text-[#0B1220] shadow-lg ring-1 ring-white/20" title="Presenting">
              <MonitorUp className="h-3.5 w-3.5" />
              Presenting
            </span>
          )}
          {raised && (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#F59E0B] text-[#0B1220] shadow-lg ring-1 ring-white/20" title="Hand raised">
              <Hand className="h-4 w-4" />
            </span>
          )}
        </div>
      )}

      {/* Mic-off badge — top-right */}
      {micMuted && (
        <div className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-[#F87171] ring-1 ring-white/10 backdrop-blur-md" title="Muted">
          <MicOff className="h-4 w-4" />
        </div>
      )}

      <PinButton pinned={isPinned} onClick={onPinToggle} shifted={micMuted} groupName="" />

      <QualityBars quality={quality} />

      {/* Bottom scrim for legibility over bright video. */}
      {hasVideo && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/65 to-transparent" />
      )}

      {/* Bottom-left name — plain text, Google-Meet style (no chip background).
          Sized in container-query units so it scales with the tile: big & bold in
          a hero / single-user stage, shrinking to a legible floor as more people
          join or in the small screen-share filmstrip. A dark halo keeps it
          readable over bright video; a soft accent glow makes it pop. */}
      <div className={'pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 ' + (dense ? 'px-2.5 pb-2' : 'px-[3.5cqmin] pb-[3.5cqmin]')}>
        <div
          className="flex min-w-0 max-w-full items-center gap-1.5 font-bold leading-tight tracking-[-0.01em] text-white"
          style={{
            // Dense filmstrip tiles use a fixed legible size (their auto height
            // breaks container-query resolution); gallery / hero tiles scale with
            // the tile via cqmin. A higher floor + scale factor keeps the name
            // clearly readable even when a busy grid shrinks each tile, while
            // `min-w-0 truncate` (below) guarantees it never outgrows the tile.
            // leading-tight (not leading-none) so descenders (g, y, p) never clip
            // against the tile's bottom edge.
            fontSize: dense ? 14 : 'clamp(15px, 4.6cqmin, 24px)',
            textShadow: `0 1px 3px rgba(0,0,0,0.95), 0 0 5px rgba(0,0,0,0.65), 0 0 20px ${withAlpha(tileAccent, 0.75)}`,
          }}
        >
          {isPinned && <PinnedNameIcon />}
          <span className="min-w-0 truncate">{displayName}{isSelf && ' (You)'}</span>
          {isGuest && <GuestBadge />}
        </div>
      </div>
    </div>
  )
}

/**
 * Live voice visualizer — five bars driven by the participant's real LiveKit
 * audio level (0‒1), polled on rAF and written straight to the DOM so the whole
 * tile never re-renders. Mounts only while the participant is speaking.
 */
const BAR_FACTORS = [0.55, 0.85, 1, 0.85, 0.55]
function VoiceBars({ participant, accent }) {
  const barsRef = useRef([])
  useEffect(() => {
    if (!participant) return undefined
    let raf = 0
    const tick = () => {
      const level = Math.min(1, (participant.audioLevel || 0) * 2.4)
      for (let i = 0; i < barsRef.current.length; i++) {
        const el = barsRef.current[i]
        if (el) el.style.transform = `scaleY(${(0.22 + level * BAR_FACTORS[i] * 0.78).toFixed(3)})`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [participant])

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex h-5 items-end gap-[3px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            ref={(el) => { barsRef.current[i] = el }}
            className="block w-1 rounded-full"
            style={{
              height: '100%',
              background: accent,
              transformOrigin: 'bottom',
              transform: 'scaleY(0.22)',
              transition: 'transform 90ms linear',
            }}
          />
        ))}
      </div>
      <span className="text-[12.5px] font-medium" style={{ color: accent }}>Speaking…</span>
    </div>
  )
}

// Professional avatar palette — purple / blue / green / orange / pink / cyan.
const COLORS = ['#7C3AED', '#2563EB', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#3B82F6', '#8B5CF6']
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
    a.trackRef.participant === b.trackRef.participant &&
    a.isHero === b.isHero &&
    a.fit === b.fit &&
    a.accent === b.accent &&
    a.isPresenting === b.isPresenting &&
    a.dense === b.dense,
)

function QualityBars({ quality }) {
  // EXCELLENT=2, GOOD=1, POOR=0, LOST=-1, UNKNOWN=undefined. Hide chrome when
  // quality is good — fewer pixels for the common case.
  if (quality === undefined || quality === ConnectionQuality.Excellent) return null
  const tone =
    quality === ConnectionQuality.Lost
      ? 'bg-[#EF4444]'
      : quality === ConnectionQuality.Poor
        ? 'bg-[#F59E0B]'
        : 'bg-[#10B981]'
  const fillBars = quality === ConnectionQuality.Lost ? 1 : quality === ConnectionQuality.Poor ? 1 : 2
  return (
    <div className="absolute bottom-2 right-2 flex items-end gap-0.5 rounded bg-black/60 px-1 py-0.5" title={`Network: ${quality}`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`block w-1 rounded-sm ${i <= fillBars ? tone : 'bg-[#334155]'}`}
          style={{ height: `${i * 4 + 2}px` }}
        />
      ))}
    </div>
  )
}
