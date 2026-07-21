import { useCallback, useEffect, useState } from 'react'

/**
 * Actual platform state + actions for Full screen and Picture-in-picture (§7.1:
 * these represent real OS/browser state, not optimistic preference).
 *
 * Reuses existing implementations:
 *  - Full screen via the Fullscreen API (same approach as the legacy More menu).
 *  - PiP via the existing PresenterPiP component's `zoiko:toggle-pip` event
 *    contract — this hook never opens its own PiP window.
 */

function isFullscreen() {
  return typeof document !== 'undefined' && !!document.fullscreenElement
}
function pipSupported() {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window
}
function pipOpen() {
  return pipSupported() && !!window.documentPictureInPicture?.window
}

export function usePlatformViewState() {
  const [fullscreen, setFullscreen] = useState(isFullscreen)
  const [pip, setPip] = useState(pipOpen)

  useEffect(() => {
    const onFs = () => setFullscreen(isFullscreen())
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    if (!pipSupported()) return undefined
    const dp = window.documentPictureInPicture
    const onEnter = () => {
      setPip(true)
      window.documentPictureInPicture?.window?.addEventListener?.(
        'pagehide',
        () => setPip(false),
        { once: true },
      )
    }
    dp.addEventListener?.('enter', onEnter)
    return () => dp.removeEventListener?.('enter', onEnter)
  }, [])

  const toggleFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.()
      else document.documentElement.requestFullscreen?.()
    } catch {
      // fullscreen blocked by the browser — ignore
    }
  }, [])

  const togglePip = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent('zoiko:toggle-pip'))
    } catch {
      // event dispatch unavailable — ignore
    }
  }, [])

  return { fullscreen, pip, pipSupported: pipSupported(), toggleFullscreen, togglePip }
}
