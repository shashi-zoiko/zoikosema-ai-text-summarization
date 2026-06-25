import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  VideoTrack,
  useIsSpeaking,
  useParticipantInfo,
  useTrackMutedIndicator,
} from '@livekit/components-react'
import { ConnectionQuality, Track } from 'livekit-client'
import { AlertTriangle, Eye, Hand, MicOff, MonitorUp, Square } from 'lucide-react'
import { useRoomStore } from '../state/roomStore.js'
import { PinButton, PinnedNameIcon } from '../../../components/meeting/PinControls.jsx'

// Enterprise dark palette (mirrors index.css meeting tokens).
const CARD = '#151D2B'

// Tint a hex accent to an rgba string for glows / soft rings.
function withAlpha(hex, a) {
  const h = (hex || '#10B981').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// Google-Meet-style colourful tile canvas: a dark card washed with the
// participant's accent in two opposite corners so each person's tile reads as a
// distinct, saturated colour (not the same flat grey). The centre stays dark so
// the avatar / name overlay keep their contrast.
function tileBackground(accent) {
  return (
    `radial-gradient(135% 115% at 12% 0%, ${withAlpha(accent, 0.45)} 0%, transparent 58%),` +
    `radial-gradient(135% 115% at 100% 100%, ${withAlpha(accent, 0.30)} 0%, transparent 55%),` +
    `linear-gradient(150deg, ${withAlpha(accent, 0.12)} 0%, ${CARD} 60%)`
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

function ParticipantTileImpl({ trackRef, isHero, fit = 'cover', accent }) {
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
            <VideoTrack trackRef={trackRef} className="absolute inset-0 h-full w-full bg-black object-contain" />
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

  const speaking = isSpeaking && !micMuted
  // Live status shown under the name: Muted (red) · Speaking (accent) · Active.
  const statusText = micMuted ? 'Muted' : speaking ? 'Speaking' : 'Active'
  const statusColor = micMuted ? '#F87171' : speaking ? tileAccent : '#34D399'

  return (
    <div
      className={
        'group relative isolate h-full w-full overflow-hidden rounded-[28px] ' +
        'transition-[transform,box-shadow] duration-[250ms] ease-out ' +
        (speaking ? 'zk-tile-speak scale-[1.015]' : 'zk-tile-rest')
      }
      style={{
        // Colourful per-participant canvas (Google-Meet style), plus accent
        // custom props that drive the rest / speaking glow keyframes in CSS so
        // every tile carries a dense accent border and the active speaker pulses
        // brightly in their own colour — the Teams / Discord "who's talking" cue.
        background: tileBackground(tileAccent),
        '--tile-accent': tileAccent,
        '--tile-soft': withAlpha(tileAccent, 0.55),
        '--tile-faint': withAlpha(tileAccent, 0.18),
        '--tile-glow': withAlpha(tileAccent, 0.5),
        '--tile-glow-soft': withAlpha(tileAccent, 0.32),
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
        <div className="absolute inset-0 grid place-items-center" style={{ background: tileBackground(tileAccent) }}>
          <div className="flex flex-col items-center gap-3.5">
            <div
              className={
                'grid place-items-center rounded-full font-semibold text-white ' +
                (isHero ? 'h-32 w-32 text-5xl' : 'h-24 w-24 text-3xl')
              }
              style={{
                background: `linear-gradient(145deg, ${withAlpha(tileAccent, 1)} 0%, ${withAlpha(tileAccent, 0.7)} 100%)`,
                boxShadow: speaking
                  ? `0 0 0 3px ${tileAccent}, 0 0 0 10px ${withAlpha(tileAccent, 0.18)}, 0 0 28px 2px ${withAlpha(tileAccent, 0.5)}`
                  : `inset 0 1px 0 rgba(255,255,255,0.25), 0 0 0 4px ${withAlpha(tileAccent, 0.12)}, 0 8px 24px -8px ${withAlpha(tileAccent, 0.5)}`,
              }}
            >
              {displayName.slice(0, 1).toUpperCase()}
            </div>
            {speaking ? (
              <VoiceBars participant={trackRef.participant} accent={tileAccent} />
            ) : (
              <span className="text-[12.5px] font-medium text-[#94A3B8]">Camera off</span>
            )}
          </div>
        </div>
      )}

      {/* Hand raised — top-left chip */}
      {raised && (
        <div className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-[#F59E0B] text-[#0B1220] shadow-lg ring-1 ring-white/20" title="Hand raised">
          <Hand className="h-4 w-4" />
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

      {/* Bottom-left identity block — name line + live status line. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3.5">
        <div className="flex max-w-[calc(100%-2rem)] flex-col gap-1 rounded-xl bg-black/45 px-2.5 py-1.5 ring-1 ring-white/10 backdrop-blur-md">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white">
            {isPinned && <PinnedNameIcon />}
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tileAccent }} />
            <span className="truncate">{displayName}{isSelf && ' (You)'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium leading-none">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
            <span style={{ color: statusColor }}>{statusText}</span>
          </div>
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
    a.accent === b.accent,
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
