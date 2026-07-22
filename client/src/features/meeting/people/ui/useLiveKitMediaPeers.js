import { useMemo } from 'react'
import { useParticipants, useLocalParticipant } from '@livekit/components-react'
import { ConnectionQuality } from 'livekit-client'
import { isGuestParticipant, participantAvatarUrl } from '../../components/GuestBadge.jsx'
import { DEVICE, CONN } from '../constants.js'
import { personKey, identityToUserId } from '../identity.js'

/**
 * Maps the authoritative LiveKit roster into normalized media peers for the
 * People engine. Must be called INSIDE <LiveKitRoom> (uses LiveKit hooks) — the
 * integration seam. Groups multiple sessions of the same user (same personKey)
 * into one peer with a `sessions` count so a person never appears twice.
 */
function mapConnection(q) {
  if (q === ConnectionQuality.Poor || q === ConnectionQuality.Lost || q === 'poor' || q === 'lost') return CONN.ATTENTION
  if (q === ConnectionQuality.Excellent || q === ConnectionQuality.Good || q === 'excellent' || q === 'good') return CONN.GOOD
  return CONN.UNKNOWN
}

export function useLiveKitMediaPeers() {
  const participants = useParticipants()
  const { localParticipant } = useLocalParticipant()
  const localIdentity = localParticipant?.identity

  return useMemo(() => {
    const byKey = new Map()
    for (const p of participants) {
      const key = personKey(p.identity)
      if (key == null) continue
      const peer = {
        identity: p.identity,
        // Derive the numeric user_id from the identity ("u:42" → 42). Without
        // this, media-sourced people (esp. guests who join mid-meeting) carry a
        // null userId, so privileged actions send user_id:null and the server
        // no-ops — the promote spinner then hangs forever.
        userId: identityToUserId(p.identity),
        name: p.name || p.identity,
        isSelf: p.identity === localIdentity || p.isLocal === true,
        isGuest: isGuestParticipant(p),
        avatarUrl: participantAvatarUrl(p),
        mic: p.isMicrophoneEnabled ? DEVICE.ON : DEVICE.OFF,
        camera: p.isCameraEnabled ? DEVICE.ON : DEVICE.OFF,
        presenting: !!p.isScreenShareEnabled,
        connection: mapConnection(p.connectionQuality),
        sessions: 1,
      }
      const existing = byKey.get(key)
      if (existing) {
        // Multi-session: merge — count sessions and OR the active media.
        existing.sessions += 1
        existing.mic = existing.mic === DEVICE.ON || peer.mic === DEVICE.ON ? DEVICE.ON : DEVICE.OFF
        existing.camera = existing.camera === DEVICE.ON || peer.camera === DEVICE.ON ? DEVICE.ON : DEVICE.OFF
        existing.presenting = existing.presenting || peer.presenting
        existing.isSelf = existing.isSelf || peer.isSelf
      } else {
        byKey.set(key, peer)
      }
    }
    return Array.from(byKey.values())
    // participants identity/length + local identity capture the roster shape;
    // media-flag changes surface via useParticipants re-renders.
  }, [participants, localIdentity])
}
