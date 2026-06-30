import { createContext, useContext } from 'react'

/**
 * Two separate contexts — deliberately split for performance.
 *
 * - ControlContext changes RARELY (only when CC is toggled or support/error
 *   state flips). Consumers: the toolbar button.
 * - LiveContext changes FREQUENTLY (every interim/final caption frame).
 *   Consumer: the CaptionOverlay only.
 *
 * Because the caption state lives here and not in the meeting room component,
 * the participant grid never re-renders when captions update.
 */
export const CaptionsControlContext = createContext({
  enabled: false,
  supported: false,
  micError: false,
  toggle: () => {},
})

export const CaptionsLiveContext = createContext({ bySpeaker: {} })

/** Toolbar / control-plane consumers (toggle, on/off, support state). */
export function useCaptionControls() {
  return useContext(CaptionsControlContext)
}

/** Live transcript consumer (the overlay). */
export function useLiveCaptions() {
  return useContext(CaptionsLiveContext)
}
