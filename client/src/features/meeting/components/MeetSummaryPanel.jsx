import { useEffect } from 'react'
import { Sparkles, X } from 'lucide-react'

// Mock data — stands in for the real summary until it's generated from the
// accumulated transcript (see ConversationsPanel/CaptionProvider) via the AI
// intelligence pipeline. Same shape the real response is expected to take:
// a title, a paragraph summary, and a list of takeaways where `assignee` is
// set for action items and omitted for general important points.
const MOCK_SUMMARY = {
  title: 'Q3 Product Roadmap Sync',
  summary:
    'The team reviewed progress on the Q3 roadmap, discussed budget constraints ' +
    'for the upcoming feature rollout, and aligned on next steps for the mobile ' +
    'redesign. Overall the discussion was productive, with a couple of open ' +
    'concerns raised around timeline slippage on the API migration and pending ' +
    'budget sign-off from finance.',
  keyTakeaways: [
    { assignee: 'Ravi', text: 'Follow up with the design team on updated mockups by Friday.' },
    { assignee: 'Shashi', text: 'Send the updated project timeline to stakeholders.' },
    { text: 'Budget approval for Q3 marketing spend is still pending from finance.' },
    { text: 'API migration is at risk of slipping past the Aug 15 deadline — needs escalation.' },
    { text: 'Mobile redesign mockups received positive feedback from the team.' },
  ],
}

/**
 * "Meet Summarizer" panel — opened from the gradient header button. Same
 * overlay shell as ConversationsPanel (50%-width, full-height, backdrop
 * click / Escape to close). Renders MOCK_SUMMARY for now; once the caption
 * transcript is wired into the AI intelligence pipeline this becomes a real
 * fetch keyed off the meeting code instead of a constant.
 *
 * The header button only opens/closes this panel — actually starting
 * capture happens from the "Start Summarizing" button INSIDE here
 * (`onStart`), kept as a distinct step rather than something that fires the
 * instant the panel opens.
 */
export default function MeetSummaryPanel({ onClose, onStart, startedAt }) {
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

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-[#263244] bg-[#0B1220] px-4 py-3">
            <span className="inline-flex items-center gap-2 text-[13px] text-[#94A3B8]">
              {startedAt ? (
                <>
                  <span className="relative grid h-2 w-2 place-items-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10B981] opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#10B981]" />
                  </span>
                  <span className="font-medium text-white">Summarizing this conversation</span>
                </>
              ) : (
                'Not started yet'
              )}
            </span>
            <button
              type="button"
              onClick={onStart}
              disabled={!!startedAt}
              className={
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ' +
                (startedAt
                  ? 'cursor-default bg-[#1E293B] text-[#94A3B8]'
                  : 'bg-gradient-to-br from-violet-500 to-pink-500 text-white hover:brightness-110')
              }
            >
              <Sparkles className="h-3.5 w-3.5" />
              {startedAt ? 'Started' : 'Start Summarizing'}
            </button>
          </div>

          <h1 className="text-center text-2xl font-bold text-white">{MOCK_SUMMARY.title}</h1>

          <p className="mt-4 text-[14px] leading-relaxed text-[#CBD5E1]">
            {MOCK_SUMMARY.summary}
          </p>

          <h3 className="mb-3 mt-8 text-[13px] font-semibold uppercase tracking-wide text-[#94A3B8]">
            Key Takeaways
          </h3>
          <ul className="space-y-2.5">
            {MOCK_SUMMARY.keyTakeaways.map((item, i) => (
              <li
                key={i}
                className="flex gap-2.5 rounded-xl border border-[#263244] bg-[#0B1220] px-3.5 py-3 text-[14px] leading-relaxed"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#A78BFA]" />
                <span>
                  {item.assignee && <span className="font-semibold text-white">{item.assignee}: </span>}
                  <span className="text-[#CBD5E1]">{item.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}
