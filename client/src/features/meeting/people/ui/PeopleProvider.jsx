import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPeopleStore } from '../peopleStore.js'
import { createRealtimeEngine } from '../realtimeEngine.js'
import { createPeopleActions } from '../actions.js'
import { selectGroups, selectRowCount } from '../selectors.js'
import { resolveRowActions, resolveQueueActions, deriveViewerCapabilities, normalizeCapabilities } from '../capabilities.js'
import { EVENT, VIRTUALIZE_THRESHOLD } from '../constants.js'
import { useDebouncedValue } from '../../../../hooks/useDebouncedValue.js'
import { trackEvent } from '../../../../lib/analytics.js'

/**
 * The ONE People domain model for every surface (docked panel, overlay drawer,
 * mobile). LiveKit-free by design — media presence, pinned key and speaking keys
 * are fed in as plain data, so this provider is unit-testable without a LiveKit
 * context and there is never a second People implementation.
 *
 * Two contexts on purpose:
 *   • ApiContext   — STABLE (actions, capabilities, resolvers, callbacks). Rows
 *     consume only this, so a delta that changes the roster does NOT re-render
 *     every row (they memoize on their own `person`).
 *   • ViewContext  — CHANGING (grouped view, counts, recovery). Only the list
 *     and toolbar consume it.
 */
const ApiContext = createContext(null)
const ViewContext = createContext(null)

export function usePeopleApi() {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('usePeopleApi must be used within <PeopleProvider>')
  return ctx
}
export function usePeopleView() {
  const ctx = useContext(ViewContext)
  if (!ctx) throw new Error('usePeopleView must be used within <PeopleProvider>')
  return ctx
}
/** Non-throwing view reader — null when rendered outside a PeopleProvider. */
export function usePeopleViewOptional() {
  return useContext(ViewContext)
}

const noopTransport = { send() {}, subscribe() { return () => {} } }
const disabledActions = {
  admit: async () => {}, deny: async () => {}, promote: async () => {}, demote: async () => {}, admitAll: async () => {},
}
function perfNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

export function PeopleProvider({
  children,
  transport,
  connected = false,
  mediaPeers = [],
  viewer = {},
  actionTransport,
  seed,
  search = '',
  filters = [],
  pinnedKey = null,
  speakingKeys = null,
  onSearch,
  onToggleFilter,
  onPin,
  telemetry = trackEvent,
  enabled = true,
}) {
  // Stable instances created exactly once (useState lazy initializer — the
  // idiomatic stable-instance pattern; no ref read during render).
  const [{ store, engine, actions }] = useState(() => {
    const s = createPeopleStore({ onTelemetry: telemetry })
    const e = createRealtimeEngine({ store: s, transport: transport || noopTransport, telemetry })
    const a = actionTransport ? createPeopleActions({ store: s, transport: actionTransport, telemetry }) : null
    return { store: s, engine: e, actions: a }
  })

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current || !enabled) return
    if (seed && (seed.peers?.length || seed.waiting?.length)) {
      store.dispatch({ type: EVENT.SNAPSHOT, seq: 0, self: seed.self ?? null, peers: seed.peers ?? [], waiting: seed.waiting ?? [], permissions: seed.permissions ?? {} })
      seededRef.current = true
    }
  }, [store, seed, enabled])

  useEffect(() => {
    if (!enabled) return undefined
    return engine.start()
  }, [engine, enabled])

  const wasConnected = useRef(false)
  useEffect(() => {
    if (!enabled) return
    if (connected && !wasConnected.current) engine.onConnected()
    wasConnected.current = connected
  }, [connected, engine, enabled])

  useEffect(() => {
    if (!enabled) return
    engine.syncMedia(mediaPeers, { full: true })
  }, [engine, mediaPeers, enabled])

  const viewerCaps = useMemo(
    () => (viewer.capabilities ? normalizeCapabilities(viewer.capabilities) : deriveViewerCapabilities(viewer)),
    [viewer],
  )
  const viewerKey = viewer.userId != null ? String(viewer.userId) : null

  const debouncedSearch = useDebouncedValue(search, 150)

  const view = useMemo(() => {
    const t0 = perfNow()
    const g = selectGroups(state, { query: debouncedSearch, filters })
    const ms = perfNow() - t0
    if (debouncedSearch) telemetry?.('people_search', { q_len: debouncedSearch.length, results: g.matched, search_ms: Math.round(ms) })
    return g
  }, [state, debouncedSearch, filters, telemetry])

  const rowCount = useMemo(() => selectRowCount(state, { query: debouncedSearch, filters }), [state, debouncedSearch, filters])
  const virtualize = rowCount > VIRTUALIZE_THRESHOLD

  // STABLE api — no `state` dependency so rows don't churn on every delta.
  const api = useMemo(() => ({
    caps: viewerCaps,
    viewerKey,
    actions: actions || disabledActions,
    pin: onPin,
    setSearch: onSearch,
    toggleFilter: onToggleFilter,
    rowActions: (target) => resolveRowActions({ viewerCaps, viewerKey, target }),
    queueActions: (waitingCount) => resolveQueueActions({ viewerCaps, waitingCount }),
    pinnedKey,
    speakingKeys,
  }), [viewerCaps, viewerKey, actions, onPin, onSearch, onToggleFilter, pinnedKey, speakingKeys])

  const viewValue = useMemo(() => ({
    ready: state.ready,
    view,
    rowCount,
    virtualize,
    gap: state.gap,
    recovering: !!state.gap || state.needsResync,
    permissions: state.permissions,
    search,
    filters,
    stats: store.stats,
  }), [state.ready, view, rowCount, virtualize, state.gap, state.needsResync, state.permissions, search, filters, store])

  return (
    <ApiContext.Provider value={api}>
      <ViewContext.Provider value={viewValue}>{children}</ViewContext.Provider>
    </ApiContext.Provider>
  )
}
