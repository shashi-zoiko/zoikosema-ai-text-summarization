import { useCallback, useState } from 'react'

/**
 * Personal, device-local background collections — Favorites and Recently used —
 * backed by localStorage. Only ids are stored (never image data), so the caller
 * resolves each id back to a live preset/upload and stale entries simply drop
 * out. Uploads use ephemeral blob-url ids that don't survive a reload, so a
 * "recent" that no longer resolves is skipped rather than shown broken.
 */
const FAV_KEY = 'zoiko_bg_favorites'
const RECENT_KEY = 'zoiko_bg_recents'
const RECENT_MAX = 8

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write(key, arr) {
  try {
    localStorage.setItem(key, JSON.stringify(arr))
  } catch {
    /* private mode / storage disabled — collections are best-effort */
  }
}

export default function useBgCollections() {
  const [favorites, setFavorites] = useState(() => read(FAV_KEY))
  const [recents, setRecents] = useState(() => read(RECENT_KEY))

  const toggleFavorite = useCallback((id) => {
    if (!id || id === 'none') return
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev]
      write(FAV_KEY, next)
      return next
    })
  }, [])

  const pushRecent = useCallback((id) => {
    if (!id || id === 'none') return
    setRecents((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_MAX)
      write(RECENT_KEY, next)
      return next
    })
  }, [])

  const isFavorite = useCallback((id) => favorites.includes(id), [favorites])

  return { favorites, recents, toggleFavorite, pushRecent, isFavorite }
}
