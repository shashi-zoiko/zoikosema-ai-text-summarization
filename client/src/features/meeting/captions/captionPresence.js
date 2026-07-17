import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDataChannel, useLocalParticipant } from '@livekit/components-react'
import { CAPTION_CONFIG } from './config'
import { clog } from './captionDebug'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Event-driven caption-interest presence.
 *
 * The Meet behaviour we want: when ANY participant turns captions on, every
 * unmuted speaker's client should start transcribing its own mic so the CC
 * viewer sees the whole room. To know whether captions are wanted WITHOUT
 * polling the backend, participants gossip interest over a tiny data-channel
 * topic:
 *
 *   - turning CC on/off  → broadcast { on: true|false }
 *   - joining (mount)    → broadcast { query: true }; interested peers reply on
 *   - a peer disconnects → its interest is pruned (via `remoteIdentities`)
 *
 * Returns whether captions are wanted anywhere in the room (local OR remote),
 * which the provider uses to gate capture. Zero timers, zero backend calls.
 *
 * @param {{ enabled: boolean, remoteIdentities: string[] }} args
 * @returns {boolean} roomWantsCaptions
 */
export default function useCaptionPresence({ enabled, remoteIdentities }) {
  const { localParticipant } = useLocalParticipant()
  const selfId = localParticipant?.identity
  const [interested, setInterested] = useState(() => new Set())
  const enabledRef = useRef(enabled)
  const sendRef = useRef(null)
  useEffect(() => { enabledRef.current = enabled }, [enabled])

  const broadcast = useCallback((payload) => {
    try {
      const p = sendRef.current?.(encoder.encode(JSON.stringify(payload)), {
        reliable: true,
        topic: CAPTION_CONFIG.presenceTopic,
      })
      // send() (LiveKit publishData) is async — a sync try/catch does NOT catch
      // its rejection. When the data transport isn't ready (e.g. "PC manager is
      // closed" during a reconnect) that surfaced as an uncaught promise. Swallow
      // it; a later toggle/query re-announces.
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch { /* not connected yet — a later toggle/query re-announces */ }
  }, [])

  const { send } = useDataChannel(CAPTION_CONFIG.presenceTopic, (msg) => {
    let data
    try { data = JSON.parse(decoder.decode(msg.payload)) } catch { return }
    const from = msg.from?.identity
    if (!from || from === selfId) return
    // A peer asking who wants captions — answer if we do.
    if (data.query && enabledRef.current) {
      broadcast({ on: true })
      return
    }
    if (typeof data.on === 'boolean') {
      setInterested((prev) => {
        const has = prev.has(from)
        if (data.on === has) return prev
        const next = new Set(prev)
        if (data.on) next.add(from); else next.delete(from)
        clog('presence', { from, on: data.on, size: next.size })
        return next
      })
    }
  })
  useEffect(() => { sendRef.current = send }, [send])

  // Announce our own interest whenever it flips.
  useEffect(() => { broadcast({ on: !!enabled }) }, [enabled, broadcast])

  // On join, ask who already wants captions (so a silent late-joiner still
  // starts capturing for existing CC viewers).
  useEffect(() => { broadcast({ query: true }) }, [broadcast])

  // Captions are wanted if WE want them, or any STILL-PRESENT peer does.
  // Departed peers are pruned at derivation time (filtered against the live
  // roster) rather than by mutating state in an effect — stale ids in the set
  // are harmless and bounded by total participants seen.
  return useMemo(() => {
    if (enabled) return true
    if (interested.size === 0) return false
    const present = new Set(remoteIdentities)
    for (const id of interested) if (present.has(id)) return true
    return false
  }, [enabled, interested, remoteIdentities])
}
