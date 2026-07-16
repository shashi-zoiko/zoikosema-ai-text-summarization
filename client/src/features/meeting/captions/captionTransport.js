import { useCallback, useEffect } from 'react'
import { useDataChannel, useRoomContext } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { CAPTION_CONFIG } from './config'
import { useMeetingCrypto } from '../e2ee/MeetingCryptoProvider.jsx'
import { resolveIdentity, identityFromParts } from './captionIdentity'
import { ctrace, traceEnabled } from './captionDebug'

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
    // ── STAGE 6: remote packet received on our topic ──────────────────────
    const fromId = msg.from?.identity
    ctrace('6-remote-received', {
      from: fromId || '(server?)',
      to: room?.localParticipant?.identity,
      topic: msg.topic,
      bytes: msg.payload?.byteLength ?? msg.payload?.length ?? 0,
    })
    let data
    try {
      data = JSON.parse(decoder.decode(msg.payload))
    } catch (err) {
      // ── STAGE 6 FAIL: not our JSON shape ────────────────────────────────
      ctrace('6-parse-FAIL', { from: fromId, topic: msg.topic, err: String(err?.message || err) })
      return // ignore anything that isn't our JSON shape
    }
    // ── STAGE 7: topic sanity (the hook already filters, but prove it) ─────
    if (msg.topic !== CAPTION_CONFIG.topic) {
      ctrace('7-topic-MISMATCH', { from: fromId, topic: msg.topic, expected: CAPTION_CONFIG.topic })
    }
    // Canonical identity comes from the LiveKit sender, resolved once here so
    // the rest of the pipeline never touches display-name heuristics.
    const identity = msg.from
      ? resolveIdentity(msg.from)
      : identityFromParts({ speakerId: data.speakerId, name: data.name })

    if (!msg.from) {
      // Attribution fallback engaged — the payload carries no from-participant.
      ctrace('7-no-from-participant', { speakerId: identity.speakerId, name: identity.name })
    }

    const emit = (text) => {
      // ── STAGE 9 (entry, remote): handing a decrypted frame to the store ──
      ctrace('9-ingest-remote', {
        from: identity.speakerId,
        seq: Number.isFinite(data.seq) ? data.seq : 0,
        uid: Number.isFinite(data.id) ? data.id : 0,
        final: !!data.isFinal,
        len: typeof text === 'string' ? text.length : 0,
        preview: typeof text === 'string' ? JSON.stringify(text.slice(0, 24)) : '',
      })
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
    }

    // `c` is the encrypted caption text; decrypt before surfacing it. A payload
    // that fails to decrypt is dropped (never shown as raw ciphertext). The
    // buffer's seq guard tolerates the out-of-order resolution of these promises.
    if (typeof data.c === 'string') {
      decrypt(data.c)
        .then((plain) => {
          // ── STAGE 8: decrypt result ───────────────────────────────────────
          if (plain == null) {
            ctrace('8-decrypt-FAIL', {
              from: fromId,
              seq: data.seq,
              uid: data.id,
              final: !!data.isFinal,
              cipherLen: data.c.length,
              reason: 'decrypt returned null (wrong key / tampered)',
            })
            return
          }
          ctrace('8-decrypt-OK', { from: fromId, seq: data.seq, uid: data.id, final: !!data.isFinal, len: plain.length })
          emit(plain)
        })
        .catch((err) => {
          ctrace('8-decrypt-THROW', { from: fromId, seq: data.seq, err: String(err?.message || err) })
        })
    } else if (typeof data.text === 'string') {
      // Legacy/unencrypted shape — tolerate it so a peer on an older build is
      // still readable during a rollout.
      ctrace('8-plaintext-legacy', { from: fromId, seq: data.seq, uid: data.id, final: !!data.isFinal })
      emit(data.text)
    } else {
      ctrace('8-no-payload-field', { from: fromId, keys: Object.keys(data).join(',') })
    }
  })

  const publish = useCallback(
    async (payload) => {
      const bytesPreview = typeof payload.text === 'string' ? payload.text.length : 0
      // ── STAGE 3: publish() called ─────────────────────────────────────────
      ctrace('3-publish-called', {
        self: room?.localParticipant?.identity,
        seq: payload.seq,
        uid: payload.utteranceId,
        final: !!payload.isFinal,
        topic: CAPTION_CONFIG.topic,
        chars: bytesPreview,
      })
      let wireBytes = 0
      try {
        const c = await encrypt(payload.text)
        const frame = encoder.encode(
          JSON.stringify({
            c,
            isFinal: payload.isFinal,
            seq: payload.seq,
            id: payload.utteranceId,
            conf: payload.confidence,
            lang: CAPTION_CONFIG.lang,
          }),
        )
        wireBytes = frame.byteLength
        await send(frame, {
          reliable: !!payload.isFinal,
          topic: CAPTION_CONFIG.topic,
        })
        // ── STAGE 4: publishData resolved (packet handed to LiveKit) ────────
        ctrace('4-publishData-OK', {
          self: room?.localParticipant?.identity,
          seq: payload.seq,
          uid: payload.utteranceId,
          final: !!payload.isFinal,
          topic: CAPTION_CONFIG.topic,
          bytes: wireBytes,
          reliable: !!payload.isFinal,
        })
      } catch (err) {
        // ── STAGE 4 FAIL: structured diagnostics (was a silent catch) ───────
        // Surface WHY the send failed plus the full connection context asked
        // for: room state, data-channel readiness, identity, topic, size.
        ctrace('4-publishData-FAIL', {
          self: room?.localParticipant?.identity,
          seq: payload.seq,
          uid: payload.utteranceId,
          final: !!payload.isFinal,
          topic: CAPTION_CONFIG.topic,
          bytes: wireBytes,
          roomState: room?.state,
          canPublishData: room?.localParticipant?.permissions?.canPublishData,
          canSubscribe: room?.localParticipant?.permissions?.canSubscribe,
          err: String(err?.message || err),
          name: err?.name,
        })
      }
    },
    [send, encrypt, room],
  )

  // ── Verification dump + raw all-topic listener (temporary diagnostics) ──────
  // On connect, prove the grants/room/participant facts the audit asks to
  // verify. The raw DataReceived listener catches caption packets that arrive
  // on an UNEXPECTED topic (would never reach the topic-filtered hook above),
  // which is the only way to detect a sender/receiver topic drift at runtime.
  useEffect(() => {
    if (!room || !traceEnabled()) return undefined
    const dumpFacts = (label) => {
      const lp = room.localParticipant
      ctrace(`info-${label}`, {
        roomState: room.state,
        roomSid: room.sid,
        self: lp?.identity,
        selfSid: lp?.sid,
        selfName: lp?.name,
        canPublishData: lp?.permissions?.canPublishData,
        canSubscribe: lp?.permissions?.canSubscribe,
        canPublish: lp?.permissions?.canPublish,
        remotes: Array.from(room.remoteParticipants?.values?.() || []).map((p) => p.identity).join('|') || '(none)',
        expectedTopic: CAPTION_CONFIG.topic,
      })
    }
    dumpFacts('connect')
    const onConn = () => dumpFacts('connected-event')
    const onPart = (p) => ctrace('info-remote-joined', { from: p?.identity, sid: p?.sid })
    const onRaw = (payload, participant, _kind, topic) => {
      // Log EVERY data packet's topic so a mismatch between what the sender
      // publishes and what we filter for is impossible to miss.
      ctrace('7-raw-any-topic', {
        from: participant?.identity || '(server)',
        topic: topic ?? '(none)',
        bytes: payload?.byteLength ?? payload?.length ?? 0,
        match: topic === CAPTION_CONFIG.topic,
      })
    }
    room.on(RoomEvent.ConnectionStateChanged, onConn)
    room.on(RoomEvent.ParticipantConnected, onPart)
    room.on(RoomEvent.DataReceived, onRaw)
    return () => {
      room.off(RoomEvent.ConnectionStateChanged, onConn)
      room.off(RoomEvent.ParticipantConnected, onPart)
      room.off(RoomEvent.DataReceived, onRaw)
    }
  }, [room])

  return { publish }
}
