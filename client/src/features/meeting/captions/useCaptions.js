import { createContext, useContext } from 'react'

/**
 * Two separate contexts — deliberately split for performance.
 *
 * - ControlContext changes occasionally (CC toggled, support/error state
 *   flips, or Meet Summarizer capture toggled on/off). Consumers: the
 *   toolbar CC button (enabled/toggle) and MeetingHeader's SummarizerButton
 *   (capturing/setCapturing — drives both the header button's glow effect
 *   and its popover's Start/Pause Summarizing toggle).
 * - LiveContext changes FREQUENTLY (every interim/final caption frame).
 *   Consumers: the CaptionOverlay (bySpeaker) and the Conversations panel
 *   (transcript — the accumulated, finals-only log across the whole call).
 *
 * Because the caption state lives here and not in the meeting room component,
 * the participant grid never re-renders when captions update.
 */
export const CaptionsControlContext = createContext({
  enabled: false,
  supported: false,
  micError: false,
  toggle: () => {},
  capturing: false,
  setCapturing: () => {},
})

export const CaptionsLiveContext = createContext({ bySpeaker: {}, transcript: [] })

/** Toolbar / control-plane consumers (toggle, on/off, support state). */
export function useCaptionControls() {
  return useContext(CaptionsControlContext)
}

/** Live transcript consumer (the overlay + the Conversations panel). */
export function useLiveCaptions() {
  return useContext(CaptionsLiveContext)
}
