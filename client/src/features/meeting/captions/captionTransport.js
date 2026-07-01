import { useCallback } from 'react'
import { useDataChannel } from '@livekit/components-react'
import { CAPTION_CONFIG } from './config'
import { useMeetingCrypto } from '../e2ee/MeetingCryptoProvider.jsx'

// One encoder/decoder for the module — caption payloads are tiny JSON blobs.
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Caption transport over the LiveKit data channel (topic: "captions").
 *
 * Captions ride the SFU, so fan-out scales with LiveKit (50+ participants) and
 * never touches our app server — lowest latency, zero extra backend load. This
 * is the ONLY file in the feature that imports LiveKit, so swapping to a
 * WebSocket transport later means replacing just this module.
 *
 * End-to-end encrypted: the caption text is AES-GCM encrypted with the
 * per-meeting key before it hits the data channel, so the SFU relays only
 * ciphertext. The tiny JSON envelope { c: "<encrypted>", isFinal } is what
 * actually crosses the wire; the plaintext transcript never leaves the client.
 *
 * Outbound: finals are sent reliably; interims lossy (a dropped interim is
 * immediately superseded by the next one). Inbound captions arrive via the
 * `onCaption` callback, with the sender resolved from the LiveKit participant.
 *
 * @param {{ onCaption?: (c: { speakerId, name, text, isFinal }) => void }} opts
 * @returns {{ publish: (payload: { text: string, isFinal: boolean }) => void }}
 */
export default function useCaptionTransport({ onCaption } = {}) {
  const { encrypt, decrypt } = useMeetingCrypto()

  const { send } = useDataChannel(CAPTION_CONFIG.topic, (msg) => {
    if (!onCaption) return
    let data
    try {
      data = JSON.parse(decoder.decode(msg.payload))
    } catch {
      return // ignore anything that isn't our JSON shape
    }
    const from = msg.from
    const emit = (text) =>
      onCaption({
        speakerId: from?.identity || data.speakerId || 'unknown',
        name: from?.name || data.name || 'Guest',
        text: typeof text === 'string' ? text : '',
        isFinal: !!data.isFinal,
      })
    // `c` is the encrypted caption text; decrypt before surfacing it. A payload
    // that fails to decrypt is dropped (never shown as raw ciphertext).
    if (typeof data.c === 'string') {
      decrypt(data.c).then((plain) => { if (plain != null) emit(plain) })
    } else if (typeof data.text === 'string') {
      // Legacy/unencrypted shape — tolerate it so a peer on an older build is
      // still readable during a rollout.
      emit(data.text)
    }
  })

  const publish = useCallback(
    async (payload) => {
      try {
        const c = await encrypt(payload.text)
        send(encoder.encode(JSON.stringify({ c, isFinal: payload.isFinal })), {
          reliable: !!payload.isFinal,
          topic: CAPTION_CONFIG.topic,
        })
      } catch {
        // Not connected yet (or send raced a reconnect). Dropping is fine — the
        // next interim/final frame carries the latest text anyway.
      }
    },
    [send, encrypt],
  )

  return { publish }
}
