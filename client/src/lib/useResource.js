import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'

/**
 * Fetch a GET resource once on mount (and on `path` change), exposing
 * loading / error / data plus a `reload` for retry buttons. Keeps pages
 * dynamic — no hardcoded data — with real loading and error states.
 */
export function useResource(path) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api(path))
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => { load() }, [load])

  return { data, error, loading, reload: load }
}
