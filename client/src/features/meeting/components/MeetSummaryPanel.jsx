import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Pause, RefreshCw, Sparkles, X } from 'lucide-react'
import { api } from '../../../api/client.js'
import { useCaptionControls, useLiveCaptions } from '../captions/useCaptions.js'

function formatClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// Reshape our caption transcript into the {time, name, body} shape
// server/app/core/ai.py's _format_chat_log already reads (it also accepts
// timestamp/sender/user/text/content as fallback keys, so this is a safe,
// server-compatible mapping without any backend changes).
function transcriptToChatLog(transcript) {
  return transcript.map((line) => ({ time: formatClock(line.ts), name: line.name, body: line.text }))
}

// Flatten the AI intelligence payload's action_items/decisions/risks into one
// takeaways list — action items keep their assignee (owner), everything else
// renders as a plain important point. Mirrors what this panel has always
// shown; only the data source changed (real Claude-generated JSON via
// POST /api/meetings/{code}/intelligence, not a hardcoded constant).
function takeawaysFromPayload(payload) {
  if (!payload) return []
  const items = []
  for (const a of payload.action_items || []) {
    if (!a?.task) continue
    items.push({ assignee: a.owner || undefined, text: a.due ? `${a.task} (due ${a.due})` : a.task })
  }
  for (const d of payload.decisions || []) {
    if (!d?.title) continue
    items.push({ text: d.detail ? `${d.title}: ${d.detail}` : d.title })
  }
  for (const r of payload.risks || []) {
    if (!r?.title) continue
    items.push({ text: r.rationale ? `Risk: ${r.title} — ${r.rationale}` : `Risk: ${r.title}` })
  }
  return items
}

/**
 * "Meet Summarizer" panel — opened from the gradient header button. Same
 * overlay shell as ConversationsPanel (50%-width, full-height, backdrop
 * click / Escape to close).
 *
 * Real data, not mock: on open, loads whatever summary already exists for
 * this meeting (GET). Host/co-host gets a Generate/Regenerate button that
 * POSTs the accumulated caption transcript (see CaptionProvider) as the
 * request's `chat_log` — the existing `/api/meetings/{code}/intelligence`
 * endpoint and `ai_generate_intelligence` pipeline need no changes at all to
 * accept it. Polls while a generation is in flight, same pattern as the
 * full dashboard page (`pages/MeetingIntelligence.jsx`).
 *
 * The header button only opens/closes this panel — actually starting/
 * stopping capture happens from the "Start/Pause Summarizing" toggle INSIDE
 * here, reading `capturing`/`setCapturing` straight off CaptionsControlContext
 * (this panel renders inside CaptionProvider, so no prop drilling needed).
 * `onStart` is a separate, parent-owned callback fired only when the toggle
 * turns ON — it stamps the session's zero point in MeetRoomLivekit, which is
 * idempotent there (first call only), so calling it on every "on" is fine.
 */
export default function MeetSummaryPanel({ onClose, onStart, code, isHostOrCohost }) {
  const { capturing, setCapturing } = useCaptionControls()
  const { transcript } = useLiveCaptions()

  const [intel, setIntel] = useState(null) // latest MeetingIntelligenceOut, or null
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  const toggleCapturing = () => {
    const next = !capturing
    setCapturing(next)
    if (next) onStart?.()
  }

  // Whatever summary already exists for this meeting, loaded once on open.
  useEffect(() => {
    if (!code) return
    let cancelled = false
    api(`/api/meetings/${code}/intelligence`)
      .then((data) => { if (!cancelled) setIntel(data) })
      .catch(() => { /* no existing summary yet — not worth surfacing as an error */ })
    return () => { cancelled = true }
  }, [code])

  useEffect(() => () => clearTimeout(pollRef.current), [])

  const generate = useCallback(async () => {
    if (!code || transcript.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const result = await api(`/api/meetings/${code}/intelligence`, {
        method: 'POST',
        body: { chat_log: transcriptToChatLog(transcript), force: true },
      })
      setIntel(result)
      // Mirrors pages/MeetingIntelligence.jsx: generation can come back still
      // in flight — poll until it settles instead of leaving a stale "..." row.
      const poll = async () => {
        try {
          const latest = await api(`/api/meetings/${code}/intelligence`)
          setIntel(latest)
          if (latest?.status === 'generating' || latest?.status === 'pending') {
            pollRef.current = setTimeout(poll, 2500)
          } else {
            setLoading(false)
          }
        } catch {
          setLoading(false)
        }
      }
      if (result.status === 'generating' || result.status === 'pending') {
        pollRef.current = setTimeout(poll, 2500)
      } else {
        setLoading(false)
        if (result.status === 'failed') setError(result.error_message || 'Summary generation failed.')
      }
    } catch (e) {
      setError(e.message || 'Summary generation failed.')
      setLoading(false)
    }
  }, [code, transcript])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ready = intel?.status === 'ready' && intel.payload
  const takeaways = ready ? takeawaysFromPayload(intel.payload) : []

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

          {isHostOrCohost && (
            <button
              type="button"
              onClick={generate}
              disabled={loading || transcript.length === 0}
              className="mb-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? 'Generating…' : ready ? 'Regenerate Summary' : 'Generate Summary'}
            </button>
          )}

          {error && (
            <div className="mb-6 flex items-start gap-2 rounded-xl border border-[#F87171]/30 bg-[#EF4444]/10 px-3.5 py-3 text-[13px] text-[#F87171]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {ready ? (
            <>
              <h1 className="text-center text-2xl font-bold text-white">Meeting Summary</h1>

              <p className="mt-4 text-[14px] leading-relaxed text-[#CBD5E1]">
                {intel.tldr}
              </p>

              <h3 className="mb-3 mt-8 text-[13px] font-semibold uppercase tracking-wide text-[#94A3B8]">
                Key Takeaways
              </h3>
              {takeaways.length === 0 ? (
                <p className="text-[13px] text-[#94A3B8]">No action items, decisions, or risks were identified.</p>
              ) : (
                <ul className="space-y-2.5">
                  {takeaways.map((item, i) => (
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
              )}
            </>
          ) : (
            !loading && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-[#1E293B] text-[#94A3B8]">
                  <Sparkles className="h-5 w-5" />
                </span>
                <p className="text-[13px] leading-relaxed text-[#94A3B8]">
                  {transcript.length === 0 ? (
                    <>Nothing captured yet.<br />Turn on summarizing above and start talking.</>
                  ) : isHostOrCohost ? (
                    <>No summary yet.<br />Click Generate Summary to create one.</>
                  ) : (
                    <>No summary yet.<br />Ask the host to generate one.</>
                  )}
                </p>
              </div>
            )
          )}
        </div>
      </aside>
    </div>
  )
}
