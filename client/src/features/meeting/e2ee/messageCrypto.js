// End-to-end message crypto for in-call chat and live captions.
//
// The SFU (media) is encrypted separately by LiveKit's insertable-stream E2EE.
// This module covers the *text* channels — chat over the control WebSocket and
// captions over the LiveKit data channel — so the app server and SFU relay only
// opaque ciphertext they cannot read.
//
// Key: the per-meeting 32-byte key returned by /media-token (base64). Every
// participant derives the same value server-side, so no key material is ever
// broadcast between clients. We import it as a non-extractable AES-GCM key.
//
// Envelope: "zk1:" + base64(iv) + "." + base64(ciphertext). The 12-byte IV is
// random per message (required for AES-GCM). The prefix lets the receiver tell
// an encrypted payload from a legacy/plaintext one and fail safe.

const enc = new TextEncoder()
const dec = new TextDecoder()
const PREFIX = 'zk1:'

function bytesToBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function base64ToBytes(b64) {
  const s = atob(b64)
  const a = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i)
  return a
}

/** True if this looks like one of our encrypted envelopes. */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

/**
 * Import the base64 per-meeting key as a non-extractable AES-GCM CryptoKey.
 * @param {string} b64  32-byte key, base64-encoded (from /media-token).
 * @returns {Promise<CryptoKey>}
 */
export function importMessageKey(b64) {
  return crypto.subtle.importKey('raw', base64ToBytes(b64), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Encrypt a UTF-8 string into a self-describing envelope.
 * @param {CryptoKey} key
 * @param {string} plaintext
 * @returns {Promise<string>} "zk1:<iv>.<ct>"
 */
export async function encryptMessage(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(plaintext))),
  )
  return PREFIX + bytesToBase64(iv) + '.' + bytesToBase64(ct)
}

/**
 * Decrypt an envelope produced by encryptMessage. Non-envelope input is passed
 * through unchanged (defensive: a peer on an older build, or a relay glitch,
 * shouldn't blank the UI). Returns null only when a real envelope fails to
 * decrypt (wrong key / tampered) so callers can drop it.
 * @param {CryptoKey} key
 * @param {string} envelope
 * @returns {Promise<string|null>}
 */
export async function decryptMessage(key, envelope) {
  if (!isEncrypted(envelope)) return typeof envelope === 'string' ? envelope : ''
  const dot = envelope.indexOf('.', PREFIX.length)
  if (dot < 0) return null
  try {
    const iv = base64ToBytes(envelope.slice(PREFIX.length, dot))
    const ct = base64ToBytes(envelope.slice(dot + 1))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
    return dec.decode(pt)
  } catch {
    return null
  }
}

/**
 * Whether this browser can do LiveKit media E2EE (insertable streams via
 * RTCRtpSender.createEncodedStreams, or Safari's RTCRtpScriptTransform). Text
 * crypto (WebCrypto) is ubiquitous; this gates only the media plane.
 */
export function mediaE2EESupported() {
  if (typeof window === 'undefined') return false
  const hasInsertable =
    typeof RTCRtpSender !== 'undefined' &&
    typeof RTCRtpSender.prototype?.createEncodedStreams === 'function'
  const hasScriptTransform = typeof window.RTCRtpScriptTransform === 'function'
  return hasInsertable || hasScriptTransform
}
