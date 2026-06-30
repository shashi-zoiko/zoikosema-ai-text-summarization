import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CAPTION_CONFIG } from './config'
import { useCaptionControls, useLiveCaptions } from './useCaptions'
import CaptionBubble from './CaptionBubble'

/**
 * Bottom-centre caption stack, above the toolbar (Google-Meet placement). Shows
 * only the latest live caption per speaker (no scrolling transcript), capped to
 * the most recent N speakers, with smooth fade in/out as speakers change.
 *
 * Reads the live-caption context exclusively, so frequent caption updates never
 * touch the participant grid. The whole stack is pointer-events-none and sits in
 * normal flow at the bottom of the stage column, so it can never overlap the
 * dock controls (which render below this column).
 */
export default function CaptionOverlay() {
  const { enabled } = useCaptionControls()
  const { bySpeaker } = useLiveCaptions()

  const visible = useMemo(
    () =>
      Object.entries(bySpeaker)
        .map(([speakerId, c]) => ({ speakerId, ...c }))
        .sort((a, b) => a.ts - b.ts)
        .slice(-CAPTION_CONFIG.maxSpeakers),
    [bySpeaker],
  )

  if (!enabled || visible.length === 0) return null

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-1.5 px-3"
      role="region"
      aria-label="Live captions"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence initial={false}>
        {visible.map((c) => (
          <motion.div
            key={c.speakerId}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <CaptionBubble name={c.name} color={c.color} text={c.text} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
