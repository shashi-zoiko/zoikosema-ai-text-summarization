import { useCallback } from 'react'
import { useDataChannel, useRoomContext } from '@livekit/components-react'
import { ConnectionState } from 'livekit-client'
import { CAPTION_CONFIG } from './config'
import { useMeetingCrypto } from '../e2ee/MeetingCryptoProvider.jsx'
import { resolveIdentity, identityFromParts } from './captionIdentity'

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
 * ciphertext. The JSON envelope { c, isFinal, seq, id, lang, conf } is what
 * crosses the wire; the plaintext transcript never leaves the client.
 *
 * Ordering metadata (`seq` monotonic per sender, `id` = utterance) travels in
 * CLEARTEXT alongside the ciphertext so the receiver can order/de-dup frames
 * WITHOUT waiting on the async decrypt (which can resolve out of order).
 *
 * Outbound: finals are sent reliably; interims lossy (a dropped interim is
 * immediately superseded). Inbound captions arrive via `onCaption`, with the
 * speaker resolved from the LiveKit participant — never guessed from text.
 *
 * @param {{ onCaption?: (c) => void }} opts
 * @returns {{ publish: (payload) => void }}
 */
export default function useCaptionTransport({ onCaption } = {}) {
  const { encrypt, decrypt } = useMeetingCrypto()
  const room = useRoomContext()

  const { send } = useDataChannel(CAPTION_CONFIG.topic, (msg) => {
    if (!onCaption) return
    let data
    try {
      data = JSON.parse(decoder.decode(msg.payload))
    } catch {
      return // ignore anything that isn't our JSON shape
    }
    // Canonical identity comes from the LiveKit sender, resolved once here so
    // the rest of the pipeline never touches display-name heuristics.
    const identity = msg.from
      ? resolveIdentity(msg.from)
      : identityFromParts({ speakerId: data.speakerId, name: data.name })

    const emit = (text) =>
      onCaption({
        speakerId: identity.speakerId,
        identity,
        text: typeof text === 'string' ? text : '',
        isFinal: !!data.isFinal,
        seq: Number.isFinite(data.seq) ? data.seq : 0,
        utteranceId: Number.isFinite(data.id) ? data.id : 0,
        confidence: Number.isFinite(data.conf) ? data.conf : 0,
        lang: typeof data.lang === 'string' ? data.lang : CAPTION_CONFIG.lang,
      })

    // `c` is the encrypted caption text; decrypt before surfacing it. A payload
    // that fails to decrypt is dropped (never shown as raw ciphertext). The
    // buffer's seq guard tolerates the out-of-order resolution of these promises.
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
      // CRITICAL: never call publishData before the room is fully Connected.
      // LiveKit caches the publisher-connection promise on the FIRST
      // publishData; if that first call happens before the engine's pcManager is
      // ready, it caches a REJECTED promise ("PC manager is closed") that is
      // cleared only on publisher close/disconnect/fail — NEVER on connect. So a
      // single premature publish poisons every later caption send for the whole
      // session. Waiting for Connected guarantees the first publish caches a
      // resolved promise.
      if (room?.state !== ConnectionState.Connected) return
      try {
        const c = await encrypt(payload.text)
        await send(
          encoder.encode(
            JSON.stringify({
              c,
              isFinal: payload.isFinal,
              seq: payload.seq,
              id: payload.utteranceId,
              conf: payload.confidence,
              lang: CAPTION_CONFIG.lang,
            }),
          ),
          {
            reliable: !!payload.isFinal,
            topic: CAPTION_CONFIG.topic,
          },
        )
      } catch {
        // Transport not ready (or send raced a reconnect). Dropping is fine — the
        // next interim/final frame carries the latest text anyway.
      }
    },
    [send, encrypt, room],
  )

  return { publish }
}
