import { useEffect } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'

/**
 * Subscribe to LiveKit Room events with a stable handler. Use for things that
 * don't need to re-render the component (toasts, side-effects).
 *
 * `eventMap` is a { [RoomEvent]: handler } object. Handlers are NOT memoized
 * for you — wrap them in useCallback if their closures matter.
 */
export default function useRoomEvents(eventMap) {
  const room = useRoomContext()
  useEffect(() => {
    if (!room) return
    const entries = Object.entries(eventMap)
    for (const [event, handler] of entries) room.on(event, handler)
    return () => {
      for (const [event, handler] of entries) room.off(event, handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room])
}

export { RoomEvent }
