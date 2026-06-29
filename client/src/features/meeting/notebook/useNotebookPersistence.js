import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../api/client'

// Persistence layer for a participant's PRIVATE notebook.
//
// Contract:
//  - Loads instantly from localStorage (never lose data, even offline), then
//    reconciles against the backend by newer updated_at.
//  - Every `update(partial)` mirrors to localStorage immediately and schedules a
//    1s-debounced PUT to the backend.
//  - Flushes any pending save on tab close/unmount and when the network returns.
//  - All data is scoped per (meeting code, user) and never shared with anyone.

const DEBOUNCE_MS = 1000
const EMPTY = { notes_json: null, drawing_json: null, sticky_notes: null, canvas_state: null }

const cacheKey = (code, userId) => `zoiko_notebook_${code}_${userId ?? 'me'}`

function readCache(code, userId) {
  try {
    const raw = localStorage.getItem(cacheKey(code, userId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeCache(code, userId, data) {
  try {
    localStorage.setItem(cacheKey(code, userId), JSON.stringify(data))
  } catch { /* quota / private mode — backend autosave still covers us */ }
}

export function useNotebookPersistence(code, userId) {
  // The live, merged notebook. Children seed from `initialData` (re-seeded via
  // `version` when the backend reconciliation swaps in newer data).
  const dataRef = useRef({ ...EMPTY })
  const [initialData, setInitialData] = useState(null) // null = still loading
  const [version, setVersion] = useState(0)
  const [status, setStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'

  const timerRef = useRef(null)
  const dirtyRef = useRef(false)
  const savedTimerRef = useRef(null)

  const flushNow = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (!dirtyRef.current) return
    dirtyRef.current = false
    setStatus('saving')
    try {
      await api(`/api/meetings/${code}/private-notes`, { method: 'PUT', body: dataRef.current })
      // If nothing else changed while the request was in flight, mark saved.
      if (!dirtyRef.current) {
        setStatus('saved')
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setStatus('idle'), 1500)
      }
    } catch {
      // Keep the change in localStorage and mark dirty again so the next edit or
      // a reconnect retries it — the data is never lost.
      dirtyRef.current = true
      setStatus('error')
    }
  }, [code])

  // Initial load: localStorage instantly, then reconcile with the backend.
  useEffect(() => {
    let cancelled = false
    const cached = readCache(code, userId)
    if (cached) {
      dataRef.current = { ...EMPTY, ...cached }
      setInitialData(dataRef.current)
    }
    ;(async () => {
      try {
        const server = await api(`/api/meetings/${code}/private-notes`)
        if (cancelled) return
        const serverMs = server?.updated_at ? Date.parse(server.updated_at) : 0
        const localMs = cached?._cachedAt || 0
        // If the user already started editing during the load window, their
        // in-progress edits win — don't clobber them by remounting with the
        // server snapshot (the debounced save will push the edits up anyway).
        if (serverMs >= localMs && server && !dirtyRef.current) {
          // Backend is newer (or we had no cache) → adopt it and refresh cache.
          dataRef.current = { ...EMPTY, ...server }
          writeCache(code, userId, { ...dataRef.current, _cachedAt: serverMs })
          setInitialData(dataRef.current)
          setVersion(v => v + 1)
        } else if (localMs > serverMs) {
          // Local edits made while offline are newer → push them up.
          dirtyRef.current = true
          flushNow()
        }
      } catch {
        // Offline / server error: localStorage (if any) already drives the UI.
      } finally {
        if (!cancelled) setInitialData(prev => prev ?? { ...EMPTY })
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, userId])

  // Merge a partial change, cache it, and debounce a save.
  const update = useCallback((partial) => {
    dataRef.current = { ...dataRef.current, ...partial }
    const cachedAt = Date.now()
    writeCache(code, userId, { ...dataRef.current, _cachedAt: cachedAt })
    dirtyRef.current = true
    setStatus('saving')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flushNow, DEBOUNCE_MS)
  }, [code, userId, flushNow])

  const remove = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    dirtyRef.current = false
    dataRef.current = { ...EMPTY }
    try { localStorage.removeItem(cacheKey(code, userId)) } catch { /* ignore */ }
    setInitialData({ ...EMPTY })
    setVersion(v => v + 1)
    setStatus('idle')
    try { await api(`/api/meetings/${code}/private-notes`, { method: 'DELETE' }) } catch { /* ignore */ }
  }, [code, userId])

  // Flush on reconnect and on unmount/tab-hide so nothing pending is lost.
  useEffect(() => {
    const onOnline = () => { if (dirtyRef.current) flushNow() }
    const onHide = () => { if (document.visibilityState === 'hidden' && dirtyRef.current) flushNow() }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onHide)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      if (dirtyRef.current) flushNow()
    }
  }, [flushNow])

  return {
    loaded: initialData !== null,
    initialData,
    version,
    status,
    update,
    saveNow: flushNow,
    remove,
  }
}
