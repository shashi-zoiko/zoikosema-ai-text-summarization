import { memo, useMemo, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { PanelRightClose, Users } from 'lucide-react'
import { computeGridLayout, computePageSize, galleryGridOpts, TILE_ASPECT, useElementSize, useGridLayout } from '../hooks/useGridLayout.js'

/**
 * Pure, LiveKit-free presentational layout for the meeting stage. Owns ALL of
 * the geometry + animation; it knows nothing about tracks, rooms or themes.
 *
 *   Stage.jsx  → maps LiveKit tracks to `items` and renders the real tiles.
 *   Harness    → feeds mock items + a coloured-box renderer to drive the layout
 *                in a browser without a live SFU.
 *
 * Props:
 *   items         — ordered [{ key, ...data }]. `key` must be STABLE per identity,
 *                   and the order should be STABLE (identity-sorted) so tiles keep
 *                   their slot; membership — not position — is what changes.
 *   heroKey       — key of the item to promote to the hero slot, or null/undefined
 *                   for the adaptive gallery.
 *   heroFit       — 'cover' | 'contain' for the hero tile (screen share = contain).
 *   priorityOrder — ALL item keys sorted most-important-first (pinned, presenter,
 *                   active/recent speaker, camera-on, …). Drives WHICH tiles stay
 *                   on stage when the room is bigger than one screenful; the rest
 *                   fold into a single "+N others" tile (Google-Meet behaviour).
 *   renderTile    — (item, { isHero, fit, dense }) => ReactNode. One tile's body.
 *   renderOverflow— (overflowItems, { dense }) => ReactNode. The "+N others" tile.
 *
 * Hero layout (presentation / pinned-speaker) is Google-Meet shaped:
 *   • desktop (lg+) → hero fills the left, a VERTICAL participant rail scrolls
 *                     down the right (~320px).
 *   • tablet/mobile → hero on top, a HORIZONTAL participant carousel underneath.
 *
 * Overflow model (replaces the old paged gallery): the layout keeps every tile
 * comfortably large and, once there are more people than fit on one screen,
 * collapses the surplus into ONE "+N others" tile instead of shrinking everyone
 * to specks or hiding them behind page arrows. `priorityOrder` decides who keeps
 * a tile, so whoever is talking / has their camera on is always on stage.
 */

export const GAP = 20 // px — premium spacing so accent glows never touch.

// Google-Meet-style hard ceiling on gallery tiles: at most this many render on
// the main stage, the surplus folds into one "+N others" tile. Caps DOM video
// elements regardless of room size (100 people → 8 tiles). The viewport-
// adaptive computePageSize still lowers this on small screens; it never raises it.
const MAX_GALLERY_TILES = 8

const EASE = [0.22, 1, 0.36, 1]
const TRANSITION = { duration: 0.26, ease: EASE }
const ENTER = { opacity: 0, scale: 0.85 }
const SHOW = { opacity: 1, scale: 1 }
const OVERFLOW_KEY = '__overflow__'

// Above this many tiles, drop the framer-motion FLIP `layout` animation. `layout`
// forces a getBoundingClientRect measure + reflow of every tile on each
// layout-affecting render; combined with active-speaker ticks that is the main
// meeting-grid CPU cost past ~15 participants. Tiles still mount/unmount, just
// without the animated morph — a deliberate perf/polish trade at scale.
const ANIMATE_MAX = 15

/**
 * Split `items` into the tiles that stay on stage and the tiles that fold into
 * the "+N others" summary. Selection is by `priorityOrder` (most-important
 * first); the survivors are then returned in the ORIGINAL `items` order so tiles
 * keep their slot — a speaker popping in swaps a single tile rather than
 * reshuffling the whole grid under everyone.
 */
function selectVisible(items, priorityOrder, visN) {
  const order = priorityOrder && priorityOrder.length ? priorityOrder : items.map((i) => i.key)
  const rankOf = new Map()
  order.forEach((k, i) => rankOf.set(k, i))
  const byPriority = [...items].sort(
    (a, b) => (rankOf.get(a.key) ?? Infinity) - (rankOf.get(b.key) ?? Infinity),
  )
  const keep = new Set(byPriority.slice(0, Math.max(1, visN)).map((i) => i.key))
  return {
    visibleItems: items.filter((i) => keep.has(i.key)),
    overflowItems: items.filter((i) => !keep.has(i.key)),
  }
}

// A single tile slot. Animates (FLIP morph + enter/exit) when `animate` is on;
// otherwise a plain div so big meetings skip the per-tile reflow. `layoutId` is
// only set when animating, so framer-motion does no cross-view tracking at scale.
function MotionTile({ animate, id, style, className, children }) {
  if (!animate) return <div style={style} className={className}>{children}</div>
  return (
    <motion.div
      layoutId={id}
      layout
      initial={ENTER}
      animate={SHOW}
      exit={ENTER}
      transition={TRANSITION}
      style={style}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// LayoutGroup / AnimatePresence both cost layout work; skip them entirely when
// animation is off so a large grid pays nothing for machinery it isn't using.
const MaybeGroup = ({ animate, children }) => (animate ? <LayoutGroup>{children}</LayoutGroup> : <>{children}</>)
const MaybePresence = ({ animate, children }) =>
  animate ? <AnimatePresence mode="popLayout">{children}</AnimatePresence> : <>{children}</>

function StageLayout({ items, heroKey, heroFit = 'cover', heroAspect, priorityOrder, renderTile, renderOverflow }) {
  const hero = heroKey ? items.find((i) => i.key === heroKey) : null
  const others = hero ? items.filter((i) => i.key !== hero.key) : items
  // One decision for the whole subtree: animate only small rooms.
  const animate = items.length <= ANIMATE_MAX

  if (items.length === 0) return <div className="flex-1" />

  // LayoutGroup + a per-key `layoutId` on every tile means the SAME tile is
  // tracked across the gallery↔hero swap. Pinning / presenting morphs that tile
  // from its grid slot into the hero (others slide into the rail); the reverse
  // plays on stop. Without it the two views are separate subtrees and the layout
  // would hard-cut instead of animating.
  return (
    <MaybeGroup animate={animate}>
      {hero ? (
        <HeroView hero={hero} heroFit={heroFit} heroAspect={heroAspect} others={others} priorityOrder={priorityOrder} renderTile={renderTile} renderOverflow={renderOverflow} animate={animate} />
      ) : (
        <GalleryGrid items={items} priorityOrder={priorityOrder} renderTile={renderTile} renderOverflow={renderOverflow} animate={animate} />
      )}
    </MaybeGroup>
  )
}

// Memoised: Stage re-renders on every active-speaker/audio-level tick, but its
// layout inputs (items, priorityOrder, heroKey) usually don't change on a tick.
// With the render callbacks wrapped in useCallback upstream, memo keeps the whole
// grid subtree from reconciling on every tick — the other half of the speaker-
// event CPU fix.
export default memo(StageLayout)

function GalleryGrid({ items, priorityOrder, renderTile, renderOverflow, animate }) {
  const [ref, size] = useElementSize()
  const count = items.length
  // Orientation + viewport drive both the column strategy and the gutter: phones
  // get a tight gap so tiles stay large; desktops keep the premium GAP.
  const portrait = size.height > 0 && size.height >= size.width
  const gap = size.width > 0 && size.width < 640 ? 8 : GAP

  // ── Overflow ("+N others") ──────────────────────────────────────────────────
  // `cap` is the most tiles that stay comfortably large on ONE screen (no scroll,
  // no shrinking past the legible floor). Up to `cap` people this is a no-op and
  // the gallery behaves exactly as a normal adaptive grid. Beyond it, we keep the
  // top `cap - 1` tiles by priority and collapse everyone else into a single
  // "+N others" tile in the last slot — the Google-Meet big-room layout.
  const cap = useMemo(
    () => Math.min(MAX_GALLERY_TILES, computePageSize(count, size.width, size.height, gap, portrait)),
    [count, size.width, size.height, gap, portrait],
  )
  const overflowing = !!renderOverflow && count > cap

  const { visibleItems, overflowItems } = useMemo(() => {
    if (!overflowing) return { visibleItems: items, overflowItems: [] }
    return selectVisible(items, priorityOrder, cap - 1)
  }, [items, priorityOrder, overflowing, cap])

  // Geometry is solved for the rendered tile count (visible + the overflow tile),
  // which is ≤ cap, so the grid always fits without scrolling.
  const renderCount = visibleItems.length + (overflowing ? 1 : 0)
  const grid = useMemo(
    () => computeGridLayout(renderCount, size.width, size.height, gap, galleryGridOpts(renderCount, portrait)),
    [renderCount, size.width, size.height, gap, portrait],
  )
  const single = count === 1

  return (
    <div ref={ref} className="relative min-h-0 w-full flex-1 overflow-hidden p-2 sm:p-4 lg:p-6">
      <div className="flex h-full w-full flex-wrap content-center items-center justify-center" style={{ gap }}>
        <MaybePresence animate={animate}>
          {visibleItems.map((item) => (
            <MotionTile
              key={item.key}
              animate={animate}
              id={item.key}
              style={{ width: grid.tileW, height: grid.tileH }}
              className="min-h-0 min-w-0"
            >
              {renderTile(item, { isHero: single, fit: 'cover' })}
            </MotionTile>
          ))}
          {overflowing && (
            <MotionTile
              key={OVERFLOW_KEY}
              animate={animate}
              id={OVERFLOW_KEY}
              style={{ width: grid.tileW, height: grid.tileH }}
              className="min-h-0 min-w-0"
            >
              {renderOverflow(overflowItems, { dense: false })}
            </MotionTile>
          )}
        </MaybePresence>
      </div>
    </div>
  )
}

function HeroView({ hero, heroFit, heroAspect, others, priorityOrder, renderTile, renderOverflow, animate }) {
  // Hero owns the stage; the rail of other tiles sits to the RIGHT on desktop and
  // drops to a horizontal carousel UNDER the hero on tablet/mobile. The rail can
  // be collapsed so the shared content goes edge-to-edge (Meet/Teams "hide
  // people"); a labelled pill brings it back.
  const [collapsed, setCollapsed] = useState(false)
  const hasOthers = others.length > 0
  const toggle = hasOthers ? (
    <button
      type="button"
      onClick={() => setCollapsed((c) => !c)}
      aria-label={collapsed ? 'Show participants' : 'Hide participants'}
      aria-pressed={collapsed}
      title={collapsed ? 'Show participants' : 'Hide participants'}
      className={
        'pointer-events-auto absolute right-3 top-3 z-20 inline-flex h-9 items-center gap-1.5 rounded-full ' +
        'bg-black/55 px-3 text-[12.5px] font-semibold text-white ring-1 ring-white/10 backdrop-blur-md transition ' +
        'hover:bg-black/75 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/60 ' +
        '[&_svg]:h-4 [&_svg]:w-4'
      }
    >
      {collapsed ? (<><Users /><span>{others.length}</span></>) : <PanelRightClose />}
    </button>
  ) : null

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row">
      <Hero item={hero} fit={heroFit} aspect={heroAspect} renderTile={renderTile} toggle={toggle} animate={animate} />
      {hasOthers && !collapsed && (
        <Filmstrip items={others} priorityOrder={priorityOrder} renderTile={renderTile} renderOverflow={renderOverflow} animate={animate} />
      )}
    </div>
  )
}

function Hero({ item, fit, aspect, renderTile, toggle, animate }) {
  const contain = fit === 'contain'
  // Screen share: size the hero box to the SHARE's real aspect ratio so the frame
  // hugs the content edge-to-edge — no black letterbox bars, and the rounded
  // border sits right against the shared screen (Meet / Teams behaviour). A camera
  // hero keeps the adaptive best-fit (16:9 on desktop, fill on portrait phones).
  const opts = useMemo(
    () => (contain ? { aspect: aspect || TILE_ASPECT, maxCols: 1 } : undefined),
    [contain, aspect],
  )
  const [ref, grid] = useGridLayout(1, GAP, opts)
  return (
    <div ref={ref} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
      <MotionTile animate={animate} id={item.key} style={{ width: grid.tileW, height: grid.tileH }}>
        {renderTile(item, { isHero: true, fit })}
      </MotionTile>
      {toggle}
    </div>
  )
}

function Filmstrip({ items, priorityOrder, renderTile, renderOverflow, animate }) {
  // Two shapes, like Meet / Teams: a VERTICAL rail down the right on desktop and
  // a HORIZONTAL carousel under the hero on tablet/mobile. Tiles render in
  // `dense` mode (fixed type sizes) throughout.
  //
  // Instead of a scrolling rail that clips the last tile, we best-fit a SINGLE
  // column into the available height and, once there are more people than fit,
  // fold the surplus into a "+N others" tile — the presentation-mode twin of the
  // gallery's overflow. `priorityOrder` keeps the active speaker in the rail.
  const [ref, size] = useElementSize()
  const count = items.length
  // Leave enough room BETWEEN tiles for the speaking glow (a box-shadow ring +
  // soft halo, up to ~14px) so the active speaker's ring never bleeds onto the
  // neighbouring tile.
  const gap = 14
  // Pick the strategy from the rail's MEASURED shape (tall → vertical rail, wide
  // → horizontal carousel). The container's own responsive classes set that
  // shape, so reading it back never feeds into itself.
  const vertical = size.width > 0 ? size.height >= size.width : false

  // How many rail tiles fit without scrolling; the rest fold into "+N others".
  const railCap = useMemo(() => {
    if (size.width <= 0 || size.height <= 0) return count
    if (vertical) {
      for (let c = count; c >= 1; c--) {
        const g = computeGridLayout(c, size.width, size.height, gap, { aspect: TILE_ASPECT, maxCols: 1, minTileH: 92 })
        if (!g.scroll && g.tileH > 0) return c
      }
      return 1
    }
    // Horizontal carousel: ~256px fixed-width tiles across the measured width.
    return Math.max(1, Math.floor((size.width + gap) / (256 + gap)))
  }, [vertical, count, size.width, size.height])

  const overflowing = !!renderOverflow && count > railCap
  const { visibleItems, overflowItems } = useMemo(() => {
    if (!overflowing) return { visibleItems: items, overflowItems: [] }
    return selectVisible(items, priorityOrder, railCap - 1)
  }, [items, priorityOrder, overflowing, railCap])

  const railCount = visibleItems.length + (overflowing ? 1 : 0)
  const grid = useMemo(
    () =>
      vertical
        ? computeGridLayout(railCount, size.width, size.height, gap, {
            aspect: TILE_ASPECT,
            maxCols: 1,
            minTileH: 92,
          })
        : null,
    [vertical, railCount, size.width, size.height],
  )
  const tileClass = 'shrink-0 ' + (vertical ? '' : 'aspect-video h-full w-52 sm:w-64')
  const tileStyle = vertical && grid ? { width: grid.tileW, height: grid.tileH } : undefined

  return (
    <div
      ref={ref}
      style={{ gap }}
      className={
        // `p-3.5` gives the speaking glow (a box-shadow that renders OUTSIDE the
        // tile) breathing room INSIDE the rail's clip boundary — `overflow`
        // clips at the padding-box edge, so without this padding the ring/halo
        // of any speaking rail tile got sliced off at the rail edges (the
        // "cut-off grid UI" during screen share). The rail is a touch wider to
        // offset the padding so tiles keep their size; `useElementSize` measures
        // the content box, so tiles auto-shrink to fit the new padding.
        'zk-rail flex shrink-0 p-3.5 ' +
        'h-32 w-full flex-row sm:h-36 ' +
        'lg:h-full lg:w-80 lg:flex-col ' +
        (vertical
          ? 'items-center justify-center overflow-hidden'
          : 'overflow-x-auto overflow-y-hidden')
      }
    >
      <MaybePresence animate={animate}>
        {visibleItems.map((item) => (
          <MotionTile
            key={item.key}
            animate={animate}
            id={item.key}
            className={tileClass}
            style={tileStyle}
          >
            {renderTile(item, { isHero: false, fit: 'cover', dense: true })}
          </MotionTile>
        ))}
        {overflowing && (
          <MotionTile
            key={OVERFLOW_KEY}
            animate={animate}
            id={OVERFLOW_KEY}
            className={tileClass}
            style={tileStyle}
          >
            {renderOverflow(overflowItems, { dense: true })}
          </MotionTile>
        )}
      </MaybePresence>
    </div>
  )
}
