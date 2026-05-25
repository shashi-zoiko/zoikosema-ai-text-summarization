import { useEffect, useState } from 'react'

/**
 * Floating reactions. Each entry lives 2.5s, drifts up from the bottom-right,
 * and fades out. We deliberately do NOT animate via framer-motion to avoid
 * pulling the heavy vendor chunk into the room page — pure CSS keyframes.
 */
export default function ReactionOverlay({ events }) {
  const [active, setActive] = useState([])

  useEffect(() => {
    if (!events.length) return
    const latest = events[events.length - 1]
    const id = `${latest.peer_id}:${latest._ts}`
    setActive((prev) => [...prev, { id, emoji: latest.emoji, name: latest.name, left: 10 + Math.random() * 60 }])
    const t = setTimeout(() => {
      setActive((prev) => prev.filter((e) => e.id !== id))
    }, 2500)
    return () => clearTimeout(t)
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
            className="absolute bottom-24 text-4xl select-none"
            style={{
              left: `${e.left}%`,
              animation: 'lk-react-float 2.5s ease-out forwards',
            }}
          >
            <span>{e.emoji}</span>
            <span className="block text-xs text-white/90 bg-black/40 px-2 py-0.5 rounded mt-1 whitespace-nowrap">
              {e.name}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
