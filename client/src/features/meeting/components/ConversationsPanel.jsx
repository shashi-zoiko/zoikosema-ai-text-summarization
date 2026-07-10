import { useEffect, useMemo } from 'react'
import { MessagesSquare, X } from 'lucide-react'
import { useLiveCaptions } from '../captions/useCaptions.js'

// A gap this long since the previous line starts a new timestamp heading —
// keeps genuinely continuous back-and-forth under one heading instead of
// stamping every few seconds of dialogue.
const HEADING_GAP_MS = 20000

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`
}

// Transcript lines → time-headed groups, e.g.:
//   00:00:05
//   Alice: ...
//   Bob: ...
//   00:02:08
//   Alice: ...
function groupTranscript(transcript) {
  if (!transcript.length) return []
  const t0 = transcript[0].ts
  const groups = []
  let lastTs = null
  for (const line of transcript) {
    if (lastTs == null || line.ts - lastTs > HEADING_GAP_MS) {
      groups.push({ heading: formatElapsed(line.ts - t0), lines: [line] })
    } else {
      groups[groups.length - 1].lines.push(line)
    }
    lastTs = line.ts
  }
  return groups
}

/**
 * Full in-meeting transcript, grouped under timestamp headings — the
 * "Conversations" view opened from the gradient header button. A 50%-width,
 * full-height panel over the call; clicking the backdrop (anywhere outside
 * the panel) closes it, same as pressing Escape.
 */
export default function ConversationsPanel({ onClose }) {
  const { transcript } = useLiveCaptions()
  const groups = useMemo(() => groupTranscript(transcript), [transcript])

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
          <h2 className="text-[15px] font-semibold text-white">Conversations</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close conversations"
            className="grid h-8 w-8 place-items-center rounded-full text-[#94A3B8] transition hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {groups.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[#1E293B] text-[#94A3B8]">
                <MessagesSquare className="h-5 w-5" />
              </span>
              <p className="text-[13px] leading-relaxed text-[#94A3B8]">
                No conversation captured yet.<br />
                Turn on captions to start building the transcript.
              </p>
            </div>
          ) : (
            groups.map((g, i) => (
              <div key={i} className="mb-6">
                <div className="mb-2 text-[13px] font-semibold text-[#94A3B8]">{g.heading}</div>
                <div className="space-y-1.5">
                  {g.lines.map((line, j) => (
                    <p key={j} className="text-[14px] leading-relaxed">
                      <span className="font-semibold text-white">{line.name}:</span>{' '}
                      <span className="text-[#CBD5E1]">{line.text}</span>
                    </p>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
