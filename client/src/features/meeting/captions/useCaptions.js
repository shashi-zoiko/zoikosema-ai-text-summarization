import { createContext, useContext, useSyncExternalStore } from 'react'

/**
 * Two separate contexts — deliberately split for performance.
 *
 * - ControlContext changes RARELY (CC toggled, support/error state flips, or
 *   Meet Summarizer capture toggled on/off). Consumers: the toolbar CC button
 *   (enabled/toggle) and MeetingHeader's SummarizerButton (capturing/
 *   setCapturing — drives both the header button's glow effect and its
 *   popover's Start/Pause Summarizing toggle).
 * - LiveContext holds two independent things:
 *     - `store` — the caption buffer store handle (a stable reference). The
 *       overlay subscribes to it via useSyncExternalStore, so frame-rate
 *       caption updates re-render ONLY the overlay — never the provider or
 *       the grid.
 *     - `transcript` — the accumulated, finals-only log across the whole
 *       call, captured silently and never shown in-meeting; only sent to the
 *       backend at host-leave to generate the AI summary and the post-meeting
 *       raw conversation log. Changes far less often than the store (once
 *       per finalized line, not per frame), so it's fine as plain context
 *       value rather than needing its own external store.
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

export const CaptionsLiveContext = createContext({ store: null, transcript: [] })

/** Toolbar / control-plane consumers (toggle, on/off, support state). */
export function useCaptionControls() {
  return useContext(CaptionsControlContext)
}

const EMPTY = {}
const noopSubscribe = () => () => {}

/**
 * Live captions consumer (the overlay + the background transcript capture).
 * `bySpeaker` subscribes directly to the buffer store, so frame-rate updates
 * re-render only this consumer; `transcript` is the accumulated finals-only
 * log (see CaptionsLiveContext doc above).
 */
export function useLiveCaptions() {
  const { store, transcript } = useContext(CaptionsLiveContext)
  const bySpeaker = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : () => EMPTY,
    () => EMPTY,
  )
  return { bySpeaker, transcript }
}
