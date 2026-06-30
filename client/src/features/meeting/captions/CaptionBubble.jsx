import { memo } from 'react'

/**
 * A single speaker's live caption — Google-Meet style: speaker name on top,
 * then the latest utterance clamped to 3 lines. Rounded, semi-transparent,
 * backdrop-blurred, adaptive width. Memoised so unrelated speaker updates don't
 * re-render this bubble.
 */
function CaptionBubble({ name, color, text }) {
  return (
    <div
      className="pointer-events-none w-fit max-w-[min(92vw,52rem)] rounded-2xl bg-black/70 px-4 py-2
                 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md
                 supports-[backdrop-filter]:bg-black/55"
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-90" style={{ color: color || '#cbd5e1' }}>
        {name}
      </div>
      <div className="line-clamp-3 text-[15px] leading-snug text-white/95">{text}</div>
    </div>
  )
}

export default memo(CaptionBubble)
