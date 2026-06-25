import { useMemo } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { computeGridLayout, galleryGridOpts, useElementSize, useGridLayout } from '../hooks/useGridLayout.js'

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
 *
 * Hero layout (presentation / pinned-speaker) is Google-Meet shaped:
 *   • desktop (lg+) → hero fills the left, a VERTICAL participant rail scrolls
 *                     down the right (~240px).
 *   • tablet/mobile → hero on top, a HORIZONTAL participant carousel underneath.
 */

export const GAP = 20 // px — premium spacing so accent glows never touch.

const EASE = [0.22, 1, 0.36, 1]
const TRANSITION = { duration: 0.26, ease: EASE }
const ENTER = { opacity: 0, scale: 0.85 }
const SHOW = { opacity: 1, scale: 1 }

export default function StageLayout({ items, heroKey, heroFit = 'cover', renderTile }) {
  const hero = heroKey ? items.find((i) => i.key === heroKey) : null
  const others = hero ? items.filter((i) => i.key !== hero.key) : items

  if (items.length === 0) return <div className="flex-1" />

  // LayoutGroup + a per-key `layoutId` on every tile means the SAME tile is
  // tracked across the gallery↔hero swap. Pinning / presenting morphs that tile
  // from its grid slot into the hero (others slide into the rail); the reverse
  // plays on stop. Without it the two views are separate subtrees and the layout
  // would hard-cut instead of animating.
  return (
    <LayoutGroup>
      {hero ? (
        <HeroView hero={hero} heroFit={heroFit} others={others} renderTile={renderTile} />
      ) : (
        <GalleryGrid items={items} renderTile={renderTile} />
      )}
    </LayoutGroup>
  )
}

function GalleryGrid({ items, renderTile }) {
  const [ref, size] = useElementSize()
  const count = items.length
  // Orientation + viewport drive both the column strategy and the gutter: phones
  // get a tight gap so tiles stay large; desktops keep the premium GAP.
  const portrait = size.height > 0 && size.height >= size.width
  const gap = size.width > 0 && size.width < 640 ? 8 : GAP
  const grid = useMemo(
    () => computeGridLayout(count, size.width, size.height, gap, galleryGridOpts(count, portrait)),
    [count, size.width, size.height, gap, portrait],
  )
  const single = count === 1

  return (
    <div
      ref={ref}
      className={
        'min-h-0 w-full flex-1 p-2 sm:p-4 lg:p-6 ' +
        (grid.scroll ? 'zk-rail overflow-y-auto overflow-x-hidden' : 'overflow-hidden')
      }
    >
      <div
        className={
          'flex w-full flex-wrap justify-center ' +
          (grid.scroll ? 'content-start items-start' : 'h-full content-center items-center')
        }
        style={{ gap }}
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
              {renderTile(item, { isHero: single, fit: 'cover' })}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function HeroView({ hero, heroFit, others, renderTile }) {
  // Hero owns the stage; the rail of other tiles sits to the RIGHT on desktop and
  // drops to a horizontal carousel UNDER the hero on tablet/mobile.
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row">
      <Hero item={hero} fit={heroFit} renderTile={renderTile} />
      {others.length > 0 && <Filmstrip items={others} renderTile={renderTile} />}
    </div>
  )
}

function Hero({ item, fit, renderTile }) {
  // Fit a single aspect-correct tile inside the measured hero box — same engine
  // as the gallery, count of 1.
  const [ref, grid] = useGridLayout(1, GAP)
  // Screen share is letterboxed by the <video> itself (object-contain), so the
  // hero should fill the WHOLE box and let any aspect (4:3 / 16:9 / 21:9 /
  // portrait) preserve itself — never crop. A camera hero keeps the 16:9 best-fit
  // so a single talking head doesn't stretch edge to edge.
  const contain = fit === 'contain'
  return (
    <div ref={ref} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <motion.div
        layoutId={item.key}
        layout
        transition={TRANSITION}
        style={contain ? { width: '100%', height: '100%' } : { width: grid.tileW, height: grid.tileH }}
      >
        {renderTile(item, { isHero: true, fit })}
      </motion.div>
    </div>
  )
}

function Filmstrip({ items, renderTile }) {
  // Horizontal scroller on tablet/mobile, vertical rail on desktop. Fixed cross
  // size; scrolls on the main axis so a long roster never overlaps. Each tile is
  // aspect-video, so equal spacing falls out of the flex gap.
  return (
    <div
      className={
        'zk-rail flex shrink-0 gap-2.5 overflow-auto ' +
        'h-28 w-full flex-row sm:h-32 ' +
        'lg:h-full lg:w-[240px] lg:flex-col lg:pr-0.5'
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
