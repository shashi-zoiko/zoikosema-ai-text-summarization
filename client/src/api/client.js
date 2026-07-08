const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export function getApiBase() {
  return API_BASE
}

/** Resolve a server-relative upload path (e.g. /api/uploads/x.png) against the
 *  API base. Passes absolute/external URLs and empty values through unchanged. */
export function assetUrl(path) {
  if (!path || /^https?:\/\//.test(path)) return path
  return `${API_BASE}${path}`
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
// A guest has no account; their short-lived JWT + user_id live in localStorage
// (NOT sessionStorage) keyed by meeting code, so an admitted guest keeps ONE
// identity across refresh, tab-close, network drop and accidental leave. That's
// what lets them rejoin directly — a fresh identity every time would force the
// host to re-admit (Google-Meet rejoin behaviour). localStorage('zoiko_token')
// always wins so a signed-in user is never treated as a guest. Stale entries
// self-heal: once the meeting ends the guest row is purged server-side, the
// token 401/410s, and the client mints a fresh identity (new approval).
const GUEST_TOKEN_KEY = 'zoiko_guest_token'      // active token (transports)
const GUEST_SESSION_KEY = 'zoiko_guest_session'  // active session (AuthContext init)
const GUEST_SESSIONS_KEY = 'zoiko_guest_sessions' // durable { [code]: session } map

function _readGuestMap() {
  try { return JSON.parse(localStorage.getItem(GUEST_SESSIONS_KEY)) || {} } catch { return {} }
}
function _writeGuestMap(m) {
  try { localStorage.setItem(GUEST_SESSIONS_KEY, JSON.stringify(m)) } catch { /* private mode */ }
}

export function getGuestSession() {
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Durable guest identity previously minted for THIS meeting, if any. Used to
 *  rejoin with the same user_id instead of minting a new one. */
export function getGuestSessionForCode(code) {
  return _readGuestMap()[code] || null
}

export function setGuestSession(session) {
  // session: { code, token, userId, name }
  localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  localStorage.setItem(GUEST_TOKEN_KEY, session.token)
  if (session.code) {
    const m = _readGuestMap()
    m[session.code] = session
    _writeGuestMap(m)
  }
}

export function clearGuestSession(code) {
  localStorage.removeItem(GUEST_SESSION_KEY)
  localStorage.removeItem(GUEST_TOKEN_KEY)
  if (code) {
    const m = _readGuestMap()
    delete m[code]
    _writeGuestMap(m)
  }
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
  return localStorage.getItem('zoiko_token') || localStorage.getItem(GUEST_TOKEN_KEY) || ''
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

// ── Password reset (forgot-password OTP flow, all unauthenticated) ───────────

/** Step 1 — request a reset code. Always resolves generically (no account
 *  enumeration); the email only sends if the account exists. */
export async function requestPasswordReset(email) {
  return api('/api/auth/forgot-password', {
    method: 'POST',
    auth: false,
    body: { email },
  })
}

/** Step 2 — verify the 4-digit OTP. Returns { reset_token } on success. */
export async function verifyResetOtp(email, otp) {
  return api('/api/auth/verify-otp', {
    method: 'POST',
    auth: false,
    body: { email, otp },
  })
}

/** Step 3 — set the new password using the one-time reset_token from step 2. */
export async function resetPassword(email, resetToken, newPassword) {
  return api('/api/auth/reset-password', {
    method: 'POST',
    auth: false,
    body: { email, reset_token: resetToken, new_password: newPassword },
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
