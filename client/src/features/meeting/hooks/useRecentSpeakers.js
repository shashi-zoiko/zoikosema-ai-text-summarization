import { useEffect, useRef, useState } from 'react'
import { useSpeakingParticipants } from '@livekit/components-react'

function sameSet(a, b) {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

/**
 * Identities that have spoken within the last `windowMs`.
 *
 * Google-Meet promotes whoever talks into the visible grid — but demoting them
 * the instant they pause would make tiles flicker in and out on every "yeah" /
 * "mhm". We stamp each speaker's last-active time and keep them "recent" for a
 * few seconds after they go quiet, so a promoted speaker lingers on stage
 * instead of snapping back into the "+N others" tile.
 *
 * The returned Set identity only changes when membership actually changes, so it
 * is safe to feed straight into a `useMemo` dependency list.
 */
export function useRecentSpeakers(windowMs = 6000) {
  const speaking = useSpeakingParticipants()
  const lastRef = useRef(new Map())
  const [ids, setIds] = useState(() => new Set())

  useEffect(() => {
    const last = lastRef.current
    const recompute = () => {
      const cutoff = Date.now() - windowMs
      const next = new Set()
      for (const [id, t] of last) {
        if (t >= cutoff) next.add(id)
        else last.delete(id)
      }
      setIds((prev) => (sameSet(prev, next) ? prev : next))
    }

    const now = Date.now()
    for (const p of speaking) if (p?.identity) last.set(p.identity, now)
    recompute()

    // Re-evaluate on a slow tick so people age out of the "recent" window even
    // while nobody new is speaking. `recompute` no-ops (no setState) when the
    // membership is unchanged, so an idle room never re-renders.
    const iv = setInterval(recompute, 1500)
    return () => clearInterval(iv)
  }, [speaking, windowMs])

  return ids
}
