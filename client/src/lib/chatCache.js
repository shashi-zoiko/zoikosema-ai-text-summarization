/**
 * Module-level cache for chat data. It survives in-tab navigation and mirrors
 * recent channels/messages to localStorage so production reloads can paint the
 * conversation list and the last opened thread immediately, then refresh from
 * the API in the background.
 */

const MAX_MESSAGES_PER_CHANNEL = 200
const CACHE_VERSION = 1
const CHANNELS_TTL_MS = 5 * 60 * 1000
const MESSAGES_TTL_MS = 30 * 60 * 1000

let _channels = null
const _messagesByChannel = new Map()

function storageKey(userId, suffix) {
  return userId == null ? null : `zoiko_chat_cache_v${CACHE_VERSION}_${userId}_${suffix}`
}

function readStored(key, ttlMs) {
  if (!key || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || Date.now() - parsed.ts > ttlMs) {
      localStorage.removeItem(key)
      return null
    }
    return parsed.value
  } catch {
    return null
  }
}

function writeStored(key, value) {
  if (!key || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value }))
  } catch {
    // Storage can be unavailable or full; the in-memory cache still works.
  }
}

export function getCachedChannels(userId) {
  if (_channels) return _channels
  const stored = readStored(storageKey(userId, 'channels'), CHANNELS_TTL_MS)
  if (Array.isArray(stored)) _channels = stored
  return _channels
}

export function setCachedChannels(list, userId) {
  _channels = Array.isArray(list) ? list : null
  if (_channels) writeStored(storageKey(userId, 'channels'), _channels)
}

export function getCachedMessages(channelId, userId) {
  if (channelId == null) return null
  const cid = Number(channelId)
  const memory = _messagesByChannel.get(cid)
  if (memory) return memory
  const stored = readStored(storageKey(userId, `messages_${cid}`), MESSAGES_TTL_MS)
  if (Array.isArray(stored)) {
    _messagesByChannel.set(cid, stored)
    return stored
  }
  return null
}

export function setCachedMessages(channelId, list, userId) {
  if (channelId == null || !Array.isArray(list)) return
  const trimmed = list.length > MAX_MESSAGES_PER_CHANNEL
    ? list.slice(-MAX_MESSAGES_PER_CHANNEL)
    : list
  const cid = Number(channelId)
  _messagesByChannel.set(cid, trimmed)
  writeStored(storageKey(userId, `messages_${cid}`), trimmed)
}

export function clearChatCache() {
  _channels = null
  _messagesByChannel.clear()
  if (typeof localStorage === 'undefined') return
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i)
      if (key?.startsWith(`zoiko_chat_cache_v${CACHE_VERSION}_`)) {
        localStorage.removeItem(key)
      }
    }
  } catch {}
}
