import { Pin, PinOff } from 'lucide-react'

/**
 * Shared pin-toggle button for every participant tile across BOTH rooms — the
 * mesh room (PeerTile / SelfTile) and the LiveKit room (ParticipantTile).
 * Centralising it keeps the affordance identical everywhere:
 *
 *   • Desktop  — hidden until the tile is hovered (Tailwind group-hover).
 *   • Touch    — always visible (there is no hover); forced on via the
 *                `.zk-pin-btn` rule in index.css using @media (hover: none).
 *   • Pinned   — highlighted blue and always visible, icon flips to PinOff.
 *
 * Props:
 *   pinned    — current pinned state (controls icon + styling).
 *   onClick   — click handler; receives the DOM event so callers can
 *               stopPropagation before toggling.
 *   mini      — smaller geometry for filmstrip / thumbnail tiles.
 *   shifted   — nudge left to clear the mic-off badge in the top-right corner.
 *   groupName — Tailwind named group on the tile wrapper so the hover-reveal
 *               targets the correct ancestor: 'tile' → group/tile (mesh),
 *               '' → group (LiveKit).
 */
export function PinButton({ pinned, onClick, mini = false, shifted = false, groupName = 'tile' }) {
  const hoverReveal = groupName ? 'group-hover/tile:opacity-100' : 'group-hover:opacity-100'
  const dim = mini ? 'h-7 w-7' : 'h-9 w-9'
  const iconCls = mini ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const top = mini ? 'top-2 ' : 'top-3 '
  const right = shifted
    ? (mini ? 'right-9 ' : 'right-12 ')
    : (mini ? 'right-2 ' : 'right-3 ')

  return (
    <button
      type="button"
      onClick={onClick}
      title={pinned ? 'Unpin participant' : 'Pin participant'}
      aria-label={pinned ? 'Unpin participant' : 'Pin participant'}
      aria-pressed={pinned}
      className={
        'zk-pin-btn absolute z-10 grid place-items-center rounded-full transition active:scale-95 ' +
        top + right + dim + ' ' +
        (pinned
          ? 'bg-[#8ab4f8]/25 text-[#8ab4f8] ring-1 ring-[#8ab4f8]/40 opacity-100'
          : 'bg-black/55 text-white/85 opacity-0 backdrop-blur hover:bg-black/70 ' + hoverReveal)
      }
    >
      {pinned ? <PinOff className={iconCls} /> : <Pin className={iconCls} />}
    </button>
  )
}

/**
 * Persistent "pinned" marker shown inside a tile's name pill. Unlike the
 * hover-revealed button, this stays visible so the pinned participant is
 * obvious at a glance — including on mini tiles and on touch. The fixed
 * blue-on-pill treatment reads clearly on both light and dark stages.
 */
export function PinnedNameIcon({ mini = false }) {
  return (
    <Pin
      className={(mini ? 'h-2.5 w-2.5' : 'h-3 w-3') + ' shrink-0 text-[#8ab4f8]'}
      aria-label="Pinned"
    />
  )
}
