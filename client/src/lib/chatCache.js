/**
 * Module-level cache for chat data — survives in-tab navigation (e.g.
 * Chat → Meet → Chat) but resets on full reload. Pages render from cache
 * instantly on mount and then refetch in background; once the refetch
 * lands, it overwrites the cache and the visible list updates.
 *
 * Why not React context? The cache is only ever read/written by the Chat
 * page; a context provider higher up the tree would re-render the entire
 * app whenever a message arrived. Module state has the same lifecycle
 * (tab lifetime) without the render fan-out.
 *
 * Cap on per-channel message buffer keeps memory bounded for long-running
 * sessions. The visible list re-fetches whenever the user opens a channel
 * anyway, so older cached messages aren't load-bearing.
 */

const MAX_MESSAGES_PER_CHANNEL = 200

let _channels = null                  // ChannelOut[] | null
const _messagesByChannel = new Map()  // channelId -> MessageOut[]

export function getCachedChannels() {
  return _channels
}

export function setCachedChannels(list) {
  _channels = Array.isArray(list) ? list : null
}

export function getCachedMessages(channelId) {
  if (channelId == null) return null
  return _messagesByChannel.get(Number(channelId)) || null
}

export function setCachedMessages(channelId, list) {
  if (channelId == null || !Array.isArray(list)) return
  // Keep only the tail so very long histories don't pin memory.
  const trimmed = list.length > MAX_MESSAGES_PER_CHANNEL
    ? list.slice(-MAX_MESSAGES_PER_CHANNEL)
    : list
  _messagesByChannel.set(Number(channelId), trimmed)
}

/** Drop everything — used on logout. */
export function clearChatCache() {
  _channels = null
  _messagesByChannel.clear()
}
