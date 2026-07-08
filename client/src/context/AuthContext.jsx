import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import {
  api,
  uploadFile,
  requestGuestToken,
  setGuestSession,
  clearGuestSession,
  getGuestSession,
  getGuestSessionForCode,
} from '../api/client'
import { clearChatCache } from '../lib/chatCache'

const AuthContext = createContext(null)

// Refresh the access token 2 minutes before it expires.
// Default token lifetime is 7 days so this fires once per ~7 days.
const REFRESH_MARGIN_MS = 2 * 60 * 1000

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // Anonymous guest session (no account). Persisted in localStorage (per
  // meeting) so a guest keeps ONE identity across refresh / tab-close / network
  // drop / accidental leave and rejoins directly without host re-approval.
  const [guest, setGuest] = useState(() => getGuestSession())
  const refreshTimerRef = useRef(null)

  // Mint a guest identity for a meeting and persist it for this tab. Returns
  // the server response (includes waiting_room_enabled) so the caller can
  // decide whether to expect the lobby.
  const joinAsGuest = useCallback(async (code, { displayName, password, captchaToken } = {}) => {
    const data = await requestGuestToken(code, { displayName, password, captchaToken })
    const session = {
      code,
      token: data.access_token,
      userId: data.user_id,
      name: data.name,
    }
    setGuestSession(session)
    setGuest(session)
    return data
  }, [])

  // Reuse a durable guest identity previously admitted to THIS meeting instead
  // of minting a new one — a new user_id would send the guest back to the
  // waiting room. Returns the session if one exists (and makes it active), else
  // null so the caller mints fresh.
  const resumeGuest = useCallback((code) => {
    const s = getGuestSessionForCode(code)
    if (s?.token) {
      setGuestSession(s) // re-assert as the active token for transports
      setGuest(s)
      return s
    }
    return null
  }, [])

  const clearGuest = useCallback((code) => {
    clearGuestSession(code)
    setGuest(null)
  }, [])

  const scheduleRefresh = useCallback((expiresInMs) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    const delay = Math.max(expiresInMs - REFRESH_MARGIN_MS, 30_000)
    refreshTimerRef.current = setTimeout(async () => {
      const rt = localStorage.getItem('zoiko_refresh')
      if (!rt) return
      try {
        const data = await api('/api/auth/refresh', {
          method: 'POST',
          auth: false,
          body: { refresh_token: rt },
        })
        localStorage.setItem('zoiko_token', data.access_token)
        if (data.refresh_token) localStorage.setItem('zoiko_refresh', data.refresh_token)
        setUser(data.user)
        // Re-schedule for the new token
        scheduleRefresh(7 * 24 * 60 * 60 * 1000)
      } catch {
        // Refresh failed — force re-login
        localStorage.removeItem('zoiko_token')
        localStorage.removeItem('zoiko_refresh')
        setUser(null)
      }
    }, delay)
  }, [])

  const refresh = useCallback(async () => {
    const token = localStorage.getItem('zoiko_token')
    if (!token) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const me = await api('/api/auth/me')
      setUser(me)
      // Schedule token refresh
      scheduleRefresh(7 * 24 * 60 * 60 * 1000)
    } catch {
      // Try refresh token before giving up
      const rt = localStorage.getItem('zoiko_refresh')
      if (rt) {
        try {
          const data = await api('/api/auth/refresh', {
            method: 'POST',
            auth: false,
            body: { refresh_token: rt },
          })
          localStorage.setItem('zoiko_token', data.access_token)
          if (data.refresh_token) localStorage.setItem('zoiko_refresh', data.refresh_token)
          setUser(data.user)
          scheduleRefresh(7 * 24 * 60 * 60 * 1000)
        } catch {
          localStorage.removeItem('zoiko_token')
          localStorage.removeItem('zoiko_refresh')
          setUser(null)
        }
      } else {
        localStorage.removeItem('zoiko_token')
        setUser(null)
      }
    } finally {
      setLoading(false)
    }
  }, [scheduleRefresh])

  useEffect(() => {
    refresh()
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current) }
  }, [refresh])

  const login = useCallback(async (email, password) => {
    const data = await api('/api/auth/login', {
      method: 'POST',
      auth: false,
      form: { username: email, password },
    })
    localStorage.setItem('zoiko_token', data.access_token)
    if (data.refresh_token) localStorage.setItem('zoiko_refresh', data.refresh_token)
    setUser(data.user)
    scheduleRefresh(7 * 24 * 60 * 60 * 1000)
    return data.user
  }, [scheduleRefresh])

  const register = useCallback(async (email, name, password, organization) => {
    const data = await api('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: { email, name, password, organization: organization || null },
    })
    localStorage.setItem('zoiko_token', data.access_token)
    if (data.refresh_token) localStorage.setItem('zoiko_refresh', data.refresh_token)
    setUser(data.user)
    scheduleRefresh(7 * 24 * 60 * 60 * 1000)
    return data.user
  }, [scheduleRefresh])

  const logout = useCallback(async () => {
    // Server-side blacklist of the current access token
    try { await api('/api/auth/logout', { method: 'POST' }) } catch {}
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    localStorage.removeItem('zoiko_token')
    localStorage.removeItem('zoiko_refresh')
    // Drop the module-level chat cache so the next user (in case of
    // shared device) doesn't see the previous user's channels/messages.
    clearChatCache()
    setUser(null)
  }, [])

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    return api('/api/auth/change-password', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    })
  }, [])

  const updateProfile = useCallback(async (updates) => {
    const updated = await api('/api/auth/profile', {
      method: 'PATCH',
      body: updates,
    })
    setUser(updated)
    return updated
  }, [])

  const uploadAvatar = useCallback(async (file) => {
    const updated = await uploadFile('/api/auth/avatar', file)
    setUser(updated)
    return updated
  }, [])

  const removeAvatar = useCallback(async () => {
    const updated = await api('/api/auth/avatar', { method: 'DELETE' })
    setUser(updated)
    return updated
  }, [])

  const deleteAccount = useCallback(async () => {
    await api('/api/auth/account', { method: 'DELETE' })
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    localStorage.removeItem('zoiko_token')
    localStorage.removeItem('zoiko_refresh')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{
      user, loading, login, register, logout, refresh,
      changePassword, updateProfile, uploadAvatar, removeAvatar, deleteAccount,
      // Guest session: `guest` is the active anonymous session (or null);
      // isGuest is true only when there's a guest session AND no real account.
      guest, isGuest: !!guest && !user, joinAsGuest, resumeGuest, clearGuest,
    }}>{children}</AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
