import { useEffect, useRef, useState } from 'react'
import { useLocalParticipant, useTracks } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { MonitorUp, PictureInPicture2, Square, X } from 'lucide-react'

const PIP_SUPPORTED = typeof window !== 'undefined' && 'documentPictureInPicture' in window

// Deterministic avatar colour per identity (mirrors ParticipantTile's palette)
// so the presenter's banner avatar matches their tile colour.
const AVATAR_COLORS = ['#7C3AED', '#2563EB', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#3B82F6', '#8B5CF6']
function avatarColor(seed) {
  if (!seed) return AVATAR_COLORS[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

/**
 * Persistent "X is presenting" banner — the Google Meet affordance that keeps
 * the presenter aware they're sharing and gives everyone a one-glance label of
 * who owns the stage. Must render inside <LiveKitRoom>.
 *
 * Also owns the screen-reader announcements (Phase 11): an aria-live region
 * speaks "<name> started presenting" / "Presentation ended" on every change.
 */
export default function PresenterBanner() {
  const { localParticipant } = useLocalParticipant()
  const tracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], {
    onlySubscribed: false,
  })
  const share = tracks[0]
  const presenter = share?.participant
  const isLocal = !!presenter?.isLocal
  const name = presenter?.name || presenter?.identity || 'Someone'

  const [hidden, setHidden] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const prevRef = useRef(null)

  // Announce + re-reveal the banner whenever the presenter identity changes.
  // Hiding the banner is a per-presentation choice; a new presentation resets it.
  useEffect(() => {
    const prev = prevRef.current
    const curr = presenter?.identity || null
    if (curr === prev) return
    if (curr) {
      setHidden(false)
      setAnnouncement(`${isLocal ? 'You' : name} started presenting`)
    } else if (prev) {
      setAnnouncement('Presentation ended')
    }
    prevRef.current = curr
  }, [presenter, isLocal, name])

  const stopShare = () => localParticipant?.setScreenShareEnabled(false).catch(() => {})
  const togglePiP = () => window.dispatchEvent(new CustomEvent('zoiko:toggle-pip'))

  return (
    <>
      {/* Screen-reader-only live region. Visually hidden, always mounted so the
          assistive tech keeps observing it. */}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>

      {share && !hidden && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-[calc(100%-1rem)] items-center gap-2.5 rounded-2xl bg-[#202124]/95 py-2 pl-2.5 pr-2 text-white shadow-[0_12px_36px_-12px_rgba(0,0,0,0.75)] ring-1 ring-white/12 backdrop-blur-xl">
            {/* Presenter avatar with a screen badge — one glance tells everyone
                whose screen owns the stage. */}
            <span className="relative shrink-0">
              <span
                className="grid h-9 w-9 place-items-center rounded-full text-[13px] font-semibold text-white ring-1 ring-white/15"
                style={{ background: avatarColor(presenter?.identity || name) }}
              >
                {name.slice(0, 1).toUpperCase()}
              </span>
              <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-[#0B1220] ring-2 ring-[#202124]">
                <MonitorUp className="h-2.5 w-2.5" />
              </span>
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold">
                {/* Pulsing live dot — the meeting is actively being presented. */}
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                {isLocal ? "You're presenting" : `${name} is presenting`}
              </span>
              <span className="hidden text-[11px] text-white/55 sm:block">
                {isLocal ? 'Everyone can see your screen' : 'Shared screen'}
              </span>
            </span>

            {isLocal && (
              <>
                <span className="mx-0.5 h-6 w-px shrink-0 bg-white/12" aria-hidden="true" />

                {PIP_SUPPORTED && (
                  <button
                    type="button"
                    onClick={togglePiP}
                    title="Pop out a floating preview"
                    aria-label="Open picture-in-picture preview"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-[12.5px] font-medium text-white ring-1 ring-white/10 transition hover:bg-white/20 active:scale-[0.97]"
                  >
                    <PictureInPicture2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Pop out</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={stopShare}
                  title="Stop presenting"
                  aria-label="Stop presenting"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#ea4335] px-3.5 text-[12.5px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(234,67,53,0.85)] transition hover:bg-[#d33b2c] active:scale-[0.97]"
                >
                  <Square className="h-3 w-3 fill-current" />
                  Stop presenting
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setHidden(true)}
              title="Hide banner"
              aria-label="Hide presenting banner"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
