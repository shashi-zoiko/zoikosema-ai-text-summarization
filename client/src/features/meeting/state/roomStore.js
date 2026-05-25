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
}))
