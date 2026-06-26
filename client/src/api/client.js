const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export function getApiBase() {
  return API_BASE
}

export function getWsBase() {
  if (!API_BASE) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}`
  }
  try {
    const u = new URL(API_BASE)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return u.toString().replace(/\/$/, '')
  } catch {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}`
  }
}

// ── Guest (anonymous) session ───────────────────────────────────────────────
// A guest has no account; their short-lived JWT lives in sessionStorage (scoped
// to the tab, cleared when it closes) keyed alongside the meeting code it was
// minted for. localStorage('zoiko_token') always wins so a signed-in user is
// never treated as a guest.
const GUEST_TOKEN_KEY = 'zoiko_guest_token'
const GUEST_SESSION_KEY = 'zoiko_guest_session'

export function getGuestSession() {
  try {
    const raw = sessionStorage.getItem(GUEST_SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setGuestSession(session) {
  // session: { code, token, userId, name }
  sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  sessionStorage.setItem(GUEST_TOKEN_KEY, session.token)
}

export function clearGuestSession() {
  sessionStorage.removeItem(GUEST_SESSION_KEY)
  sessionStorage.removeItem(GUEST_TOKEN_KEY)
}

/**
 * The bearer token for the current session: a signed-in user's localStorage
 * token always wins; otherwise fall back to the anonymous guest token in
 * sessionStorage. Exported so every transport (REST, WebSocket, SSE) resolves
 * the token identically — the control WS once read localStorage only, which
 * silently broke chat/reactions/raise-hand for guests (empty token → server
 * 4401 → no reconnect).
 */
export function getAuthToken() {
  return localStorage.getItem('zoiko_token') || sessionStorage.getItem(GUEST_TOKEN_KEY) || ''
}

function token() {
  return getAuthToken()
}

export async function api(path, { method = 'GET', body, form, auth = true } = {}) {
  const headers = {}
  if (auth && token()) headers['Authorization'] = `Bearer ${token()}`
  let payload
  if (form) {
    payload = new URLSearchParams(form)
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  } else if (body !== undefined) {
    payload = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const data = await res.json()
      detail = data.detail || JSON.stringify(data)
    } catch {}
    throw new Error(detail)
  }
  if (res.status === 204) return null
  return res.json()
}

// ── Guest meeting endpoints (unauthenticated) ───────────────────────────────

/** Public meeting metadata for the guest pre-join screen (no auth). */
export async function fetchPublicMeeting(code) {
  return api(`/api/meetings/${code}/public`, { auth: false })
}

/** Mint an anonymous guest identity + token for a meeting (no auth). */
export async function requestGuestToken(code, { displayName, password, captchaToken } = {}) {
  return api(`/api/meetings/${code}/guest-token`, {
    method: 'POST',
    auth: false,
    body: { display_name: displayName, password, captcha_token: captchaToken },
  })
}

export async function uploadFile(path, file) {
  const headers = {}
  const t = token()
  if (t) headers['Authorization'] = `Bearer ${t}`
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: fd })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const data = await res.json()
      detail = data.detail || JSON.stringify(data)
    } catch {}
    throw new Error(detail)
  }
  return res.json()
}
