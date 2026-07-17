import { FileText, Play, Square, X } from 'lucide-react'

/**
 * "Transcribing" card content — the Google-Meet-style status card shown
 * inside a popover anchored to the header's Conversations button (see
 * `ConversationsButton` in MeetingHeader.jsx, which owns the hover/click/
 * outside-click logic that shows/hides this). Purely presentational: no
 * positioning, no visibility state of its own.
 *
 * Layout mirrors Google Meet's own "Transcribing" popup: title + close,
 * two short paragraphs, then a bordered status row (icon, "Transcribing" /
 * "Paused" + language, pause/resume toggle) — copy adapted to what this
 * product actually does (no Google Drive save; an AI summary instead).
 * Deliberately no "view conversation" action: the conversation itself is
 * never shown in-meeting, only captured — the only place it's ever surfaced
 * is the post-meeting summary page's raw conversation log.
 *
 * `onToggle` (pause/resume) does NOT touch capture either way — it only
 * records the pause/resume boundary in MeetRoomLivekit's `pausedRanges`,
 * which narrows what the post-meeting raw log shows. Capture keeps running
 * silently in the background throughout, so the AI summary generated at
 * host-leave still covers the whole conversation regardless of pause state.
 */
export default function TranscribingCard({ isHostOrCohost, paused, onToggle, onClose }) {
  return (
    <div className="p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[14px] font-semibold text-white">Transcribing</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg !border-0 !bg-transparent !p-0 !shadow-none text-[#64748B] transition hover:!bg-white/[0.06] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-[#94A3B8]">
        This meeting is being transcribed to generate an AI summary for everyone who attended.
      </p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[#94A3B8]">
        Data collected from this meeting, including the spoken conversation, will be used and kept temporarily to create the summary.
      </p>

      <StatusRow isHostOrCohost={isHostOrCohost} paused={paused} onToggle={onToggle} className="mt-3" />
    </div>
  )
}

/** Icon + "Transcribing"/"Paused" + language, pause/resume toggle on the right. */
function StatusRow({ isHostOrCohost, paused, onToggle, className = '' }) {
  return (
    <div className={'flex items-center justify-between gap-3 rounded-xl border border-[#263244] bg-[#0B1220] px-3 py-2.5 ' + className}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5 text-[#94A3B8]">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-semibold text-white">{paused ? 'Paused' : 'Transcribing'}</div>
          <div className="text-[11.5px] text-[#94A3B8]">English</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={!isHostOrCohost}
        title={
          isHostOrCohost
            ? (paused ? 'Resume transcribing' : 'Pause transcribing')
            : `Only the host or an admin can ${paused ? 'resume' : 'pause'} this`
        }
        className={
          'grid h-8 w-8 shrink-0 place-items-center rounded-full transition ' +
          (isHostOrCohost ? 'bg-white text-[#EF4444] hover:bg-white/90' : 'cursor-not-allowed bg-white/10 text-[#475569]')
        }
      >
        {paused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Square className="h-3.5 w-3.5 fill-current" />}
      </button>
    </div>
  )
}
