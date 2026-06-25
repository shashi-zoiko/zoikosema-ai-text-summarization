import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocalParticipant, useTracks } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { MicOff, MonitorUp, Square } from 'lucide-react'

const SUPPORTED = typeof window !== 'undefined' && 'documentPictureInPicture' in window

// Clone every <style>/<link rel=stylesheet> into the PiP document so Tailwind
// utility classes resolve there too (the PiP window is a fresh, empty document).
function copyStyles(target) {
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    try {
      target.document.head.appendChild(node.cloneNode(true))
    } catch {
      /* a cross-origin <link> can throw on clone — skip it */
    }
  }
}

/**
 * Presenter Picture-in-Picture preview (Phase 4). Uses the Document
 * Picture-in-Picture API when available so the presenter can keep an eye on the
 * shared content + participants while they're in another tab/app.
 *
 *   • "Pop out" in the banner dispatches `zoiko:toggle-pip` → open/close here.
 *   • Best-effort auto-open when the presenter's tab is hidden (browsers that
 *     gate `requestWindow` behind a user gesture simply no-op — the button is
 *     the guaranteed path).
 *   • Closes automatically when the share stops or the room unmounts.
 *
 * Renders nothing in the normal DOM; everything lives in the PiP window via a
 * portal, so the LiveKit React context still flows into it.
 */
export default function PresenterPiP() {
  const { localParticipant } = useLocalParticipant()
  const tracks = useTracks(
    [
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Camera, withPlaceholder: true },
    ],
    { onlySubscribed: false },
  )
  const share = tracks.find((t) => t.source === Track.Source.ScreenShare)
  const cams = tracks.filter((t) => t.source === Track.Source.Camera)
  const isLocalPresenter = !!share?.participant?.isLocal

  const [pipWindow, setPipWindow] = useState(null)
  const winRef = useRef(null)

  const close = useCallback(() => {
    const w = winRef.current
    winRef.current = null
    if (w) try { w.close() } catch { /* already gone */ }
    setPipWindow(null)
  }, [])

  const open = useCallback(async () => {
    if (!SUPPORTED || winRef.current) return
    try {
      const w = await window.documentPictureInPicture.requestWindow({ width: 384, height: 288 })
      copyStyles(w)
      w.document.body.style.margin = '0'
      w.document.body.style.background = '#0b0b0d'
      w.addEventListener('pagehide', () => { winRef.current = null; setPipWindow(null) })
      winRef.current = w
      setPipWindow(w)
    } catch {
      /* needs a user gesture, or unsupported in this context — ignore */
    }
  }, [])

  // Manual toggle from the banner's "Pop out" button.
  useEffect(() => {
    const onToggle = () => (winRef.current ? close() : open())
    window.addEventListener('zoiko:toggle-pip', onToggle)
    return () => window.removeEventListener('zoiko:toggle-pip', onToggle)
  }, [open, close])

  // Best-effort auto-open when the presenter leaves the tab.
  useEffect(() => {
    if (!isLocalPresenter) return undefined
    const onVis = () => { if (document.hidden) open() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [isLocalPresenter, open])

  // Close when the share ends, and on unmount.
  useEffect(() => { if (!share) close() }, [share, close])
  useEffect(() => () => close(), [close])

  const stopShare = useCallback(() => {
    localParticipant?.setScreenShareEnabled(false).catch(() => {})
  }, [localParticipant])

  const canStop = !!share?.participant?.isLocal

  if (!pipWindow || !share) return null
  return createPortal(
    <PiPContent share={share} cams={cams} onStop={canStop ? stopShare : null} />,
    pipWindow.document.body,
  )
}

function PiPContent({ share, cams, onStop }) {
  return (
    <div className="flex h-screen w-screen flex-col bg-[#0b0b0d] text-white">
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-white/85">
          <MonitorUp className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          <span className="truncate">{onStop ? "You're presenting" : 'Presentation'}</span>
        </span>
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            title="Stop sharing"
            aria-label="Stop sharing"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#ea4335] px-2.5 py-1 text-[11px] font-semibold text-white shadow-[0_4px_12px_-4px_rgba(234,67,53,0.8)] transition hover:bg-[#d33b2c] active:scale-95"
          >
            <Square className="h-2.5 w-2.5 fill-current" />
            Stop sharing
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-2 pb-1.5">
        {cams.map((t) => (
          <PiPThumb key={`${t.participant?.identity}:${t.source}`} trackRef={t} />
        ))}
      </div>
      <div className="relative min-h-0 flex-1 bg-black">
        <ShareVideo trackRef={share} />
      </div>
    </div>
  )
}

function ShareVideo({ trackRef }) {
  const ref = useRef(null)
  const track = trackRef.publication?.track
  useEffect(() => {
    const el = ref.current
    if (!el || !track) return undefined
    try { track.attach(el) } catch { /* ignore */ }
    return () => { try { track.detach(el) } catch { /* ignore */ } }
  }, [track])
  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      className="absolute inset-0 h-full w-full object-contain"
    />
  )
}

function PiPThumb({ trackRef }) {
  const p = trackRef.participant
  const name = p?.name || p?.identity || 'Guest'
  const micOff = !p?.isMicrophoneEnabled
  return (
    <div className="relative grid aspect-video h-14 shrink-0 place-items-center overflow-hidden rounded-md bg-zinc-800">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-600 text-xs font-semibold">
        {name.slice(0, 1).toUpperCase()}
      </span>
      {micOff && (
        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-black/60">
          <MicOff className="h-2.5 w-2.5 text-[#ff6b5e]" />
        </span>
      )}
      <span className="absolute inset-x-1 bottom-0.5 truncate rounded bg-black/50 px-1 text-[10px] leading-tight">
        {name}
      </span>
    </div>
  )
}
