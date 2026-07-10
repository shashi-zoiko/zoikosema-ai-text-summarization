import { useEffect } from 'react'
import { Pause, Sparkles, X } from 'lucide-react'
import { useCaptionControls } from '../captions/useCaptions.js'

/**
 * "Meet Summarizer" panel — opened from the gradient header button. Same
 * overlay shell as ConversationsPanel (50%-width, full-height, backdrop
 * click / Escape to close).
 *
 * Capture control ONLY — no summary content renders here at all. The actual
 * summary is generated once, automatically, when the host leaves (their
 * accumulated transcript is POSTed to the existing
 * `/api/meetings/{code}/intelligence` endpoint, which branches to Groq — see
 * MeetRoomLivekit.jsx's userLeave), and shows up on that meeting's existing
 * Intelligence page (`/:code/intelligence`), host/admin-only. Nothing is
 * generated mid-meeting, so there's nothing to show here beyond the toggle.
 *
 * The header button only opens/closes this panel — starting/stopping
 * capture happens from the toggle INSIDE here, reading `capturing`/
 * `setCapturing` straight off CaptionsControlContext (this panel renders
 * inside CaptionProvider, so no prop drilling needed). `onStart` is a
 * separate, parent-owned callback fired only when the toggle turns ON — it
 * stamps the Conversations panel's session zero point in MeetRoomLivekit,
 * which is idempotent there (first call only), so calling it on every "on"
 * is fine.
 */
export default function MeetSummaryPanel({ onClose, onStart }) {
  const { capturing, setCapturing } = useCaptionControls()

  const toggleCapturing = () => {
    const next = !capturing
    setCapturing(next)
    if (next) onStart?.()
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/50"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-1/2 flex-col overflow-hidden border-l border-[#263244] bg-[#111827] text-white shadow-2xl"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#263244] px-4">
          <h2 className="text-[15px] font-semibold text-white">Meet Summarizer</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close meet summarizer"
            className="grid h-8 w-8 place-items-center rounded-full text-[#94A3B8] transition hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-6 text-center">
          <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-[#263244] bg-[#0B1220] px-4 py-3">
            <span className="inline-flex items-center gap-2 text-[13px] text-[#94A3B8]">
              {capturing ? (
                <>
                  <span className="relative grid h-2 w-2 place-items-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10B981] opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#10B981]" />
                  </span>
                  <span className="font-medium text-white">Summarizing this conversation</span>
                </>
              ) : (
                'Not capturing'
              )}
            </span>
            <button
              type="button"
              onClick={toggleCapturing}
              className={
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ' +
                (capturing
                  ? 'bg-[#10B981]/15 text-[#34D399] hover:bg-[#10B981]/25'
                  : 'bg-gradient-to-br from-violet-500 to-blue-500 text-white hover:brightness-110')
              }
            >
              {capturing ? <Pause className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {capturing ? 'Pause Summarizing' : 'Start Summarizing'}
            </button>
          </div>

          <div className="flex flex-col items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#1E293B] text-[#94A3B8]">
              <Sparkles className="h-5 w-5" />
            </span>
            <p className="max-w-xs text-[13px] leading-relaxed text-[#94A3B8]">
              Your summary isn't generated during the call — it's put together automatically
              once the host leaves, from everything captured above.
              <br /><br />
              Find it afterward on this meeting's <span className="font-medium text-white">Intelligence</span> page
              (host/admin only).
            </p>
          </div>
        </div>
      </aside>
    </div>
  )
}
