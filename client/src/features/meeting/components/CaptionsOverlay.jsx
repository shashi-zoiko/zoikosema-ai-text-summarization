import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Renders the latest 3 captions from any peer, bottom-center of the stage.
 * Each entry auto-clears after 5 s of inactivity from that speaker.
 *
 * Captions are forwarded from the legacy /ws/meetings WS — the server already
 * relays them; the LK migration just renders them here.
 */
export default function CaptionsOverlay({ captions }) {
  const visible = useMemo(() => {
    return Object.values(captions)
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts)
      .slice(-3)
  }, [captions])

  if (visible.length === 0) return null
  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 max-w-[80%]">
      {visible.map((c) => (
        <div
          key={c.peer_id}
          className="bg-black/70 text-white text-sm px-3 py-1.5 rounded shadow"
        >
          <span className="font-medium mr-2" style={{ color: c.color || '#a3a3a3' }}>
            {c.name || 'Guest'}:
          </span>
          {c.text}
        </div>
      ))}
    </div>
  )
}

/**
 * Hook helper for the parent to manage caption state. Each caption keyed by
 * peer_id; stale entries time out after 5 s.
 */
export function useCaptions() {
  const [byPeer, setByPeer] = useState({})
  const timersRef = useRef({})

  const push = useCallback((peer_id, payload) => {
    if (!peer_id) return
    setByPeer((prev) => ({ ...prev, [peer_id]: { ...payload, ts: Date.now() } }))
    if (timersRef.current[peer_id]) clearTimeout(timersRef.current[peer_id])
    timersRef.current[peer_id] = setTimeout(() => {
      setByPeer((prev) => {
        const next = { ...prev }
        delete next[peer_id]
        return next
      })
      delete timersRef.current[peer_id]
    }, 5000)
  }, [])

  // Clear all timers on unmount
  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout)
    timersRef.current = {}
  }, [])

  return { byPeer, push }
}
