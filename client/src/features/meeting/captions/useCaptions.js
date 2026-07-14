import { createContext, useContext, useSyncExternalStore } from 'react'

/**
 * Two separate contexts — deliberately split for performance.
 *
 * - ControlContext changes RARELY (only when CC is toggled or support/error
 *   state flips). Consumers: the toolbar button.
 * - LiveContext holds the caption BUFFER STORE handle (a stable reference). The
 *   overlay subscribes to it via useSyncExternalStore, so frame-rate caption
 *   updates re-render ONLY the overlay — never the provider or the grid.
 */
export const CaptionsControlContext = createContext({
  enabled: false,
  supported: false,
  micError: false,
  toggle: () => {},
})

export const CaptionsLiveContext = createContext({ store: null })

/** Toolbar / control-plane consumers (toggle, on/off, support state). */
export function useCaptionControls() {
  return useContext(CaptionsControlContext)
}

const EMPTY = {}
const noopSubscribe = () => () => {}

/**
 * Live transcript consumer (the overlay). Subscribes directly to the buffer
 * store; returns the current `bySpeaker` map. Re-renders only when the buffer
 * changes, and only this consumer.
 */
export function useLiveCaptions() {
  const { store } = useContext(CaptionsLiveContext)
  const bySpeaker = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : () => EMPTY,
    () => EMPTY,
  )
  return { bySpeaker }
}
