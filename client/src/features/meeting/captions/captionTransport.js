import { useCallback } from 'react'
import { useDataChannel } from '@livekit/components-react'
import { CAPTION_CONFIG } from './config'

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
 * Outbound: finals are sent reliably; interims lossy (a dropped interim is
 * immediately superseded by the next one). Inbound captions arrive via the
 * `onCaption` callback, with the sender resolved from the LiveKit participant.
 *
 * @param {{ onCaption?: (c: { speakerId, name, text, isFinal }) => void }} opts
 * @returns {{ publish: (payload: { text: string, isFinal: boolean }) => void }}
 */
export default function useCaptionTransport({ onCaption } = {}) {
  const { send } = useDataChannel(CAPTION_CONFIG.topic, (msg) => {
    if (!onCaption) return
    let data
    try {
      data = JSON.parse(decoder.decode(msg.payload))
    } catch {
      return // ignore anything that isn't our JSON shape
    }
    const from = msg.from
    onCaption({
      speakerId: from?.identity || data.speakerId || 'unknown',
      name: from?.name || data.name || 'Guest',
      text: typeof data.text === 'string' ? data.text : '',
      isFinal: !!data.isFinal,
    })
  })

  const publish = useCallback(
    (payload) => {
      try {
        send(encoder.encode(JSON.stringify(payload)), {
          reliable: !!payload.isFinal,
          topic: CAPTION_CONFIG.topic,
        })
      } catch {
        // Not connected yet (or send raced a reconnect). Dropping is fine — the
        // next interim/final frame carries the latest text anyway.
      }
    },
    [send],
  )

  return { publish }
}
