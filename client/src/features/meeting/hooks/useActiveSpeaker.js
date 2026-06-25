import { useEffect, useRef, useState } from 'react'
import { useSpeakingParticipants } from '@livekit/components-react'

/**
 * Debounced active-speaker selection for speaker view.
 *
 * `useSpeakingParticipants` re-orders on every audio-level tick, which would
 * make the hero thrash between people on brief overlaps ("yeah", "mhm"). We only
 * promote a new speaker once they've held the floor for `holdMs`, and we never
 * demote to "nobody" — the last active speaker stays on stage through pauses,
 * exactly like Meet/Zoom.
 *
 * @param {number} holdMs how long a speaker must lead before being promoted
 * @returns {string|null} the active speaker's LiveKit identity
 */
export function useActiveSpeaker(holdMs = 1600) {
  const speakers = useSpeakingParticipants()
  const top = speakers[0]?.identity ?? null

  const [active, setActive] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!top || top === active) return undefined
    timerRef.current = setTimeout(() => setActive(top), holdMs)
    return () => clearTimeout(timerRef.current)
  }, [top, active, holdMs])

  return active
}
