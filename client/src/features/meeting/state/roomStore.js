import { create } from 'zustand'

/**
 * Cross-component UI state for the LiveKit room. Lives in zustand (not React
 * state inside <LiveKitRoom>) so tiles can read individual slices via
 * selectors without re-rendering the entire room subtree on every change.
 */
export const useRoomStore = create((set) => ({
  // pinnedIdentity: LiveKit identity (e.g. "u:42") for hero slot + high quality
  pinnedIdentity: null,
  setPinned: (id) => set({ pinnedIdentity: id }),
  togglePinned: (id) =>
    set((s) => ({ pinnedIdentity: s.pinnedIdentity === id ? null : id })),

  // heroActive: true whenever the stage is in hero mode (screen share OR
  // speaker-view hero). Published by <Stage> and read by <CaptionOverlay> so
  // captions can clear the bottom participant carousel that hero mode shows on
  // phones/portrait — they must never sit on top of the strip (Phase 8).
  heroActive: false,
  setHeroActive: (v) =>
    set((s) => (s.heroActive === !!v ? s : { heroActive: !!v })),

  // presenting: true whenever a screen-share is on stage. Published by <Stage>
  // and read (via selector) to resolve the More Menu's "Presenter" view mode
  // availability — no camera/track state, purely "is there shared content".
  presenting: false,
  setPresenting: (v) =>
    set((s) => (s.presenting === !!v ? s : { presenting: !!v })),

  // waiting: authoritative waiting-room list [{user_id,name,color,is_guest,email,avatar_url,joined_at}].
  // Lives here (not in <MeetRoomLivekit> local state) so the header admit-chip,
  // the People panel and the dock badge read the same slice via selectors
  // instead of prop-drilling — and a per-second waiting timer re-renders only
  // its own leaf, never the panel.
  waiting: [],
  // Accepts a list (WS re-sync) or an updater fn (optimistic admit/deny), so
  // existing `setWaiting(prev => prev.filter(...))` call sites keep working.
  setWaiting: (list) =>
    set((s) => {
      const next = typeof list === 'function' ? list(s.waiting) : list
      return { waiting: Array.isArray(next) ? next : [] }
    }),

  // raisedHands: Set<user_id>
  raisedHands: new Set(),
  setHand: (userId, raised) =>
    set((s) => {
      const next = new Set(s.raisedHands)
      if (raised) next.add(userId)
      else next.delete(userId)
      return { raisedHands: next }
    }),
  clearHands: () => set({ raisedHands: new Set() }),

  // reactions: capped queue, ReactionOverlay drains by ts
  reactions: [],
  pushReaction: (r) =>
    set((s) => ({
      reactions: [...s.reactions.slice(-49), { ...r, _ts: Date.now() }],
    })),

  // cameraStats: the REAL delivered camera format {width,height,frameRate,tier,
  // maxWidth,maxHeight,maxFrameRate} measured from the live track — NOT the
  // requested resolution. null while the camera is off. Written by
  // <CameraQualityProbe>; the single source of truth for honest HD reporting.
  cameraStats: null,
  setCameraStats: (stats) =>
    set((s) => (s.cameraStats === stats ? s : { cameraStats: stats })),

  // roles: Map<user_id, 'host' | 'co_host' | 'participant'>. Seeded from the
  // welcome event (peers list + self) and updated on role-changed/peer-joined.
  // Used by the Participants panel to decide which actions to surface.
  roles: new Map(),
  setRole: (userId, role) =>
    set((s) => {
      if (s.roles.get(userId) === role) return s
      const next = new Map(s.roles)
      next.set(userId, role)
      return { roles: next }
    }),
  seedRoles: (entries) =>
    set(() => ({ roles: new Map(entries) })),

  // Clear all per-meeting transient state. This store is module-global, so
  // without a reset on room entry the previous meeting's reactions (replayed
  // by ReactionOverlay on mount), pins, raised hands and roles leak into the
  // next one.
  reset: () =>
    set({
      pinnedIdentity: null,
      heroActive: false,
      presenting: false,
      waiting: [],
      raisedHands: new Set(),
      reactions: [],
      roles: new Map(),
      cameraStats: null,
    }),
}))
