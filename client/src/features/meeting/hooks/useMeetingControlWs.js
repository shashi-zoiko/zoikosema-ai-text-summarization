import { useCallback, useEffect, useRef, useState } from 'react'
import { getWsBase } from '../../../api/client'

/**
 * Connects to the existing /ws/meetings/{code} control WS and exposes:
 *   - `connected`: boolean
 *   - `send(payload)`: stringifies + sends (queues while reconnecting)
 *   - `subscribe(handler)`: receive parsed JSON messages
 *
 * Media (offer/answer/ICE) is NOT handled here — that's LiveKit's job. This
 * hook only forwards app-level events: chat, reactions, raise-hand, captions,
 * waiting-room, host actions, permissions.
 */
export default function useMeetingControlWs(code, { password } = {}) {
  const wsRef = useRef(null)
  const handlersRef = useRef(new Set())
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef(null)
  const outboxRef = useRef([]) // sends queued while the socket is down
  const [connected, setConnected] = useState(false)

  const send = useCallback((payload) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
    } else {
      // Socket is mid-(re)connect — queue and flush on open so control-plane
      // messages (chat, reactions, raise-hand) aren't silently lost.
      outboxRef.current.push(payload)
    }
  }, [])

  const subscribe = useCallback((handler) => {
    handlersRef.current.add(handler)
    return () => handlersRef.current.delete(handler)
  }, [])

  useEffect(() => {
    if (!code) return
    let cancelled = false

    const open = () => {
      if (cancelled) return
      const token = localStorage.getItem('zoiko_token') || ''
      const pwd = password || ''
      let url = `${getWsBase()}/ws/meetings/${code}?token=${encodeURIComponent(token)}`
      if (pwd) url += `&pwd=${encodeURIComponent(pwd)}`
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        // Ignore a stale socket that has already been superseded (see onclose).
        if (wsRef.current !== ws) return
        reconnectAttemptRef.current = 0
        setConnected(true)
        // Flush anything queued while we were down.
        const queued = outboxRef.current
        outboxRef.current = []
        for (const p of queued) {
          try { ws.send(JSON.stringify(p)) } catch { outboxRef.current.push(p) }
        }
      }
      ws.onmessage = (e) => {
        let data
        try { data = JSON.parse(e.data) } catch { return }
        handlersRef.current.forEach((h) => {
          try { h(data) } catch (err) { console.error('control ws handler error', err) }
        })
      }
      ws.onerror = () => { /* surfaced by onclose */ }
      ws.onclose = (ev) => {
        // CRITICAL: a superseded socket's late onclose must NOT clobber the
        // live one. React StrictMode (dev) double-mounts, so socket A can fire
        // onclose AFTER its replacement B is already in wsRef. Without this
        // guard that nulled the live ref and every send silently dropped —
        // the socket kept *receiving* (handlers fire) but `send` no-op'd.
        if (wsRef.current !== ws) return
        setConnected(false)
        wsRef.current = null
        // 4001 = superseded by a newer session (server-side); don't reconnect.
        // 4401/4403/4404/4423/4410 = hard auth/state errors; don't reconnect.
        const hard = [4001, 4401, 4403, 4404, 4410, 4423].includes(ev.code)
        if (cancelled || hard) return
        const attempt = ++reconnectAttemptRef.current
        const delay = Math.min(8000, 200 * Math.pow(2, attempt)) + Math.floor(Math.random() * 250)
        reconnectTimerRef.current = setTimeout(open, delay)
      }
    }

    open()

    return () => {
      cancelled = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        try { ws.close(1000, 'leaving') } catch { /* ignore */ }
      }
    }
  }, [code, password])

  return { connected, send, subscribe }
}
