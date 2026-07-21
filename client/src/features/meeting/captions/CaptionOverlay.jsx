import { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CAPTION_CONFIG } from './config'
import { useCaptionControls, useLiveCaptions } from './useCaptions'
import CaptionBubble from './CaptionBubble'
import { useRoomStore } from '../state/roomStore.js'

/**
 * Bottom-centre caption stack, above the toolbar (Meet placement). Shows one
 * live caption per speaker (no scrolling transcript), capped to the most recent
 * N speakers, with smooth FLIP fade as speakers change.
 *
 * Subscribes ONLY to the caption buffer store (via useLiveCaptions), so caption
 * frames never touch the participant grid. Each bubble is keyed by the stable
 * speaker identity and memoised, so an update to one speaker leaves the others'
 * DOM untouched — incremental updates, no full-stack re-render, no flicker.
 *
 * The stack is pointer-events-none and sits in normal flow at the bottom of the
 * stage column, so it can never overlap the dock controls.
 */
export default function CaptionOverlay() {
  const { enabled } = useCaptionControls()
  const { bySpeaker } = useLiveCaptions()
  // In hero mode (screen share / speaker view) phones & portrait tablets show a
  // bottom participant carousel; lift the caption stack so it clears faces. On
  // desktop the strip sits on the right, so captions stay at the normal bottom.
  const heroActive = useRoomStore((s) => s.heroActive)

  const visible = useMemo(
    () =>
      Object.values(bySpeaker)
        .sort((a, b) => a.ts - b.ts)
        .slice(-CAPTION_CONFIG.maxSpeakers),
    [bySpeaker],
  )

  // Captions RENDER only when the local user has CC on. Capture may still be
  // running for other viewers (see CaptionProvider) — that's independent.
  if (!enabled || visible.length === 0) return null

  return (
    <div
      className={
        'pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center gap-1.5 px-3 ' +
        'transition-[bottom] duration-300 ' +
        (heroActive ? 'bottom-38 sm:bottom-42 lg:bottom-3' : 'bottom-3')
      }
      role="log"
      aria-label="Live captions"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions text"
    >
      <AnimatePresence initial={false}>
        {visible.map((c) => (
          <motion.div
            key={c.speakerId}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.1, ease: 'easeOut' }}
          >
            <CaptionBubble
              name={c.name}
              color={c.color}
              initials={c.initials}
              isGuest={c.isGuest}
              finalText={c.finalText}
              partial={c.partial}
              ts={c.ts}
              speaking={!!c.partial}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
