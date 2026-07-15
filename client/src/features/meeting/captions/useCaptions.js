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
 *   Consumers: the CaptionOverlay (bySpeaker) and MeetRoomLivekit's
 *   transcriptRef bridge (transcript — the accumulated, finals-only log
 *   across the whole call, captured silently and never shown in-meeting;
 *   only sent to the backend at host-leave to generate the AI summary and
 *   the post-meeting raw conversation log).
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

/** Live transcript consumer (the overlay + the background transcript capture). */
export function useLiveCaptions() {
  return useContext(CaptionsLiveContext)
}
