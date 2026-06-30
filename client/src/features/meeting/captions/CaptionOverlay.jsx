import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CAPTION_CONFIG } from './config'
import { useCaptionControls, useLiveCaptions } from './useCaptions'
import CaptionBubble from './CaptionBubble'
import { useRoomStore } from '../state/roomStore.js'

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
  // In hero mode (screen share / speaker view) phones & portrait tablets show a
  // horizontal participant carousel pinned to the BOTTOM of the stage column. The
  // caption stack must clear it instead of painting over faces (Phase 8). On
  // desktop the strip sits on the right, so captions stay at the normal bottom.
  const heroActive = useRoomStore((s) => s.heroActive)

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
      className={
        'pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center gap-1.5 px-3 ' +
        'transition-[bottom] duration-300 ' +
        (heroActive ? 'bottom-38 sm:bottom-42 lg:bottom-3' : 'bottom-3')
      }
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
