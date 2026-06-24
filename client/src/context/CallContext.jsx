import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, getWsBase } from '../api/client'
import { useAuth } from './AuthContext'

const CallContext = createContext(null)

export function CallProvider({ children }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const wsRef = useRef(null)
  const [incoming, setIncoming] = useState(null)
  const [outgoing, setOutgoing] = useState(null)

  const enterCall = useCallback((meeting_code, kind) => {
    try {
      sessionStorage.setItem(
        `zoiko_meet_prefs_${meeting_code}`,
        JSON.stringify({ audio: true, video: kind === 'video' })
      )
    } catch {}
    navigate(`/meet/${meeting_code}/room-lk`)
  }, [navigate])

  useEffect(() => {
    if (!user) {
      if (wsRef.current) { try { wsRef.current.close() } catch {}; wsRef.current = null }
      return
    }
    const token = localStorage.getItem('zoiko_token')
    if (!token) return

    const ws = new WebSocket(`${getWsBase()}/ws/notifications?token=${encodeURIComponent(token)}`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      let data
      try { data = JSON.parse(e.data) } catch { return }

      if (data.type === 'call-invite') {
        setIncoming({
          call_id: data.call_id,
          meeting_code: data.meeting_code,
          kind: data.kind,
          caller: data.caller,
        })
      } else if (data.type === 'call-response') {
        setOutgoing((prev) => {
          if (!prev || prev.call_id !== data.call_id) return prev
          if (data.accepted) {
            enterCall(data.meeting_code, data.kind)
            return null
          }
          return { ...prev, declined: true }
        })
      } else if (data.type === 'call-cancelled') {
        setIncoming((prev) => (prev && prev.call_id === data.call_id ? null : prev))
      }
    }

    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
    }, 30000)

    return () => {
      clearInterval(keepalive)
      try { ws.close() } catch {}
      wsRef.current = null
    }
  }, [user, enterCall])

  // Auto-dismiss declined-state card after a few seconds.
  useEffect(() => {
    if (!outgoing?.declined) return
    const t = setTimeout(() => setOutgoing(null), 3000)
    return () => clearTimeout(t)
  }, [outgoing?.declined])

  const startCall = useCallback(async (callee, kind = 'video') => {
    try {
      const data = await api('/api/calls/invite', {
        method: 'POST',
        body: { callee_user_id: callee.id, kind },
      })
      setOutgoing({
        call_id: data.call_id,
        meeting_code: data.meeting_code,
        kind: data.kind,
        callee: { id: callee.id, name: callee.name, avatar_color: callee.avatar_color },
        declined: false,
      })
    } catch (e) {
      alert(e.message || 'Could not place call')
    }
  }, [])

  const cancelOutgoing = useCallback(async () => {
    const cur = outgoing
    if (!cur) return
    setOutgoing(null)
    if (!cur.declined) {
      try { await api(`/api/calls/${cur.call_id}/cancel`, { method: 'POST' }) } catch {}
    }
  }, [outgoing])

  const acceptIncoming = useCallback(async () => {
    const cur = incoming
    if (!cur) return
    setIncoming(null)
    try {
      await api(`/api/calls/${cur.call_id}/respond`, {
        method: 'POST',
        body: { accepted: true },
      })
      enterCall(cur.meeting_code, cur.kind)
    } catch (e) {
      alert(e.message || 'Could not accept call')
    }
  }, [incoming, enterCall])

  const declineIncoming = useCallback(async () => {
    const cur = incoming
    if (!cur) return
    setIncoming(null)
    try {
      await api(`/api/calls/${cur.call_id}/respond`, {
        method: 'POST',
        body: { accepted: false },
      })
    } catch {}
  }, [incoming])

  return (
    <CallContext.Provider value={{
      incoming, outgoing,
      startCall, cancelOutgoing, acceptIncoming, declineIncoming,
    }}>
      {children}
    </CallContext.Provider>
  )
}

export function useCall() {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCall must be used within CallProvider')
  return ctx
}
