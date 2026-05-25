import { useCallback, useEffect, useRef, useState } from 'react'
import { getWsBase } from '../../../api/client'

/**
 * Connects to the existing /ws/meetings/{code} control WS and exposes:
 *   - `connected`: boolean
 *   - `send(payload)`: stringifies + sends
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
  const [connected, setConnected] = useState(false)

  const send = useCallback((payload) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
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
        reconnectAttemptRef.current = 0
        setConnected(true)
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
