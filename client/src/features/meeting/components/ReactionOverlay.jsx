import { useEffect, useRef, useState } from 'react'
import Emoji from '../../emoji/Emoji'

/**
 * Floating reactions. Each entry lives 2.5s, drifts up from the bottom-right,
 * and fades out. We deliberately do NOT animate via framer-motion to avoid
 * pulling the heavy vendor chunk into the room page — pure CSS keyframes.
 */
export default function ReactionOverlay({ events }) {
  const [active, setActive] = useState([])
  // Monotonic id per floating element — guarantees a unique React key even when
  // two reactions land in the same millisecond.
  const idRef = useRef(0)
  // How many events we've already animated. Initialised lazily on first run to
  // the current queue length so a stale queue (carried over from a previous
  // meeting) and React StrictMode's double-invoke don't replay old reactions.
  const seenRef = useRef(null)

  useEffect(() => {
    if (seenRef.current === null) {
      // First run: treat everything already queued as "seen" — only animate
      // reactions that arrive from here on.
      seenRef.current = events.length
      return
    }
    if (events.length <= seenRef.current) return
    const fresh = events.slice(seenRef.current)
    seenRef.current = events.length
    const added = fresh.map((r) => ({
      id: `react-${++idRef.current}`,
      emoji: r.emoji,
      name: r.name,
      left: 10 + Math.random() * 60,
    }))
    setActive((prev) => [...prev, ...added])
    const timers = added.map((a) =>
      setTimeout(() => setActive((prev) => prev.filter((e) => e.id !== a.id)), 2500),
    )
    return () => timers.forEach(clearTimeout)
  }, [events])

  if (active.length === 0) return null

  return (
    <>
      <style>{`
        @keyframes lk-react-float {
          0%   { transform: translateY(0)    scale(.6); opacity: 0;  }
          15%  { transform: translateY(-30px) scale(1.1); opacity: 1; }
          80%  { transform: translateY(-180px) scale(1);  opacity: 1; }
          100% { transform: translateY(-260px) scale(.9); opacity: 0; }
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {active.map((e) => (
          <div
            key={e.id}
            className="absolute bottom-24 select-none"
            style={{
              left: `${e.left}%`,
              animation: 'lk-react-float 2.5s ease-out forwards',
            }}
          >
            <Emoji char={e.emoji} size="2.25rem" />
            <span className="block text-xs text-white/90 bg-black/40 px-2 py-0.5 rounded mt-1 whitespace-nowrap">
              {e.name}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
