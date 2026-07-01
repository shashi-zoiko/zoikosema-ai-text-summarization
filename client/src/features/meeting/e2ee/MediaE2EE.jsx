import { useEffect } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { ExternalE2EEKeyProvider, Room, RoomEvent } from 'livekit-client'

// LiveKit media (audio/video/screen-share) end-to-end encryption.
//
// LiveKit encrypts frames in a dedicated Web Worker using insertable streams
// (SFrame). The SFU forwards the encrypted frames without ever decoding them,
// so a compromised or curious server sees only ciphertext. All participants
// share one key (the per-meeting key from /media-token), fed to the
// ExternalE2EEKeyProvider which derives the actual frame key.
//
// CRITICAL ORDERING: E2EE must be armed BEFORE the room connects and publishes
// any track — otherwise the mic/camera track goes out unencrypted for the brief
// window before setE2EEEnabled takes effect. So we build the Room ourselves,
// call setE2EEEnabled(true) (which sets the local participant's encryptionType
// to GCM), and only then let <LiveKitRoom> connect it. Every track published
// after that is encrypted from its first frame.

/**
 * Build the Room pre-wired for media E2EE, plus the worker/keyProvider. Pass
 * the returned `room` to <LiveKitRoom room={...}> and gate its `connect` on
 * armMediaE2EE() having resolved.
 * @param {object} roomOptions  base RoomOptions (adaptiveStream, publishDefaults…)
 * @returns {{ room: Room, worker: Worker, keyProvider: ExternalE2EEKeyProvider }}
 */
export function createE2EERoom(roomOptions) {
  const worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), {
    type: 'module',
  })
  const keyProvider = new ExternalE2EEKeyProvider()
  const room = new Room({ ...roomOptions, e2ee: { keyProvider, worker } })
  return { room, worker, keyProvider }
}

/**
 * Set the shared key and turn E2EE on for the room. Resolves once the local
 * participant's encryption type is GCM — call this and await it BEFORE
 * connecting the room. Throws if the browser/room refuses, so the caller can
 * refuse to connect rather than transmit unencrypted media.
 */
export async function armMediaE2EE(room, keyProvider, keyB64) {
  await keyProvider.setKey(keyB64)
  await room.setE2EEEnabled(true)
}

/**
 * Dev-only observer of the room's REAL media-E2EE state. Renders nothing and is
 * stripped from production builds. Rather than trust a single flag, it reports
 * the GROUND TRUTH — `publication.isEncrypted` on the actual published tracks —
 * plus the room/participant flags, so we can see unambiguously whether frames
 * are encrypted. The green ✓ prints only when a published track reports
 * isEncrypted === true.
 */
export function MediaE2EEStatus() {
  const room = useRoomContext()
  useEffect(() => {
    if (!room || !import.meta.env.DEV) return undefined

    const dump = (label) => {
      const lp = room.localParticipant
      const pubs = lp ? Array.from(lp.trackPublications.values()) : []
      const encrypted = pubs.map((p) => `${p.source}:${p.isEncrypted ? 'ENC' : 'plain'}`)
      const anyEncrypted = pubs.some((p) => p.isEncrypted)
      // eslint-disable-next-line no-console
      console.log(
        `%c[e2ee] ${label}`,
        'color:#38BDF8',
        `room.isE2EEEnabled=${room.isE2EEEnabled} localParticipant.isE2EEEnabled=${lp?.isE2EEEnabled} tracks=[${encrypted.join(', ') || 'none published'}]`,
      )
      if (anyEncrypted) {
        // eslint-disable-next-line no-console
        console.log(
          '%c[e2ee] media encryption ACTIVE ✓',
          'color:#10B981;font-weight:bold',
          '— a published track reports isEncrypted=true, frames are E2E-encrypted past the SFU',
        )
      } else if (pubs.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[e2ee] a track is published but NOT encrypted — investigate!', encrypted)
      }
    }

    dump('observer mounted')
    const onEnc = () => dump('ParticipantEncryptionStatusChanged')
    const onPub = () => dump('LocalTrackPublished')
    const onConn = (state) => { if (state === 'connected') dump('connected') }
    room.on(RoomEvent.ParticipantEncryptionStatusChanged, onEnc)
    room.on(RoomEvent.LocalTrackPublished, onPub)
    room.on(RoomEvent.ConnectionStateChanged, onConn)
    room.on(RoomEvent.EncryptionError, (e) => console.error('[e2ee] encryption error', e))
    return () => {
      room.off(RoomEvent.ParticipantEncryptionStatusChanged, onEnc)
      room.off(RoomEvent.LocalTrackPublished, onPub)
      room.off(RoomEvent.ConnectionStateChanged, onConn)
    }
  }, [room])
  return null
}
