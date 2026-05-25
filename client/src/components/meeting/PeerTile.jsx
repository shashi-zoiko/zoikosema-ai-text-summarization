import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { Crown, Hand, MicOff, Pin, ShieldCheck } from 'lucide-react'

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
  const subscribeTrack = useCallback((callback) => {
    if (!peer.stream) return () => {}
    const vt = peer.stream.getVideoTracks()[0]
    if (!vt) return () => {}
    vt.addEventListener('mute', callback)
    vt.addEventListener('unmute', callback)
    vt.addEventListener('ended', callback)
    return () => {
      vt.removeEventListener('mute', callback)
      vt.removeEventListener('unmute', callback)
      vt.removeEventListener('ended', callback)
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

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    // Null first so Chromium tears down the previous audio/video decoders
    // before the new stream attaches. Skipping this is the root cause of
    // the "audio doubles for a beat after rejoin" symptom.
    if (el.srcObject !== peer.stream) {
      el.srcObject = null
      if (peer.stream) el.srcObject = peer.stream
    }
    return () => {
      if (el) el.srcObject = null
    }
  }, [peer.stream])

  const videoOff = peer.video === false || trackInactive
  const audioOff = peer.audio === false
  const isScreen = !!peer.screen

  const initial = useMemo(() => {
    const n = (peer.name || '?').trim()
    return n ? n.charAt(0).toUpperCase() : '?'
  }, [peer.name])

  const avatarColor = peer.color || '#3a6ff3'

  return (
    <div
      className={
        'relative isolate flex h-full w-full overflow-hidden rounded-2xl bg-[#202124] ' +
        (speaking ? 'ring-2 ring-[#8ab4f8]' : 'ring-1 ring-white/5') +
        (spotlight ? ' shadow-lg shadow-black/40' : '')
      }
    >
      {/* Dedicated audio sink — ALWAYS mounted regardless of camera state.
          This is what keeps the peer audible after they turn their camera
          off. Do not move into the conditional below. */}
      <audio ref={audioRef} autoPlay playsInline />

      {!videoOff && peer.stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={
            'absolute inset-0 h-full w-full ' +
            (isScreen ? 'object-contain bg-black' : 'object-cover')
          }
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[#202124]">
          <div
            className={
              'grid place-items-center rounded-full font-semibold text-white ' +
              (spotlight ? 'h-28 w-28 text-4xl' : mini ? 'h-10 w-10 text-base' : 'h-20 w-20 text-2xl')
            }
            style={{ backgroundColor: avatarColor }}
          >{initial}</div>
        </div>
      )}

      {/* Hand raised (top-left) */}
      {peer.hand && !mini && (
        <div
          className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-amber-400 text-zinc-900 shadow"
          title="Hand raised"
        >
          <Hand className="h-4 w-4" />
        </div>
      )}

      {/* Pin button (top-right, hover-revealed) */}
      {onTogglePin && !mini && (
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(peer.peer_id) }}
          className={
            'absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full transition ' +
            (pinned
              ? 'bg-[#8ab4f8]/20 text-[#8ab4f8] opacity-100'
              : 'bg-black/55 text-white/85 opacity-0 backdrop-blur hover:bg-black/70 group-hover/tile:opacity-100')
          }
          title={pinned ? 'Unpin' : 'Pin to main view'}
          aria-label={pinned ? 'Unpin' : 'Pin to main view'}
        >
          <Pin className="h-4 w-4" />
        </button>
      )}

      {/* Bottom name bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
        <div className={
          'flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 font-medium text-white backdrop-blur-sm ' +
          (mini ? 'text-[11px]' : 'text-xs')
        }>
          <span className="truncate">{peer.name || '…'}{isScreen ? ' · Presenting' : ''}</span>
          {peer.role === 'host' && <Crown className="h-3 w-3 shrink-0 text-amber-300" />}
          {peer.role === 'co_host' && <ShieldCheck className="h-3 w-3 shrink-0 text-cyan-300" />}
        </div>

        {audioOff && (
          <div
            className={
              'grid place-items-center rounded-full bg-[#ea4335] text-white shadow ' +
              (mini ? 'h-6 w-6' : 'h-7 w-7')
            }
            title="Muted"
          >
            <MicOff className={mini ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(PeerTile)
