import { memo } from 'react'
import { CAPTION_CONFIG } from './config'

// Two-digit clock time (local) for the caption's last update. Cheap, no deps.
function clock(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/**
 * One speaker's live caption — Meet/Teams style: avatar + coloured name +
 * optional GUEST badge + a live "speaking" pulse, then the transcript. Committed
 * finals render solid; the trailing interim (partial) renders dimmed, so growth
 * is visible without the whole line flickering. Memoised so an unrelated
 * speaker's update never re-renders this bubble.
 *
 * @param {{ name, color, initials, isGuest, finalText, partial, ts, speaking }} p
 */
function CaptionBubble({ name, color, initials, isGuest, finalText, partial, ts, speaking }) {
  const fs = CAPTION_CONFIG.fontScale || 1
  const accent = color || '#cbd5e1'
  return (
    <div
      className="pointer-events-none flex w-fit max-w-[min(94vw,54rem)] items-start gap-2.5
                 rounded-2xl bg-black/70 px-3.5 py-2 text-white shadow-lg ring-1 ring-white/10
                 backdrop-blur-md supports-backdrop-filter:bg-black/55
                 forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] forced-colors:ring-[CanvasText]"
      role="listitem"
      aria-label={`${name}${isGuest ? ' (guest)' : ''} said: ${finalText} ${partial}`.trim()}
    >
      {/* Speaker avatar (initials on the speaker's stable colour) */}
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        {initials || '?'}
      </span>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="truncate text-[11px] font-semibold uppercase tracking-wide opacity-95"
            style={{ color: accent, fontSize: `${11 * fs}px` }}
          >
            {name}
          </span>
          {isGuest && (
            <span className="rounded bg-white/15 px-1 text-[9px] font-bold uppercase tracking-wider text-white/80">
              Guest
            </span>
          )}
          {/* Live speaking pulse — shown only while an interim is streaming */}
          {speaking && (
            <span className="flex items-center gap-0.5" aria-hidden="true">
              <span className="h-1 w-1 animate-pulse rounded-full" style={{ backgroundColor: accent }} />
              <span className="h-1 w-1 animate-pulse rounded-full [animation-delay:150ms]" style={{ backgroundColor: accent }} />
              <span className="h-1 w-1 animate-pulse rounded-full [animation-delay:300ms]" style={{ backgroundColor: accent }} />
            </span>
          )}
          <span className="ml-auto pl-2 text-[9px] tabular-nums text-white/40">{clock(ts)}</span>
        </div>
        <div
          className="line-clamp-3 font-medium leading-snug text-white/95"
          style={{ fontSize: `${15 * fs}px` }}
        >
          {finalText}
          {partial && (
            <>
              {finalText ? ' ' : ''}
              <span className="text-white/60">{partial}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(CaptionBubble)
