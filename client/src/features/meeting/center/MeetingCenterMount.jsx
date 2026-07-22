import { useMemo } from 'react'
import { useRoomStore } from '../state/roomStore.js'
import { PeopleProvider } from '../people/ui/PeopleProvider.jsx'
import { useLiveKitMediaPeers } from '../people/ui/useLiveKitMediaPeers.js'
import MeetingCenterShell from './MeetingCenterShell.jsx'
import { userIdToIdentity } from '../people/identity.js'
import { EVENT, DELTA } from '../people/constants.js'
import { api } from '../../../api/client'

/**
 * Integration adapter that mounts the Meeting Center + People module inside the
 * live room. Rendered ONLY inside <LiveKitRoom> (it uses LiveKit hooks) and only
 * when meeting_center_v3 is on. Keeps MeetRoomLivekit's change to a single gated
 * block by pulling everything the People model needs from existing room state:
 *
 *   • control-WS transport (connected/send/subscribe) for seq'd deltas + snapshot
 *   • LiveKit roster → authoritative media presence
 *   • roomStore roles/hands/waiting → an immediate SEED (works before the server
 *     sends a people-snapshot; the module degrades gracefully on the current
 *     server)
 *   • existing admit/deny/admit-all/promote handlers → the action transport
 *     (server 'promote' toggles participant↔co_host, so demote maps to the same)
 *
 * State authority for open/active-tab stays the caller's existing `sidebar`
 * useState (single system — never two People implementations).
 */
export default function MeetingCenterMount({
  code,
  sidebar,
  setSidebar,
  transport, // { connected, send, subscribe }
  user,
  isHost,
  myRole,
  isHostOrCohost,
  unreadChat = 0,
  admitUser,
  denyUser,
  admitAll,
}) {
  const mediaPeers = useLiveKitMediaPeers()

  const roles = useRoomStore((s) => s.roles)
  const raisedHands = useRoomStore((s) => s.raisedHands)
  const waiting = useRoomStore((s) => s.waiting)
  const pinnedIdentity = useRoomStore((s) => s.pinnedIdentity)
  const togglePinned = useRoomStore((s) => s.togglePinned)
  const peopleSearch = useRoomStore((s) => s.peopleSearch)
  const peopleFilters = useRoomStore((s) => s.peopleFilters)
  const setPeopleSearch = useRoomStore((s) => s.setPeopleSearch)
  const togglePeopleFilter = useRoomStore((s) => s.togglePeopleFilter)

  const viewer = useMemo(
    () => ({ userId: user?.id ?? null, role: isHost ? 'host' : myRole, isHost }),
    [user?.id, isHost, myRole],
  )

  // Immediate seed from existing overlay state (roles + raised hands + waiting).
  // Computed plainly (not memoized): PeopleProvider consumes the seed exactly
  // ONCE, so a fresh object each render is harmless and avoids memoizing over a
  // Map/Set read. The realtime engine + media presence supersede it thereafter.
  const seed = {
    peers: Array.from(roles.entries()).map(([uid, role]) => ({ user_id: uid, role, hand: raisedHands.has(uid) })),
    waiting: (waiting || []).map((w) => ({
      user_id: w.user_id,
      name: w.name,
      is_guest: w.is_guest,
      color: w.color,
      avatar_url: w.avatar_url,
      joined_at: w.joined_at,
    })),
    self: user?.id != null ? { user_id: user.id } : null,
  }

  const actionTransport = useMemo(() => {
    // Role change over REST (reliable request/response), NOT the control WS —
    // the WS 'promote' path silently no-ops when the socket is mid-reconnect.
    // The REST endpoint toggles participant↔co_host, broadcasts role-changed to
    // everyone else, and returns the confirmed row; we feed that authoritative
    // role back so the acting host's pending clears without depending on the WS.
    const toggleRole = async (uid) => {
      const row = await api(`/api/meetings/${code}/promote`, { method: 'POST', body: { user_id: uid } })
      return { events: [{ type: EVENT.DELTA, delta: { kind: DELTA.ROLE, user_id: uid, role: row?.role } }] }
    }
    return {
      admit: (uid) => admitUser?.(uid),
      deny: (uid) => denyUser?.(uid),
      admitAll: () => admitAll?.(),
      promote: toggleRole,
      demote: toggleRole,
    }
  }, [admitUser, denyUser, admitAll, code])

  const tabContext = useMemo(() => ({
    isHostOrCohost,
    waitingCount: (waiting || []).length,
    raisedCount: raisedHands.size,
    unreadChat,
    chatHosted: false, // Chat stays its own drawer in this package (see registry)
  }), [isHostOrCohost, waiting, raisedHands, unreadChat])

  const activeTab = sidebar === 'chat' ? 'chat' : 'people'

  return (
    <PeopleProvider
      transport={transport}
      connected={transport?.connected}
      mediaPeers={mediaPeers}
      viewer={viewer}
      actionTransport={actionTransport}
      seed={seed}
      search={peopleSearch}
      filters={peopleFilters}
      pinnedKey={pinnedIdentity}
      onSearch={setPeopleSearch}
      onToggleFilter={togglePeopleFilter}
      onPin={(uid) => togglePinned(userIdToIdentity(uid))}
    >
      <MeetingCenterShell
        onClose={() => setSidebar(null)}
        activeTab={activeTab}
        setActiveTab={(tab) => setSidebar(tab)}
        open
        tabContext={tabContext}
      />
    </PeopleProvider>
  )
}
