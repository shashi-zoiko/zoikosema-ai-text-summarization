import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { useGridLayout } from '../hooks/useGridLayout.js'

/**
 * Pure, LiveKit-free presentational layout for the meeting stage. Owns ALL of
 * the geometry + animation; it knows nothing about tracks, rooms or themes.
 *
 *   Stage.jsx  → maps LiveKit tracks to `items` and renders the real tiles.
 *   Harness    → feeds mock items + a coloured-box renderer to drive the layout
 *                in a browser without a live SFU.
 *
 * Props:
 *   items      — ordered [{ key, ...data }]. `key` must be STABLE per identity.
 *   heroKey    — key of the item to promote to the hero slot, or null/undefined
 *                for the adaptive gallery.
 *   heroFit    — 'cover' | 'contain' for the hero tile (screen share = contain).
 *   renderTile — (item, { isHero, fit }) => ReactNode. Renders one tile's body.
 */

export const GAP = 20 // px — premium spacing so accent glows never touch.

const EASE = [0.22, 1, 0.36, 1]
const TRANSITION = { duration: 0.26, ease: EASE }
const ENTER = { opacity: 0, scale: 0.85 }
const SHOW = { opacity: 1, scale: 1 }

export default function StageLayout({
  items,
  heroKey,
  heroFit = 'cover',
  filmstrip = 'right',
  renderTile,
}) {
  const hero = heroKey ? items.find((i) => i.key === heroKey) : null
  const others = hero ? items.filter((i) => i.key !== hero.key) : items

  if (items.length === 0) return <div className="flex-1" />

  // LayoutGroup + a per-key `layoutId` on every tile means the SAME tile is
  // tracked across the gallery↔hero swap. Pinning morphs that tile from its grid
  // slot into the hero (others slide into the filmstrip); unpinning plays the
  // exact reverse. Without it the two views are separate subtrees and the layout
  // would hard-cut instead of animating.
  return (
    <LayoutGroup>
      {hero ? (
        <HeroView
          hero={hero}
          heroFit={heroFit}
          others={others}
          placement={filmstrip}
          renderTile={renderTile}
        />
      ) : (
        <GalleryGrid items={items} renderTile={renderTile} />
      )}
    </LayoutGroup>
  )
}

function GalleryGrid({ items, renderTile }) {
  const [ref, grid] = useGridLayout(items.length, GAP)
  return (
    <div ref={ref} className="min-h-0 w-full flex-1 overflow-hidden p-6">
      <div
        className="flex h-full w-full flex-wrap content-center items-center justify-center"
        style={{ gap: GAP }}
      >
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <motion.div
              key={item.key}
              layoutId={item.key}
              layout
              initial={ENTER}
              animate={SHOW}
              exit={ENTER}
              transition={TRANSITION}
              style={{ width: grid.tileW, height: grid.tileH }}
              className="min-h-0 min-w-0"
            >
              {renderTile(item, { isHero: items.length === 1, fit: 'cover' })}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function HeroView({ hero, heroFit, others, placement, renderTile }) {
  // 'bottom' → presenter mode: shared content fills the top, cameras run along a
  // horizontal strip underneath (Google Meet). 'right' → pinned-speaker mode:
  // big talking head on the left, a vertical rail of others on the right.
  const bottom = placement === 'bottom'
  return (
    <div
      className={
        'flex min-h-0 w-full flex-1 gap-3 overflow-hidden p-3 ' +
        (bottom ? 'flex-col' : 'flex-col lg:flex-row')
      }
    >
      <Hero item={hero} fit={heroFit} renderTile={renderTile} />
      {others.length > 0 && (
        <Filmstrip items={others} placement={placement} renderTile={renderTile} />
      )}
    </div>
  )
}

function Hero({ item, fit, renderTile }) {
  // Fit a single aspect-correct tile inside the measured hero box — same engine
  // as the gallery, count of 1.
  const [ref, grid] = useGridLayout(1, GAP)
  return (
    <div ref={ref} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <motion.div
        layoutId={item.key}
        layout
        transition={TRANSITION}
        style={{ width: grid.tileW, height: grid.tileH }}
      >
        {renderTile(item, { isHero: true, fit })}
      </motion.div>
    </div>
  )
}

function Filmstrip({ items, placement, renderTile }) {
  const bottom = placement === 'bottom'

  // ── Presenter mode: a single fixed-height horizontal rail on every breakpoint.
  // Tiles derive their width from the rail height (aspect-video) so they never
  // overlap; the inner track is `w-max` + `mx-auto`, which centres a short strip
  // and lets a long one scroll horizontally without clipping the first tile.
  if (bottom) {
    return (
      <div className="h-24 w-full shrink-0 overflow-x-auto overflow-y-hidden sm:h-28 lg:h-32">
        <div className="mx-auto flex h-full w-max items-center gap-2 px-1">
          <AnimatePresence mode="popLayout">
            {items.map((item) => (
              <motion.div
                key={item.key}
                layoutId={item.key}
                layout
                initial={ENTER}
                animate={SHOW}
                exit={ENTER}
                transition={TRANSITION}
                className="aspect-video h-full shrink-0"
              >
                {renderTile(item, { isHero: false, fit: 'cover' })}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // ── Pinned-speaker mode: horizontal scroller on tablet/mobile, vertical rail
  // on desktop. Fixed cross size, scrolls on the main axis.
  return (
    <div
      className={
        'flex shrink-0 gap-2 overflow-auto ' +
        'h-28 w-full flex-row sm:h-32 ' +
        'lg:h-full lg:w-[220px] lg:flex-col'
      }
    >
      <AnimatePresence mode="popLayout">
        {items.map((item) => (
          <motion.div
            key={item.key}
            layoutId={item.key}
            layout
            initial={ENTER}
            animate={SHOW}
            exit={ENTER}
            transition={TRANSITION}
            className="aspect-video h-full w-44 shrink-0 sm:w-52 lg:h-auto lg:w-full"
          >
            {renderTile(item, { isHero: false, fit: 'cover' })}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
