import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { Crown, Hand, MicOff, ShieldCheck } from 'lucide-react'
import { PinButton, PinnedNameIcon } from './PinControls.jsx'

/**
 * Google Meet–style participant tile.
 *
 * Calm by design: no ambient orbs, no idle float, no animated rings. Speaking
 * state is a thin colored border. Video off shows a solid dark tile with a
 * circular avatar in the center, matching Meet's behavior.
 *
 * Memoized so toggling unrelated peer state on another tile doesn't force
 * every tile to re-render and re-attach its <video> element.
 *
 * AUDIO ARCHITECTURE — read before touching:
 *   Remote audio is rendered through a **dedicated** <audio> element that is
 *   always mounted, independent of the camera state. The <video> element is
 *   `muted` so the same stream's audio tracks don't double-play through it.
 *   Older revisions relied on the <video> element to play audio; that broke
 *   the moment a peer turned off their camera (the <video> unmounted and the
 *   audio sink went with it — peer became inaudible). DO NOT remove the
 *   <audio> element or remove `muted` from the <video>.
 */
function PeerTile({
  peer,
  spotlight = false,
  mini = false,
  speaking = false,
  pinned = false,
  onTogglePin,
}) {
  const videoRef = useRef(null)
  const audioRef = useRef(null)

  // Track-level mute / end is the WebRTC-native fallback to `peer.video`.
  // When the remote side stops sending frames the receiver's track fires
  // `mute`. Catching this means the tile clears the moment frames stop —
  // even if the `media-state` WS event is delayed. Otherwise Chromium keeps
  // the last decoded frame painted forever (the "ghost face" bug).
  //
  // CRITICAL: we also listen to the *stream's* addtrack/removetrack events.
  // When a peer turns their camera on AFTER we already built the PC (joined
  // camera-off, then enabled), the new video track is added to the SAME
  // remote MediaStream via renegotiation. ontrack short-circuits on the
  // known stream id, so the only signal we get is the stream's `addtrack`.
  // Without rebinding here, that late track's `unmute` is never observed and
  // the tile stays on the avatar placeholder forever.
  const subscribeTrack = useCallback((callback) => {
    const stream = peer.stream
    if (!stream) return () => {}
    let boundTrack = null
    const bind = () => {
      const vt = stream.getVideoTracks()[0] || null
      if (vt === boundTrack) return
      if (boundTrack) {
        boundTrack.removeEventListener('mute', callback)
        boundTrack.removeEventListener('unmute', callback)
        boundTrack.removeEventListener('ended', callback)
      }
      boundTrack = vt
      if (vt) {
        vt.addEventListener('mute', callback)
        vt.addEventListener('unmute', callback)
        vt.addEventListener('ended', callback)
      }
    }
    const onStreamChange = () => { bind(); callback() }
    bind()
    stream.addEventListener('addtrack', onStreamChange)
    stream.addEventListener('removetrack', onStreamChange)
    return () => {
      stream.removeEventListener('addtrack', onStreamChange)
      stream.removeEventListener('removetrack', onStreamChange)
      if (boundTrack) {
        boundTrack.removeEventListener('mute', callback)
        boundTrack.removeEventListener('unmute', callback)
        boundTrack.removeEventListener('ended', callback)
      }
    }
  }, [peer.stream])

  const getTrackInactive = useCallback(() => {
    if (!peer.stream) return false
    const vt = peer.stream.getVideoTracks()[0]
    if (!vt) return true
    return vt.muted || vt.readyState === 'ended'
  }, [peer.stream])

  const trackInactive = useSyncExternalStore(subscribeTrack, getTrackInactive, getTrackInactive)

  // Attach remote audio. ALWAYS mounted — independent of videoOff. This is
  // the canonical audio sink for the peer; the <video> stays muted.
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    if (el.srcObject !== peer.stream) {
      el.srcObject = null
      if (peer.stream) el.srcObject = peer.stream
    }
    if (!peer.stream) return
    el.volume = 1.0
    el.muted = false
    // Browser autoplay policy can reject the initial .play() on a freshly
    // attached MediaStream when the user has not yet gestured on the page
    // (typical deep-link / new-tab join). Retry on the next user gesture.
    const tryPlay = () => {
      const p = el.play()
      if (!p) return
      p.catch(() => {
        const resume = () => {
          el.play().catch(() => {})
          window.removeEventListener('pointerdown', resume, true)
          window.removeEventListener('keydown', resume, true)
          window.removeEventListener('touchstart', resume, true)
        }
        window.addEventListener('pointerdown', resume, true)
        window.addEventListener('keydown', resume, true)
        window.addEventListener('touchstart', resume, true)
      })
    }
    tryPlay()
    // If the element is ever paused by the browser (tab throttle, sleep,
    // bluetooth reroute), kick it back into playback automatically.
    const onPause = () => { if (el.srcObject) el.play().catch(() => {}) }
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('pause', onPause)
      if (el) el.srcObject = null
    }
  }, [peer.stream])

  // Callback ref — NOT useEffect. The <video> below is conditionally mounted
  // (only when the peer's camera is active). A remote track arrives `muted`
  // (no RTP yet), so on first render videoOff is true and the element does
  // not exist. When the track later `unmute`s the element mounts, but
  // `peer.stream` has not changed — so a `useEffect([peer.stream])` would NOT
  // re-run and srcObject would never be assigned, leaving a permanently blank
  // remote tile. THIS was the "others can't see my camera" root cause.
  //
  // A callback ref fires every time the node mounts or unmounts, so srcObject
  // is (re)attached the instant the element appears, and cleared when it
  // leaves (preventing Chromium from compositing the last decoded frame onto
  // a detached node — the "ghost face").
  const attachVideoEl = useCallback((el) => {
    const prev = videoRef.current
    if (prev && prev !== el) { try { prev.srcObject = null } catch {} }
    videoRef.current = el
    if (!el) return
    // Null first so Chromium tears down the previous decoder before binding
    // the new stream (avoids a 1-frame ghost / "audio doubles after rejoin").
    if (peer.stream) {
      if (el.srcObject !== peer.stream) {
        try { el.srcObject = null } catch {}
        try { el.srcObject = peer.stream } catch {}
      }
    } else {
      try { el.srcObject = null } catch {}
    }
  }, [peer.stream])

  const isScreen = !!peer.screen
  // When the peer is screen-sharing, the live video sender carries the SCREEN
  // track — NOT the camera — so `peer.video` (the camera flag) is irrelevant.
  // A presenter who shares with their camera OFF still has video:false in
  // media-state; gating on it here would render the avatar placeholder over a
  // perfectly good screen track (the "remote can't see the share" bug). During
  // a share we only care whether the track itself is live (trackInactive).
  const videoOff = isScreen ? trackInactive : (peer.video === false || trackInactive)
  const audioOff = peer.audio === false

  const initial = useMemo(() => {
    const n = (peer.name || '?').trim()
    return n ? n.charAt(0).toUpperCase() : '?'
  }, [peer.name])

  const avatarColor = peer.color || '#3a6ff3'

  return (
    <div
      className={
        'relative isolate flex h-full w-full overflow-hidden rounded-2xl bg-[#e8eaed] ' +
        (speaking ? 'ring-2 ring-[#1a73e8]' : 'ring-1 ring-black/[0.06]') +
        (spotlight ? ' shadow-lg shadow-black/40' : '')
      }
    >
      {/* Dedicated audio sink — ALWAYS mounted regardless of camera state.
          This is what keeps the peer audible after they turn their camera
          off. Do not move into the conditional below. */}
      <audio ref={audioRef} autoPlay playsInline />

      {!videoOff && peer.stream ? (
        <video
          ref={attachVideoEl}
          autoPlay
          playsInline
          muted
          className={
            'absolute inset-0 h-full w-full ' +
            (isScreen ? 'object-contain bg-black' : 'object-cover')
          }
        />
      ) : (
        // No-video state: solid colored tile with the user's avatar
        // initial centered. Meet picks a deterministic color per user; we
        // honour their saved `avatar_color`. The gradient is subtle — a
        // 70%→100% darkening of the same hue, never a hard ring.
        <div
          className="absolute inset-0 grid place-items-center"
          style={{
            background: `radial-gradient(circle at 50% 35%, ${avatarColor} 0%, color-mix(in srgb, ${avatarColor} 55%, #000) 100%)`,
          }}
        >
          <div
            className={
              'grid place-items-center rounded-full font-semibold text-white ring-1 ring-white/15 backdrop-blur-sm ' +
              'bg-white/[0.08] ' +
              (spotlight ? 'h-36 w-36 text-5xl' : mini ? 'h-10 w-10 text-base' : 'h-24 w-24 text-3xl')
            }
          >{initial}</div>
        </div>
      )}

      {/* Hand raised (top-left) */}
      {peer.hand && !mini && (
        <div
          className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-amber-400 text-zinc-900 shadow-md"
          title="Hand raised"
        >
          <Hand className="h-4 w-4" />
        </div>
      )}

      {/* Mic-off badge (top-right) — Meet places this in the top-right
          corner with a small filled circle. Hidden on mini tiles to avoid
          clutter; the name pill below the tile already signals state.   */}
      {audioOff && !mini && (
        <div
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm"
          title="Muted"
        >
          <MicOff className="h-3.5 w-3.5 text-[#ea4335]" />
        </div>
      )}

      {/* Pin button — rendered on every tile (mini included). Mic-off lives in
          the top-right on full tiles, so the pin slides left to clear it; on
          mini tiles the mic-off indicator moves to the name row, so no shift. */}
      {onTogglePin && (
        <PinButton
          pinned={pinned}
          onClick={(e) => { e.stopPropagation(); onTogglePin(peer.peer_id) }}
          mini={mini}
          shifted={audioOff && !mini}
          groupName="tile"
        />
      )}

      {/* Bottom name pill */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
        <div className={
          'flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 font-medium text-white backdrop-blur-sm ' +
          (mini ? 'text-[11px]' : 'text-[12.5px]')
        }>
          {pinned && <PinnedNameIcon mini={mini} />}
          <span className="truncate">{peer.name || '…'}{isScreen ? ' · Presenting' : ''}</span>
          {peer.role === 'host' && <Crown className="h-3 w-3 shrink-0 text-amber-300" />}
          {peer.role === 'co_host' && <ShieldCheck className="h-3 w-3 shrink-0 text-cyan-300" />}
        </div>

        {audioOff && mini && (
          // On mini tiles the mic-off indicator goes back to the name row
          // so the top-right corner stays clean.
          <div className="grid h-5 w-5 place-items-center rounded-full bg-[#ea4335] text-white shadow" title="Muted">
            <MicOff className="h-3 w-3" />
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(PeerTile)
