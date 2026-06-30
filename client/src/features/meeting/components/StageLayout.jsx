import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, PanelRightClose, Users } from 'lucide-react'
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
 *   items      — ordered [{ key, ...data }]. `key` must be STABLE per identity.
 *   heroKey    — key of the item to promote to the hero slot, or null/undefined
 *                for the adaptive gallery.
 *   heroFit    — 'cover' | 'contain' for the hero tile (screen share = contain).
 *   priorityKeys — item keys to float onto the FIRST page when the gallery
 *                  paginates (active speaker + pinned), so the person talking is
 *                  always visible without hunting through pages.
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

export default function StageLayout({ items, heroKey, heroFit = 'cover', heroAspect, priorityKeys, renderTile }) {
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
        <HeroView hero={hero} heroFit={heroFit} heroAspect={heroAspect} others={others} renderTile={renderTile} />
      ) : (
        <GalleryGrid items={items} priorityKeys={priorityKeys} renderTile={renderTile} />
      )}
    </LayoutGroup>
  )
}

function GalleryGrid({ items, priorityKeys, renderTile }) {
  const [ref, size] = useElementSize()
  const count = items.length
  // Orientation + viewport drive both the column strategy and the gutter: phones
  // get a tight gap so tiles stay large; desktops keep the premium GAP.
  const portrait = size.height > 0 && size.height >= size.width
  const gap = size.width > 0 && size.width < 640 ? 8 : GAP

  // ── Pagination ──────────────────────────────────────────────────────────────
  // Large rooms become Google-Meet style pages instead of an endless scrolling
  // wall: pageSize is the most tiles that stay legible on one screen, and only
  // that page's tiles are mounted (the rest never create <video> elements — the
  // virtualization win that lets 50-100 participants stay smooth). Up to pageSize
  // people, this is a no-op and the gallery behaves exactly as before.
  const pageSize = useMemo(
    () => computePageSize(count, size.width, size.height, gap, portrait),
    [count, size.width, size.height, gap, portrait],
  )
  const pageCount = Math.max(1, Math.ceil(count / Math.max(1, pageSize)))
  const paginated = pageCount > 1
  const [page, setPage] = useState(0)
  // Clamp the page when the room shrinks (people leave / resize grows pageSize).
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount - 1))
  }, [pageCount])

  // When paginated, float the active speaker + pinned tile to the front so they
  // land on page 1. We only reorder while paginating — small rooms keep their
  // stable identity order so tiles never reshuffle under people.
  const ordered = useMemo(() => {
    if (!paginated || !priorityKeys?.length) return items
    const pri = new Set(priorityKeys)
    const front = []
    const rest = []
    for (const it of items) (pri.has(it.key) ? front : rest).push(it)
    return front.length ? [...front, ...rest] : items
  }, [items, paginated, priorityKeys])

  const pageItems = useMemo(() => {
    if (!paginated) return ordered
    const start = page * pageSize
    return ordered.slice(start, start + pageSize)
  }, [ordered, paginated, page, pageSize])

  const grid = useMemo(
    () => computeGridLayout(pageItems.length, size.width, size.height, gap, galleryGridOpts(pageItems.length, portrait)),
    [pageItems.length, size.width, size.height, gap, portrait],
  )
  const single = count === 1
  // Only the non-paginated path may scroll (rare: a very short viewport). A
  // paginated page is sized to always fit, so it never scrolls.
  const scroll = !paginated && grid.scroll

  // Arrow-key paging when the gallery is paginated and the user isn't typing.
  useEffect(() => {
    if (!paginated) return undefined
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      if (e.key === 'ArrowRight') setPage((p) => Math.min(pageCount - 1, p + 1))
      else if (e.key === 'ArrowLeft') setPage((p) => Math.max(0, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paginated, pageCount])

  return (
    <div
      ref={ref}
      className={
        'relative min-h-0 w-full flex-1 p-2 sm:p-4 lg:p-6 ' +
        (scroll ? 'zk-rail overflow-y-auto overflow-x-hidden' : 'overflow-hidden')
      }
    >
      <div
        className={
          'flex w-full flex-wrap justify-center ' +
          (scroll ? 'content-start items-start' : 'h-full content-center items-center')
        }
        style={{ gap }}
      >
        <AnimatePresence mode="popLayout">
          {pageItems.map((item) => (
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

      {paginated && (
        <PageControls
          page={page}
          pageCount={pageCount}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        />
      )}
    </div>
  )
}

/**
 * Edge chevrons + a page pill for the paginated gallery. The chevrons hug the
 * left/right edges at vertical centre (Meet placement) so they never collide
 * with the bottom captions or dock; the pill sits top-centre, clear of faces.
 */
function PageControls({ page, pageCount, onPrev, onNext }) {
  const atStart = page <= 0
  const atEnd = page >= pageCount - 1
  return (
    <>
      <span className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[12px] font-semibold text-white ring-1 ring-white/10 backdrop-blur-md">
        Page {page + 1} of {pageCount}
      </span>
      <button
        type="button"
        onClick={onPrev}
        disabled={atStart}
        aria-label="Previous page"
        className={EDGE_BTN + ' left-1.5 sm:left-3'}
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={atEnd}
        aria-label="Next page"
        className={EDGE_BTN + ' right-1.5 sm:right-3'}
      >
        <ChevronRight className="h-6 w-6" />
      </button>
    </>
  )
}

const EDGE_BTN =
  'absolute top-1/2 z-20 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full ' +
  'bg-black/55 text-white ring-1 ring-white/10 backdrop-blur-md transition ' +
  'hover:bg-black/75 active:scale-95 disabled:pointer-events-none disabled:opacity-0 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/60'

function HeroView({ hero, heroFit, heroAspect, others, renderTile }) {
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
      <Hero item={hero} fit={heroFit} aspect={heroAspect} renderTile={renderTile} toggle={toggle} />
      {hasOthers && !collapsed && <Filmstrip items={others} renderTile={renderTile} />}
    </div>
  )
}

function Hero({ item, fit, aspect, renderTile, toggle }) {
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
      <motion.div
        layoutId={item.key}
        layout
        transition={TRANSITION}
        style={{ width: grid.tileW, height: grid.tileH }}
      >
        {renderTile(item, { isHero: true, fit })}
      </motion.div>
      {toggle}
    </div>
  )
}

function Filmstrip({ items, renderTile }) {
  // Two shapes, like Meet / Teams: a VERTICAL rail down the right on desktop and
  // a HORIZONTAL carousel under the hero on tablet/mobile. Tiles render in
  // `dense` mode (fixed type sizes) throughout.
  //
  // Desktop rail: instead of stacking fixed `aspect-video` tiles (whose combined
  // height overflows the rail and clips the last tile — the "cut/uneven" bug), we
  // best-fit a SINGLE column into the available height so every tile is the same
  // size and the whole roster fits with no clipping. Only when there are too many
  // to stay legible do we fall back to a scrolling rail at a comfortable size.
  const [ref, size] = useElementSize()
  const count = items.length
  const gap = 10
  // Pick the strategy from the rail's MEASURED shape (tall → vertical rail, wide
  // → horizontal carousel). The container's own responsive classes set that
  // shape, so reading it back never feeds into itself.
  const vertical = size.width > 0 ? size.height >= size.width : false
  const grid = useMemo(
    () =>
      vertical
        ? computeGridLayout(count, size.width, size.height, gap, {
            aspect: TILE_ASPECT,
            maxCols: 1,
            minTileH: 92,
          })
        : null,
    [vertical, count, size.width, size.height],
  )
  const scroll = !!grid?.scroll

  return (
    <div
      ref={ref}
      style={{ gap }}
      className={
        'zk-rail flex shrink-0 ' +
        'h-32 w-full flex-row sm:h-36 ' +
        'lg:h-full lg:w-75 lg:flex-col lg:pr-1 ' +
        (vertical
          ? scroll
            ? 'items-center overflow-y-auto overflow-x-hidden'
            : 'items-center justify-center overflow-hidden'
          : 'overflow-x-auto overflow-y-hidden')
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
            className={'shrink-0 ' + (vertical ? '' : 'aspect-video h-full w-52 sm:w-64')}
            style={vertical && grid ? { width: grid.tileW, height: grid.tileH } : undefined}
          >
            {renderTile(item, { isHero: false, fit: 'cover', dense: true })}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
