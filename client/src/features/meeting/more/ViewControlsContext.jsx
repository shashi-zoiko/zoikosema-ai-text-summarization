import { createContext, useContext } from 'react'

/**
 * Exposes the meeting shell's EXISTING view state + actions to the More Menu.
 *
 * This is a conduit, not a view manager — the state still lives in MeetRoom's own
 * `useState` (view mode, sidebar, focus, self-view). It exists because the menu
 * renders through the OverlayHost portal; React context (which follows the React
 * tree, not the DOM) delivers the LIVE view model to the portaled panel so its
 * checked/active state always reflects actual app state (never a stale closure).
 *
 * Shape: { mode, requestMode, meetingCenterOpen, toggleMeetingCenter, focus,
 *          toggleFocus, selfView, toggleSelfView, presenting }
 */
const ViewControlsContext = createContext(null)

export function ViewControlsProvider({ value, children }) {
  return <ViewControlsContext.Provider value={value}>{children}</ViewControlsContext.Provider>
}

export function useViewControls() {
  return useContext(ViewControlsContext)
}
