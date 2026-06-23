import { createContext, useContext } from 'react'
import { getTheme, DEFAULT_THEME_ID } from './roomThemes'

/**
 * Carries the active meeting theme down to the tiles (SelfTile / PeerTile)
 * without prop-drilling through the render-loop. Tiles read it to paint their
 * camera-off background and avatar ring; the room root drives everything else
 * through CSS variables. Default keeps standalone tile usage sane.
 */
const RoomThemeContext = createContext(getTheme(DEFAULT_THEME_ID))

export function RoomThemeProvider({ theme, children }) {
  return <RoomThemeContext.Provider value={theme}>{children}</RoomThemeContext.Provider>
}

export function useRoomTheme() {
  return useContext(RoomThemeContext)
}
