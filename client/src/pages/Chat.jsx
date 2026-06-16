import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, getApiBase, getWsBase, uploadFile } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useCall } from '../context/CallContext'
import Avatar from '../components/Avatar'
import Icon from '../components/Icon'
import { cn } from '../lib/cn'
import {
  getCachedChannels, setCachedChannels,
  getCachedMessages, setCachedMessages,
} from '../lib/chatCache'

/* ─────────────────────────────────────────────────────────────────────────
 * Chat — fully Tailwind. The hand-written Chat.css that used to drive this
 * page is gone; everything now reads off the design-token utilities exposed
 * by index.css (bg-surface / text-fg / border-line / etc.) so dark and
 * light themes track automatically.
 *
 * Logic is unchanged from the previous version: WebSocket-driven send
 * with optimistic reconciliation, SWR cache for channel/message lists,
 * mention autocomplete + AI smart replies, voice notes, file uploads.
 * ──────────────────────────────────────────────────────────────────────── */

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👏']

// Page size for history fetches; must match what the API treats as "a full
// page" so `length >= PAGE_SIZE` is a reliable has-more signal.
const PAGE_SIZE = 50
const SEND_RETRY_LIMIT = 2

// Upper bound on messages kept in React state so a long-lived/active thread
// can't grow the DOM without limit. Only trimmed from the top when the user is
// pinned to the bottom (not reading history), so it never yanks content out
// from under someone scrolled up. A resync/refetch naturally resets to a page.
const MAX_RENDERED_MESSAGES = 300

// Keep at most the newest N messages. Used on append paths only.
function capTail(list) {
  return list.length > MAX_RENDERED_MESSAGES
    ? list.slice(list.length - MAX_RENDERED_MESSAGES)
    : list
}

// Categorized emoji set for the full picker
const EMOJI_CATEGORIES = [
  {
    key: 'smileys', icon: '😀', label: 'Smileys & People',
    emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','🫠','😉','😊','😇','🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🫣','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😶‍🌫️','😏','😒','🙄','😬','😮‍💨','🤥','🫨','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','😵‍💫','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','☹️','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾']
  },
  {
    key: 'gestures', icon: '👍', label: 'Gestures & Body',
    emojis: ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','🫦','💋','👶','🧒','👦','👧','🧑','👱','👨','👩','🧓','👴','👵']
  },
  {
    key: 'hearts', icon: '❤️', label: 'Hearts & Emotions',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💖','💗','💓','💞','💕','💘','💝','💟','♥️','💌','💯','💢','💥','💫','💦','💨','🕳️','💣','💬','👁️‍🗨️','🗨️','🗯️','💭','💤']
  },
  {
    key: 'animals', icon: '🐶', label: 'Animals & Nature',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🪶','🐓','🦃','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔','🌵','🎄','🌲','🌳','🌴','🪵','🌱','🌿','☘️','🍀','🎍','🎋','🍃','🍂','🍁','🍄','🐚','🪨','🌾','💐','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝','🌛','🌜','🌚','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌙','🌎','🌍','🌏','🪐','💫','⭐','🌟','✨','⚡','☄️','💥','🔥','🌪️','🌈','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','💧','💦','☔','☂️','🌊','🌫️']
  },
  {
    key: 'food', icon: '🍔', label: 'Food & Drink',
    emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','🫖','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽️','🥣','🥡','🥢','🧂']
  },
  {
    key: 'activities', icon: '⚽', label: 'Activities & Travel',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🚴','🚵','🎖️','🏅','🥇','🥈','🥉','🏆','🎗️','🎫','🎟️','🎪','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🎰','🧩','🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','⛽','🚧','🚦','🚥','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛱️','🏖️','🏝️','🏜️','🌋','⛰️','🏔️','🗻','🏕️','⛺','🏠','🏡','🏘️','🏚️','🏗️','🏭','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛️','⛪','🕌','🕍','🛕','🕋','⛩️']
  },
  {
    key: 'objects', icon: '💡', label: 'Objects',
    emojis: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','🧿','🪬','💈','⚗️','🔭','🔬','🕳️','🩸','💊','🩹','🩼','🩺','🩻','🚪','🛗','🪞','🪟','🛏️','🛋️','🪑','🚽','🪠','🚿','🛁','🪤','🪒','🧴','🧷','🧹','🧺','🧻','🪣','🧼','🫧','🪥','🧽','🧯','🛒','🚬','⚰️','🪦','⚱️']
  },
  {
    key: 'symbols', icon: '✅', label: 'Symbols',
    emojis: ['✅','❌','❎','✔️','☑️','✖️','➕','➖','➗','🟰','♾️','‼️','⁉️','❓','❔','❕','❗','〰️','©️','®️','™️','#️⃣','*️⃣','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔠','🔡','🔢','🔣','🔤','🅰️','🆎','🅱️','🆑','🆒','🆓','ℹ️','🆔','Ⓜ️','🆕','🆖','🅾️','🆗','🅿️','🆘','🆙','🆚','🈁','🈂️','🈷️','🈶','🈯','🉐','🈹','🈚','🈲','🉑','🈸','🈴','🈳','㊗️','㊙️','🈺','🈵','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺','🔻','💠','🔘','🔳','🔲','⬛','⬜','🟥','🟧','🟨','🟩','🟦','🟪','🟫','▪️','▫️','◾','◽','◼️','◻️','🚫','⭕','🛑','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❓','❕','❔']
  },
  {
    key: 'flags', icon: '🏁', label: 'Flags',
    emojis: ['🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️','🇺🇸','🇬🇧','🇨🇦','🇦🇺','🇮🇳','🇯🇵','🇰🇷','🇨🇳','🇩🇪','🇫🇷','🇮🇹','🇪🇸','🇵🇹','🇳🇱','🇧🇪','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇮🇪','🇵🇱','🇨🇭','🇦🇹','🇬🇷','🇹🇷','🇷🇺','🇺🇦','🇧🇷','🇲🇽','🇦🇷','🇨🇱','🇨🇴','🇵🇪','🇿🇦','🇪🇬','🇳🇬','🇰🇪','🇦🇪','🇸🇦','🇮🇱','🇸🇬','🇲🇾','🇮🇩','🇹🇭','🇵🇭','🇻🇳','🇳🇿','🇵🇰','🇧🇩','🇱🇰','🇳🇵']
  },
]

function formatTime(iso) {
  try {
    const d = new Date(iso)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

function dayLabel(iso) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const yest = new Date(now)
    yest.setDate(yest.getDate() - 1)
    if (d.toDateString() === now.toDateString()) return 'Today'
    if (d.toDateString() === yest.toDateString()) return 'Yesterday'
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  } catch {
    return ''
  }
}

function channelDisplay(channel, currentUserId) {
  if (channel.is_direct) {
    const other = channel.members.find((m) => m.id !== currentUserId)
    return { name: other?.name || channel.name, color: other?.avatar_color || '#5b8def' }
  }
  return { name: channel.name, color: '#7c8cff' }
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isImageType(type) {
  return type && type.startsWith('image/')
}

// Render a message body with @<handle> tokens highlighted as mention chips.
// `mentionsMe` flips a strong style for spans matching the current user.
const MENTION_RE = /(^|\s)@([\w.-]{1,80})/g
function renderBodyWithMentions(body, currentUserHandle) {
  if (!body) return null
  const out = []
  let last = 0
  let m
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(body)) !== null) {
    const start = m.index + m[1].length
    if (start > last) out.push(body.slice(last, start))
    const isMe = currentUserHandle && m[2].toLowerCase() === currentUserHandle
    out.push(
      <span
        key={`mn-${start}`}
        className={cn(
          'rounded-md px-1.5 py-px font-semibold',
          isMe
            ? 'bg-warn-soft text-warn'
            : 'bg-accent-soft text-accent'
        )}
      >
        {'@' + m[2]}
      </span>
    )
    last = start + 1 + m[2].length
  }
  if (last < body.length) out.push(body.slice(last))
  return out.length ? out : body
}

function groupMessages(messages) {
  const groups = []
  let currentDay = null
  let currentCluster = null
  for (const m of messages) {
    const day = new Date(m.created_at).toDateString()
    if (day !== currentDay) {
      currentDay = day
      groups.push({ type: 'divider', id: `d-${day}`, date: m.created_at })
      currentCluster = null
    }
    const lastCluster = currentCluster
    const sameAuthor = lastCluster && lastCluster.sender_id === m.sender_id
    const closeInTime =
      lastCluster &&
      new Date(m.created_at) - new Date(lastCluster.messages[lastCluster.messages.length - 1].created_at) < 3 * 60 * 1000
    if (sameAuthor && closeInTime) {
      lastCluster.messages.push(m)
    } else {
      const cluster = {
        type: 'cluster',
        id: `c-${m.id}`,
        sender_id: m.sender_id,
        sender_name: m.sender_name,
        sender_color: m.sender_color,
        messages: [m],
      }
      groups.push(cluster)
      currentCluster = cluster
    }
  }
  return groups
}

export default function Chat() {
  const { channelId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { startCall } = useCall()

  const [channels, setChannels] = useState(() => getCachedChannels(user?.id) || [])
  const [messages, setMessages] = useState([])
  const [activeChannel, setActiveChannel] = useState(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messagesError, setMessagesError] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [wsStatus, setWsStatus] = useState('connecting') // connecting | open | closed
  const [draft, setDraft] = useState('')
  const [typingUsers, setTypingUsers] = useState({})
  const [showNew, setShowNew] = useState(false)
  const [search, setSearch] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [emojiPicker, setEmojiPicker] = useState(null)
  const [readReceipts, setReadReceipts] = useState({})
  const [uploading, setUploading] = useState(false)
  const [showComposerEmoji, setShowComposerEmoji] = useState(false)
  const [emojiTab, setEmojiTab] = useState('smileys')
  const [isRecording, setIsRecording] = useState(false)
  const [recTime, setRecTime] = useState(0)
  const [mentionState, setMentionState] = useState(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [smartReplies, setSmartReplies] = useState([])
  const [smartLoading, setSmartLoading] = useState(false)

  const wsRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const reconnectAttemptsRef = useRef(0)
  const lastReadSentRef = useRef({})
  const messagesEndRef = useRef(null)
  const scrollContainerRef = useRef(null)
  const shouldAutoScrollRef = useRef(true)
  const firstScrollRef = useRef(true)
  const loadMessagesRef = useRef(null)
  const messagesRef = useRef(messages)
  const composerRef = useRef(null)
  const fileInputRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const recordedChunksRef = useRef([])
  const recTimerRef = useRef(null)
  const recStreamRef = useRef(null)
  const cancelRecRef = useRef(false)

  const loadChannels = useCallback(async () => {
    const list = await api('/api/channels')
    const normalized = channelId
      ? list.map((c) => String(c.id) === String(channelId) ? { ...c, unread_count: 0 } : c)
      : list
    setChannels(normalized)
    setCachedChannels(normalized, user?.id)
    return normalized
  }, [channelId, user?.id])

  useEffect(() => { loadChannels().catch(() => {}) }, [loadChannels])

  useEffect(() => {
    if (!channelId) { setActiveChannel(null); setMessages([]); return }
    setChannels((prev) => {
      let changed = false
      const next = prev.map((c) => {
        if (String(c.id) !== String(channelId) || !c.unread_count) return c
        changed = true
        return { ...c, unread_count: 0 }
      })
      return changed ? next : prev
    })
    const ch = channels.find((c) => String(c.id) === String(channelId))
    if (ch) {
      setActiveChannel({ ...ch, unread_count: 0 })
    } else {
      // Deep-link / refresh: the channel list hasn't resolved yet (or this
      // channel isn't in it). Synthesise a minimal placeholder so the thread —
      // and the already-fetched message history — renders immediately instead
      // of being hidden behind the "Start a conversation" empty state. Real
      // metadata replaces this the moment /api/channels returns.
      setActiveChannel((prev) =>
        prev && String(prev.id) === String(channelId)
          ? prev
          : {
              id: Number(channelId),
              name: 'Conversation',
              is_direct: false,
              members: [],
              created_by: null,
              created_at: new Date().toISOString(),
              unread_count: 0,
            }
      )
    }
  }, [channelId, channels])

  // Latest page of history. Replaces the persisted set while preserving any
  // still-unsettled optimistic bubbles, so a background resync can never drop a
  // message the user is mid-send. `silent` skips the skeleton (used when we
  // already painted from cache — classic stale-while-revalidate).
  const loadMessages = useCallback(async ({ silent = false } = {}) => {
    if (!channelId) return
    if (!silent) { setLoadingMessages(true); setMessagesError(null) }
    try {
      const msgs = await api(`/api/channels/${channelId}/messages?limit=${PAGE_SIZE}`)
      setHasMore(msgs.length >= PAGE_SIZE)
      setMessages((prev) => {
        const pendingLocal = prev.filter((m) => m._tmp_id && (m._pending || m._failed))
        const serverIds = new Set(msgs.map((m) => m.id))
        const keptLocal = pendingLocal.filter((m) => !serverIds.has(m.id))
        return keptLocal.length ? [...msgs, ...keptLocal] : msgs
      })
      setCachedMessages(channelId, msgs, user?.id)
      setMessagesError(null)
    } catch (err) {
      // Keep whatever we already have (cache); only surface a blocking error
      // when there's nothing to show, so a transient blip never blanks history.
      setMessages((prev) => {
        if (!prev.length) setMessagesError(err?.message || 'Could not load messages')
        return prev
      })
    } finally {
      if (!silent) setLoadingMessages(false)
    }
  }, [channelId, user?.id])

  useEffect(() => { loadMessagesRef.current = loadMessages }, [loadMessages])
  // Mirror messages into a ref so memoized children's click handlers always read
  // the freshest list even when the bubble itself skipped a re-render.
  useEffect(() => { messagesRef.current = messages }, [messages])

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || !channelId) return
    const firstReal = messages.find((m) => typeof m.id === 'number')
    if (!firstReal) return
    setLoadingOlder(true)
    const el = scrollContainerRef.current
    const prevHeight = el ? el.scrollHeight : 0
    const prevTop = el ? el.scrollTop : 0
    try {
      const older = await api(
        `/api/channels/${channelId}/messages?before_id=${firstReal.id}&limit=${PAGE_SIZE}`
      )
      setHasMore(older.length >= PAGE_SIZE)
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id))
        const fresh = older.filter((m) => !ids.has(m.id))
        return fresh.length ? [...fresh, ...prev] : prev
      })
      // Preserve the viewport: keep the row the user was reading in place
      // instead of yanking the scroll position when we prepend older messages.
      requestAnimationFrame(() => {
        const el2 = scrollContainerRef.current
        if (el2) el2.scrollTop = el2.scrollHeight - prevHeight + prevTop
      })
    } catch {
      // Non-fatal — the user can trigger another fetch by scrolling up again.
    } finally {
      setLoadingOlder(false)
    }
  }, [loadingOlder, hasMore, channelId, messages])

  useEffect(() => {
    if (!channelId) { setMessages([]); setHasMore(false); setMessagesError(null); return }
    const cached = getCachedMessages(channelId, user?.id)
    setMessages(cached || [])
    setMessagesError(null)
    firstScrollRef.current = true
    shouldAutoScrollRef.current = true
    loadMessages({ silent: Boolean(cached && cached.length) })

    let cancelled = false
    api(`/api/channels/${channelId}/read-receipts`)
      .then((receipts) => {
        if (cancelled) return
        const map = {}
        for (const r of receipts) map[r.user_id] = r.last_read_message_id
        setReadReceipts(map)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [channelId, user?.id, loadMessages])

  // Stable handler for inbound WS frames — defined once and reused across
  // reconnects so re-subscribing doesn't churn the socket. All state updates go
  // through functional setState so the handler never needs to be re-created when
  // messages/channels change.
  const handleWsMessage = useCallback((e) => {
    let data
    try { data = JSON.parse(e.data) } catch { return }
    if (data.type === 'message') {
      const incoming = data.message
      if (!incoming || incoming.id == null) return
      setMessages((prev) => {
        // Reconcile an optimistic bubble by client_id…
        if (incoming.client_id) {
          const idx = prev.findIndex((m) => m._tmp_id === incoming.client_id)
          if (idx >= 0) {
            const next = prev.slice()
            next[idx] = incoming
            return next
          }
        }
        // …otherwise de-dupe by real id (covers the REST round-trip having
        // already inserted this exact row).
        if (prev.some((m) => m.id === incoming.id)) return prev
        const next = [...prev, incoming]
        // Bound growth only when the reader is at the bottom — never trim
        // history out from under someone scrolled up.
        return shouldAutoScrollRef.current ? capTail(next) : next
      })
      setChannels((prev) =>
        prev.map((c) =>
          c.id === incoming.channel_id
            ? {
                ...c,
                last_message_preview: (incoming.body || '').slice(0, 120),
                last_message_at: incoming.created_at,
                unread_count: 0,
              }
            : c
        )
      )
    } else if (data.type === 'typing') {
      setTypingUsers((prev) => ({ ...prev, [data.user_id]: { name: data.name, at: Date.now() } }))
    } else if (data.type === 'reaction') {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== data.message_id) return m
          let reactions = [...(m.reactions || [])]
          if (data.action === 'added') {
            if (!reactions.some((r) => r.emoji === data.emoji && r.user_id === data.user_id)) {
              reactions.push({ emoji: data.emoji, user_id: data.user_id, user_name: data.user_name })
            }
          } else {
            reactions = reactions.filter((r) => !(r.emoji === data.emoji && r.user_id === data.user_id))
          }
          return { ...m, reactions }
        })
      )
    } else if (data.type === 'message_deleted') {
      setMessages((prev) =>
        prev.map((m) => m.id === data.message_id ? { ...m, deleted_at: new Date().toISOString() } : m)
      )
    } else if (data.type === 'read_receipt') {
      setReadReceipts((prev) => ({ ...prev, [data.user_id]: data.last_read_message_id }))
    }
  }, [])

  // WebSocket connection with auto-reconnect + exponential backoff. The socket
  // is now used purely to *receive* real-time events — sending goes over REST
  // (see deliverMessage) so a dropped/idle socket can never block the composer.
  useEffect(() => {
    if (!channelId) { setWsStatus('closed'); return }
    let stopped = false

    const clearReconnect = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const scheduleReconnect = () => {
      if (stopped) return
      clearReconnect()
      const attempt = reconnectAttemptsRef.current++
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 15000)
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    const connect = () => {
      if (stopped) return
      const token = localStorage.getItem('zoiko_token')
      if (!token) { setWsStatus('closed'); return }
      if (wsRef.current) { try { wsRef.current.close() } catch {} }
      setWsStatus('connecting')
      let ws
      try {
        ws = new WebSocket(`${getWsBase()}/ws/channels/${channelId}?token=${encodeURIComponent(token)}`)
      } catch {
        scheduleReconnect()
        return
      }
      wsRef.current = ws
      ws.onopen = () => {
        if (stopped) { try { ws.close() } catch {}; return }
        const wasReconnect = reconnectAttemptsRef.current > 0
        reconnectAttemptsRef.current = 0
        setWsStatus('open')
        // After any gap in the socket we may have missed live frames — pull the
        // latest page so the thread is whole again. Silent: no skeleton flash.
        if (wasReconnect) loadMessagesRef.current?.({ silent: true })
      }
      ws.onmessage = handleWsMessage
      ws.onerror = () => { /* surfaced via onclose; nothing actionable here */ }
      ws.onclose = (ev) => {
        if (stopped) return
        setWsStatus('closed')
        // 4401 = bad/expired token, 4403 = not a member. Reconnecting can't fix
        // either, so don't hammer the server — let the user re-auth / re-open.
        if (ev.code === 4401 || ev.code === 4403) return
        scheduleReconnect()
      }
    }

    // Reconnect proactively when the tab returns to the foreground or the
    // network comes back — both commonly kill an idle socket on Cloud Run.
    const onWake = () => {
      if (stopped) return
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) {
        reconnectAttemptsRef.current = 0
        connect()
      }
    }

    connect()
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('online', onWake)

    return () => {
      stopped = true
      clearReconnect()
      reconnectAttemptsRef.current = 0
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('online', onWake)
      const ws = wsRef.current
      wsRef.current = null
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
        try { ws.close() } catch {}
      }
    }
  }, [channelId, handleWsMessage])

  const markActiveChannelRead = useCallback((nextMessages = messages) => {
    if (!channelId || !nextMessages.length) return
    const lastMsg = nextMessages[nextMessages.length - 1]
    if (!lastMsg?.id || String(lastMsg.id).startsWith('tmp-')) return
    const lastReadId = Number(lastMsg.id)
    if (!Number.isFinite(lastReadId)) return

    const key = String(channelId)
    if ((lastReadSentRef.current[key] || 0) >= lastReadId) {
      setChannels((prev) => {
        let changed = false
        const next = prev.map((c) => {
          if (String(c.id) !== key || !c.unread_count) return c
          changed = true
          return { ...c, unread_count: 0 }
        })
        return changed ? next : prev
      })
      return
    }

    lastReadSentRef.current[key] = lastReadId
    setChannels((prev) => {
      let changed = false
      const next = prev.map((c) => {
        if (String(c.id) !== key || !c.unread_count) return c
        changed = true
        return { ...c, unread_count: 0 }
      })
      return changed ? next : prev
    })

    const payload = { type: 'read', last_read_message_id: lastReadId }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify(payload)) } catch {}
    } else {
      api(`/api/channels/${channelId}/read`, {
        method: 'POST',
        body: { last_read_message_id: lastReadId },
      }).catch(() => {})
    }
  }, [channelId, messages])

  useEffect(() => {
    markActiveChannelRead(messages)
  }, [messages, markActiveChannelRead])

  useEffect(() => {
    if (!channelId || !messages.length) return
    // Never persist unsettled optimistic bubbles — otherwise a refresh would
    // resurrect them as permanently "Sending…" with no in-flight request.
    const persistable = messages.filter((m) => !m._tmp_id)
    if (persistable.length) setCachedMessages(channelId, persistable, user?.id)
  }, [channelId, messages, user?.id])
  useEffect(() => { if (channels.length) setCachedChannels(channels, user?.id) }, [channels, user?.id])

  // Track whether the user is pinned to the bottom so incoming/old messages
  // don't fight their scroll position.
  const onMessagesScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    shouldAutoScrollRef.current = distanceFromBottom < 120
  }, [])

  useEffect(() => {
    if (!messages.length) return
    // First paint of a conversation jumps instantly to the latest; subsequent
    // new messages animate — but only when the user is already at the bottom.
    if (firstScrollRef.current) {
      firstScrollRef.current = false
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    } else if (shouldAutoScrollRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  useEffect(() => {
    const t = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now()
        const next = { ...prev }
        for (const k of Object.keys(next)) {
          if (now - next[k].at > 3500) delete next[k]
        }
        return next
      })
    }, 1500)
    return () => clearInterval(t)
  }, [])

  // Auto-grow composer
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [draft])

  // POST the message and reconcile the optimistic bubble with the persisted
  // row. Sending is REST-only on purpose: a flaky/closed WebSocket can never
  // block the composer. The server fans the result back out to the WS room, so
  // peers (and this sender, if their socket is up) still get it in real time —
  // de-duped by client_id / id in handleWsMessage.
  const deliverMessage = useCallback(async ({ body, clientId, replyToId, attempt = 0 }) => {
    setMessages((prev) => prev.map((m) =>
      m._tmp_id === clientId ? { ...m, _pending: true, _failed: false } : m
    ))
    try {
      const saved = await api(`/api/channels/${channelId}/messages`, {
        method: 'POST',
        body: { body, reply_to_id: replyToId ?? undefined, client_id: clientId },
      })
      setMessages((prev) => {
        const realAlready = prev.some((m) => m.id === saved.id && m._tmp_id == null)
        const idx = prev.findIndex((m) => m._tmp_id === clientId)
        if (idx >= 0) {
          const next = prev.slice()
          // If the WS broadcast already inserted the real row, just drop the
          // optimistic dupe; otherwise swap it in place to preserve ordering.
          if (realAlready) next.splice(idx, 1)
          else next[idx] = saved
          return next
        }
        return realAlready ? prev : [...prev, saved]
      })
      setChannels((prev) =>
        prev.map((c) =>
          String(c.id) === String(channelId)
            ? { ...c, last_message_preview: (saved.body || '').slice(0, 120), last_message_at: saved.created_at }
            : c
        )
      )
    } catch {
      // Auto-retry transient failures a couple of times before surfacing a
      // manual retry affordance to the user.
      if (attempt < SEND_RETRY_LIMIT) {
        const delay = 600 * 2 ** attempt
        setTimeout(() => { deliverMessage({ body, clientId, replyToId, attempt: attempt + 1 }) }, delay)
        return
      }
      setMessages((prev) => prev.map((m) =>
        m._tmp_id === clientId ? { ...m, _pending: false, _failed: true } : m
      ))
    }
  }, [channelId])

  const sendMessage = useCallback(() => {
    const body = draft.trim()
    if (!body || !channelId) return

    const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const replyToId = replyTo?.id ?? null
    const optimistic = {
      _tmp_id: clientId,
      id: clientId,
      _pending: true,
      channel_id: Number(channelId),
      sender_id: user?.id,
      sender_name: user?.name || 'You',
      sender_color: user?.avatar_color,
      body,
      created_at: new Date().toISOString(),
      deleted_at: null,
      reply_to_id: replyToId,
      reply_preview: replyTo ? replyTo.body?.slice(0, 120) : null,
      reactions: [],
    }
    // Optimistic insert + snappy composer reset; the user is always pinned to
    // the bottom right after they send.
    shouldAutoScrollRef.current = true
    setMessages((prev) => capTail([...prev, optimistic]))
    setDraft('')
    setReplyTo(null)
    setSmartReplies([])
    setMentionState(null)

    deliverMessage({ body, clientId, replyToId })
  }, [draft, channelId, replyTo, user?.id, user?.name, user?.avatar_color, deliverMessage])

  const retrySend = useCallback((m) => {
    if (!m?._tmp_id) return
    deliverMessage({ body: m.body, clientId: m._tmp_id, replyToId: m.reply_to_id ?? null })
  }, [deliverMessage])

  const discardFailed = useCallback((tmpId) => {
    setMessages((prev) => prev.filter((m) => m._tmp_id !== tmpId))
  }, [])

  // ── @mention autocomplete ──────────────────────────────────────────────
  const mentionCandidates = useMemo(() => {
    if (!mentionState || !activeChannel) return []
    const q = mentionState.query.toLowerCase()
    return (activeChannel.members || [])
      .filter((m) => m.id !== user?.id)
      .filter((m) => {
        const handle = m.name.replace(/\s+/g, '').toLowerCase()
        return !q || handle.startsWith(q) || m.name.toLowerCase().includes(q)
      })
      .slice(0, 6)
  }, [mentionState, activeChannel, user?.id])

  const detectMention = (value, caret) => {
    let i = caret - 1
    while (i >= 0 && /[\w.-]/.test(value[i])) i--
    if (i < 0 || value[i] !== '@') return null
    if (i > 0 && !/\s/.test(value[i - 1])) return null
    return { start: i, query: value.slice(i + 1, caret) }
  }

  const onComposerChange = (e) => {
    const value = e.target.value
    setDraft(value)
    const caret = e.target.selectionStart ?? value.length
    setMentionState(detectMention(value, caret))
    setMentionIndex(0)
  }

  const insertMention = (member) => {
    if (!mentionState) return
    const handle = '@' + member.name.replace(/\s+/g, '') + ' '
    const before = draft.slice(0, mentionState.start)
    const after = draft.slice(mentionState.start + 1 + mentionState.query.length)
    const next = before + handle + after
    setDraft(next)
    setMentionState(null)
    requestAnimationFrame(() => {
      const el = composerRef.current
      if (!el) return
      el.focus()
      const pos = (before + handle).length
      try { el.setSelectionRange(pos, pos) } catch {}
    })
  }

  const onComposerKey = (e) => {
    // Don't treat the Enter that confirms an IME composition (CJK, accents) as
    // a send — that's the classic accidental double/early-send bug.
    if (e.isComposing || e.keyCode === 229) return
    if (mentionState && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionCandidates.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(mentionCandidates[mentionIndex])
        return
      }
      if (e.key === 'Escape') { setMentionState(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    } else if (e.key === 'Escape' && replyTo) {
      setReplyTo(null)
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'typing' }))
    }
  }

  // ── AI smart-reply chips ───────────────────────────────────────────────
  const fetchSmartReplies = async () => {
    if (smartLoading || !messages.length) return
    setSmartLoading(true)
    try {
      const recent = messages.slice(-6).map((m) => ({ name: m.sender_name, body: m.body }))
      const res = await api('/api/ai/suggest-replies', {
        method: 'POST',
        body: { recent_messages: recent, context: activeChannel?.name },
      })
      setSmartReplies(res.suggestions || [])
    } catch {
      setSmartReplies([])
    } finally {
      setSmartLoading(false)
    }
  }

  const applySmartReply = (text) => {
    setDraft(text)
    setSmartReplies([])
    requestAnimationFrame(() => composerRef.current?.focus())
  }

  const toggleReaction = (messageId, emoji) => {
    setEmojiPicker(null)
    // Optimistic/failed bubbles aren't persisted yet — nothing to react to.
    if (typeof messageId !== 'number') return
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ type: 'reaction', message_id: messageId, emoji })); return } catch {}
    }
    // REST fallback when the socket is down. Decide add vs remove from local
    // state and apply an optimistic update so the UI responds immediately.
    const target = messagesRef.current.find((m) => m.id === messageId)
    const mine = target?.reactions?.some((r) => r.emoji === emoji && r.user_id === user?.id)
    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId) return m
      let reactions = [...(m.reactions || [])]
      if (mine) reactions = reactions.filter((r) => !(r.emoji === emoji && r.user_id === user?.id))
      else reactions.push({ emoji, user_id: user?.id, user_name: user?.name })
      return { ...m, reactions }
    }))
    const base = `/api/channels/${channelId}/messages/${messageId}/reactions`
    const req = mine
      ? api(`${base}/${encodeURIComponent(emoji)}`, { method: 'DELETE' })
      : api(base, { method: 'POST', body: { emoji } })
    req.catch(() => {})
  }

  const deleteMessage = (messageId) => {
    // Locally-only (optimistic/failed) message — just drop it from the thread.
    if (typeof messageId !== 'number') {
      setMessages((prev) => prev.filter((m) => m.id !== messageId && m._tmp_id !== messageId))
      return
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try { wsRef.current.send(JSON.stringify({ type: 'delete', message_id: messageId })); return } catch {}
    }
    // REST fallback + optimistic soft-delete.
    setMessages((prev) => prev.map((m) =>
      m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m
    ))
    api(`/api/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' }).catch(() => {})
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !channelId) return
    setUploading(true)
    try {
      const msg = await uploadFile(`/api/channels/${channelId}/upload`, file)
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
    } catch (err) {
      alert(err.message || 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const insertEmoji = (emoji) => {
    const el = composerRef.current
    if (!el) { setDraft((d) => d + emoji); return }
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + emoji + draft.slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + emoji.length
      try { el.setSelectionRange(pos, pos) } catch {}
    })
  }

  const uploadVoiceBlob = async (blob) => {
    if (!channelId) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = new File([blob], `voice-${stamp}.webm`, { type: 'audio/webm' })
    setUploading(true)
    try {
      const msg = await uploadFile(`/api/channels/${channelId}/upload`, file)
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
    } catch (err) {
      alert(err.message || 'Voice upload failed')
    } finally {
      setUploading(false)
    }
  }

  const startVoiceRecording = async () => {
    if (isRecording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recStreamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '')
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recordedChunksRef.current = []
      cancelRecRef.current = false
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const chunks = recordedChunksRef.current
        recordedChunksRef.current = []
        recStreamRef.current?.getTracks().forEach((t) => t.stop())
        recStreamRef.current = null
        if (!cancelRecRef.current && chunks.length > 0) {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          uploadVoiceBlob(blob)
        }
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setRecTime(0)
      recTimerRef.current = setInterval(() => setRecTime((t) => t + 1), 1000)
    } catch {
      alert('Microphone permission denied or unavailable.')
    }
  }

  const stopVoiceRecording = (cancel = false) => {
    cancelRecRef.current = cancel
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null }
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') { try { rec.stop() } catch {} }
    mediaRecorderRef.current = null
    setIsRecording(false)
    setRecTime(0)
  }

  useEffect(() => () => stopVoiceRecording(true), [])
  useEffect(() => { setShowComposerEmoji(false); stopVoiceRecording(true) }, [channelId])

  const formatRecTime = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0')
    const sec = (s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  const typingText = useMemo(() => {
    const names = Object.values(typingUsers).map((t) => t.name)
    if (!names.length) return ''
    if (names.length === 1) return `${names[0]} is typing…`
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
    return 'Several people are typing…'
  }, [typingUsers])

  const filteredChannels = useMemo(() => {
    if (!search.trim()) return channels
    const q = search.trim().toLowerCase()
    return channels.filter((c) => {
      const display = channelDisplay(c, user.id)
      return (
        display.name.toLowerCase().includes(q) ||
        (c.last_message_preview || '').toLowerCase().includes(q)
      )
    })
  }, [channels, search, user.id])

  const grouped = useMemo(() => groupMessages(messages), [messages])

  const readByPerMessage = useMemo(() => {
    const map = {}
    if (!activeChannel) return map
    for (const [uid, lastReadId] of Object.entries(readReceipts)) {
      const userId = Number(uid)
      if (userId === user?.id) continue
      const member = activeChannel.members?.find((m) => m.id === userId)
      if (!member) continue
      if (!map[lastReadId]) map[lastReadId] = []
      map[lastReadId].push(member.name)
    }
    return map
  }, [readReceipts, activeChannel, user?.id])

  /* ─────────────────── render ─────────────────── */

  return (
    <div className="flex h-[calc(100vh-60px)] min-h-0 overflow-hidden font-sans">
      {/* ============== Channel list ============== */}
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center justify-between px-4 pb-3.5 pt-[18px]">
          <div className="font-display text-[22px] font-bold tracking-[-0.03em] text-fg">
            Chat
          </div>
          <button
            className="primary sm"
            onClick={() => setShowNew(true)}
            aria-label="New conversation"
          >
            <Icon name="plus" size={14} /> New
          </button>
        </div>

        <div className="relative px-3 pb-3">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-6 top-1/2 -translate-y-[calc(50%+6px)] text-fg-muted"
          />
          <input
            placeholder="Search conversations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="!h-[38px] !rounded-md !border-line !bg-bg-3 !pl-9 !text-[13.5px] !shadow-none focus:!border-accent focus:!bg-bg-1"
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4 pt-1">
          {channels.length === 0 && (
            <div className="px-5 py-10 text-center text-fg-muted">
              <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-md border border-line bg-bg-3 text-fg-muted">
                <Icon name="chat" size={28} />
              </div>
              <div className="mb-1 text-[14px] font-semibold text-fg-dim">No conversations yet</div>
              <div className="text-[12.5px]">Click <strong>+ New</strong> to start one.</div>
            </div>
          )}
          {filteredChannels.map((c) => {
            const display = channelDisplay(c, user.id)
            const active = String(c.id) === String(channelId)
            return (
              <button
                key={c.id}
                onClick={() => navigate(`/chat/${c.id}`)}
                className={cn(
                  'group/row relative flex w-full items-center gap-3 rounded-md border-0 bg-transparent px-2.5 py-2.5 text-left transition-colors',
                  'hover:bg-[color-mix(in_srgb,var(--c-fg)_5%,transparent)]',
                  active && 'bg-[color-mix(in_srgb,var(--c-accent)_10%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--c-accent)_30%,transparent)]'
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-[3px] bg-accent"
                  />
                )}
                <div className="relative shrink-0">
                  <Avatar name={display.name} color={display.color} />
                  {c.is_direct && <span className="presence-dot" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'truncate text-[13.5px] font-semibold tracking-[-0.01em]',
                        active ? 'text-accent' : 'text-fg'
                      )}
                    >
                      {display.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.unread_count > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10.5px] font-bold leading-none text-white shadow-[0_4px_14px_-6px_var(--c-accent-ring)]">
                          {c.unread_count}
                        </span>
                      )}
                      {c.last_message_at && (
                        <span className="text-[11px] tabular-nums text-fg-muted">
                          {formatTime(c.last_message_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="truncate text-[12px] text-fg-muted">
                    {c.last_message_preview || (c.is_direct ? 'Start a conversation' : 'No messages yet')}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ============== Thread ============== */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
        {!activeChannel ? (
          <div className="grid flex-1 place-items-center p-10">
            <div className="flex max-w-[360px] flex-col items-center gap-2 text-center">
              <div
                className="mb-2 grid h-[72px] w-[72px] place-items-center rounded-lg text-accent"
                style={{
                  background: 'var(--accent-gradient-soft)',
                  border: '1px solid color-mix(in srgb, var(--c-accent) 30%, transparent)',
                }}
              >
                <Icon name="chat" size={32} />
              </div>
              <h2 className="m-0 font-display text-[22px] font-bold tracking-[-0.02em] text-fg">
                Start a conversation
              </h2>
              <p className="m-0 mb-3 text-[14px] text-fg-muted">
                Select someone from the list or create a new channel to begin chatting.
              </p>
              <button className="primary" onClick={() => setShowNew(true)}>
                <Icon name="plus" size={14} /> New conversation
              </button>
            </div>
          </div>
        ) : (
          <>
            {(() => {
              const display = channelDisplay(activeChannel, user.id)
              const otherMember = activeChannel.is_direct
                ? activeChannel.members.find((m) => m.id !== user.id)
                : null
              return (
                <header
                  className="relative z-[2] flex items-center gap-3.5 border-b border-line px-6 py-4 backdrop-blur-xl"
                  style={{
                    background: 'linear-gradient(180deg, color-mix(in srgb, var(--c-surface) 86%, transparent), color-mix(in srgb, var(--c-surface) 62%, transparent)), radial-gradient(900px 200px at 0% 0%, color-mix(in srgb, var(--c-accent) 12%, transparent), transparent 60%)',
                  }}
                >
                  <div className="relative shrink-0">
                    <Avatar name={display.name} color={display.color} />
                    {activeChannel.is_direct && <span className="presence-dot" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold tracking-[-0.015em] text-fg">
                      {display.name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-fg-muted">
                      {wsStatus !== 'open' ? (
                        <>
                          <span className="inline-block h-[7px] w-[7px] animate-pulse rounded-full bg-warn shadow-[0_0_8px_var(--c-warn)]" />
                          {wsStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
                        </>
                      ) : activeChannel.is_direct ? (
                        <>
                          <span className="inline-block h-[7px] w-[7px] animate-pulse rounded-full bg-success shadow-[0_0_8px_var(--c-success)]" />
                          Active now
                        </>
                      ) : (
                        <>
                          <Icon name="users" size={12} /> {activeChannel.members.length} members
                        </>
                      )}
                    </div>
                  </div>
                  {otherMember && (
                    <div className="flex shrink-0 items-center gap-2">
                      <CallBtn label="Audio call" onClick={() => startCall(otherMember, 'audio')}>
                        <Icon name="phone" size={18} />
                      </CallBtn>
                      <CallBtn label="Video call" onClick={() => startCall(otherMember, 'video')}>
                        <Icon name="video" size={18} />
                      </CallBtn>
                    </div>
                  )}
                </header>
              )
            })()}

            <div
              ref={scrollContainerRef}
              onScroll={onMessagesScroll}
              className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-7 pb-2 pt-6"
              onClick={() => setEmojiPicker(null)}
            >
              {/* Load-older affordance — paginates back through history while
                  preserving scroll position. */}
              {hasMore && messages.length > 0 && (
                <div className="flex justify-center pb-1">
                  <button
                    className="ghost rounded-full border border-line-strong px-3 py-1 text-[12px] text-fg-dim"
                    onClick={loadOlder}
                    disabled={loadingOlder}
                  >
                    {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                  </button>
                </div>
              )}

              {/* Initial load skeleton (only when we have nothing cached). */}
              {loadingMessages && messages.length === 0 && (
                <div className="flex flex-col gap-4 py-4" aria-hidden>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className={cn('flex items-end gap-2.5', i % 2 === 0 && 'flex-row-reverse')}>
                      <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-bg-3" />
                      <div
                        className="h-10 animate-pulse rounded-[18px] bg-bg-3"
                        style={{ width: `${40 + ((i * 53) % 45)}%` }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Hard error with nothing to show — offer a retry. */}
              {messagesError && messages.length === 0 && !loadingMessages && (
                <div className="m-auto flex max-w-[320px] flex-col items-center gap-3 py-10 text-center">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-danger-soft text-danger">
                    <Icon name="close" size={22} />
                  </div>
                  <div className="text-[14px] font-semibold text-fg-dim">Couldn’t load messages</div>
                  <div className="text-[12.5px] text-fg-muted">{messagesError}</div>
                  <button className="primary sm" onClick={() => loadMessages()}>
                    <Icon name="redo" size={13} /> Retry
                  </button>
                </div>
              )}

              {/* Empty conversation. */}
              {!loadingMessages && !messagesError && messages.length === 0 && (
                <div className="m-auto flex max-w-[320px] flex-col items-center gap-2 py-10 text-center text-fg-muted">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-bg-3 text-fg-muted">
                    <Icon name="chat" size={22} />
                  </div>
                  <div className="text-[13.5px] font-semibold text-fg-dim">No messages yet</div>
                  <div className="text-[12.5px]">Say hello to start the conversation.</div>
                </div>
              )}

              {grouped.map((g) =>
                g.type === 'divider' ? (
                  <div
                    key={g.id}
                    className="flex items-center gap-2.5 py-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-fg-muted"
                  >
                    <span className="h-px flex-1 bg-line" aria-hidden />
                    <span className="rounded-full border border-line-strong bg-surface px-3 py-1 text-fg-dim shadow-xs">
                      {dayLabel(g.date)}
                    </span>
                    <span className="h-px flex-1 bg-line" aria-hidden />
                  </div>
                ) : (
                  <div
                    key={g.id}
                    className={cn(
                      'flex items-end gap-2.5',
                      g.sender_id === user.id && 'flex-row-reverse'
                    )}
                  >
                    <Avatar name={g.sender_name} color={g.sender_color} size="sm" />
                    <div className={cn('flex min-w-0 max-w-[70%] flex-1 flex-col', g.sender_id === user.id && 'items-end')}>
                      <div
                        className={cn(
                          'flex items-baseline gap-2 px-1 pb-1 text-[11.5px]',
                          g.sender_id === user.id && 'flex-row-reverse'
                        )}
                      >
                        <span className="font-semibold text-fg-dim">{g.sender_name}</span>
                        <span className="text-fg-muted">{formatTime(g.messages[0].created_at)}</span>
                      </div>
                      <div className={cn('flex flex-col gap-1', g.sender_id === user.id && 'items-end')}>
                        {g.messages.map((m) => (
                          <MessageBubble
                            key={m.id}
                            msg={m}
                            isMine={m.sender_id === user.id}
                            isChannelCreator={!!activeChannel?.members?.find(mem => mem.id === user.id) && activeChannel?.created_by === user?.id}
                            onReply={() => { setReplyTo(m); composerRef.current?.focus() }}
                            onReact={(emoji) => toggleReaction(m.id, emoji)}
                            onDelete={() => deleteMessage(m.id)}
                            onRetry={() => retrySend(m)}
                            onDiscard={() => discardFailed(m._tmp_id)}
                            emojiPickerOpen={emojiPicker === m.id}
                            onToggleEmojiPicker={(e) => { e.stopPropagation(); setEmojiPicker(emojiPicker === m.id ? null : m.id) }}
                            readBy={readByPerMessage[m.id]}
                            myHandle={user.name?.replace(/\s+/g, '').toLowerCase()}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing indicator */}
            <div
              className={cn(
                'flex h-[22px] items-center gap-2 px-7 text-[12px] text-fg-muted transition-opacity',
                typingText ? 'opacity-100' : 'opacity-0'
              )}
            >
              {typingText && (
                <>
                  <span className="inline-flex items-end gap-[3px]" aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="block h-[5px] w-[5px] animate-bounce rounded-full bg-accent"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </span>
                  <span>{typingText}</span>
                </>
              )}
            </div>

            {/* Reply bar */}
            {replyTo && (
              <div
                className="flex items-center gap-2 border-b border-line border-t-[color-mix(in_srgb,var(--c-accent)_30%,var(--c-line))] px-5 py-2 text-[12.5px] text-fg-dim"
                style={{ background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)', borderTopWidth: '1px', borderTopStyle: 'solid' }}
              >
                <Icon name="reply" size={14} />
                <span className="min-w-0 flex-1 truncate">
                  Replying to <strong className="text-fg">{replyTo.sender_name}</strong>: {replyTo.body?.slice(0, 80)}
                </span>
                <button
                  className="ghost"
                  onClick={() => setReplyTo(null)}
                  style={{ padding: '4px 6px', fontSize: 12 }}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            )}

            {/* Smart replies */}
            {smartReplies.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5">
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
                  <Icon name="sparkle" size={12} /> Suggested
                </span>
                {smartReplies.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => applySmartReply(s)}
                    className="relative overflow-hidden rounded-full border border-line-strong bg-bg-1 px-3 py-1.5 text-[12.5px] font-medium text-fg-dim transition hover:-translate-y-px hover:border-accent hover:bg-accent-soft hover:shadow-[0_10px_22px_-10px_var(--c-accent-ring)]"
                  >
                    {s}
                  </button>
                ))}
                <button
                  className="ghost ml-auto"
                  style={{ padding: '4px 6px' }}
                  onClick={() => setSmartReplies([])}
                  aria-label="Dismiss suggestions"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            )}

            {/* Mention popover */}
            {mentionState && mentionCandidates.length > 0 && (
              <div
                role="listbox"
                className="absolute bottom-[88px] left-7 z-30 w-[280px] rounded-[14px] border border-line-strong p-1.5 shadow-[0_20px_50px_-16px_color-mix(in_srgb,var(--c-fg)_35%,transparent)] backdrop-blur-md"
                style={{ background: 'color-mix(in srgb, var(--c-surface) 94%, transparent)' }}
              >
                {mentionCandidates.map((m, i) => (
                  <button
                    key={m.id}
                    role="option"
                    aria-selected={i === mentionIndex}
                    onMouseDown={(e) => { e.preventDefault(); insertMention(m) }}
                    onMouseEnter={() => setMentionIndex(i)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition',
                      i === mentionIndex
                        ? 'translate-x-0.5 bg-accent-soft'
                        : 'hover:translate-x-0.5 hover:bg-accent-soft'
                    )}
                  >
                    <Avatar name={m.name} color={m.avatar_color} size="sm" />
                    <div className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-[13px] text-fg">{m.name}</span>
                      <span className="block truncate text-[11px] text-fg-muted">@{m.name.replace(/\s+/g, '')}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Composer */}
            <div className="relative flex items-end gap-2 border-t border-line bg-surface px-5 py-3">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.json,.md,.webm,.mp3,.wav,.m4a,.ogg"
                onChange={handleFileUpload}
              />
              <ComposerIconBtn
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || isRecording}
                title="Attach file"
              >
                {uploading ? <SpinnerSm /> : <Icon name="attach" size={18} />}
              </ComposerIconBtn>
              <ComposerIconBtn
                onClick={() => setShowComposerEmoji((v) => !v)}
                disabled={isRecording}
                title="Emoji"
                aria-label="Emoji"
              >
                <Icon name="smile" size={18} />
              </ComposerIconBtn>
              <ComposerIconBtn
                onClick={fetchSmartReplies}
                disabled={isRecording || smartLoading || !messages.length}
                title="Suggest a reply"
                aria-label="Suggest a reply"
              >
                {smartLoading ? <SpinnerSm /> : <Icon name="sparkle" size={18} />}
              </ComposerIconBtn>

              <textarea
                ref={composerRef}
                placeholder="Type a message. Enter to send, Shift+Enter for new line."
                value={draft}
                onChange={onComposerChange}
                onKeyDown={onComposerKey}
                rows={1}
                disabled={isRecording}
                className="!min-h-[46px] !resize-none !rounded-[14px] !border-line-strong !bg-bg-1 !px-3.5 !py-3 !text-[14.5px] !leading-[1.55] !shadow-[0_1px_2px_color-mix(in_srgb,var(--c-fg)_4%,transparent)] focus:!border-accent focus:!bg-surface-2 focus:!shadow-[0_0_0_3px_var(--c-accent-ring)]"
                style={{ maxHeight: 180 }}
              />

              <button
                onClick={isRecording ? () => stopVoiceRecording(false) : startVoiceRecording}
                title={isRecording ? 'Send voice note' : 'Record voice note'}
                aria-label={isRecording ? 'Send voice note' : 'Record voice note'}
                className={cn(
                  'inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px] border-0 transition',
                  isRecording
                    ? 'animate-pulse bg-danger text-white shadow-[0_4px_14px_-4px_var(--c-danger-soft)]'
                    : 'bg-transparent text-fg-muted hover:bg-[color-mix(in_srgb,var(--c-accent)_10%,transparent)] hover:text-accent'
                )}
                style={{ padding: 0 }}
              >
                <Icon name={isRecording ? 'send' : 'mic'} size={18} />
              </button>

              <button
                className="primary"
                onClick={sendMessage}
                disabled={!draft.trim() || isRecording}
                aria-label="Send"
                style={{ width: 46, height: 46, padding: 0, borderRadius: 14, flexShrink: 0 }}
              >
                <Icon name="send" size={16} />
              </button>

              {isRecording && (
                <div
                  className="absolute inset-x-0 -top-[44px] flex items-center gap-3 border-t border-line px-5 py-2.5 backdrop-blur-md"
                  style={{ background: 'color-mix(in srgb, var(--c-danger) 6%, var(--c-surface))' }}
                >
                  <span className="inline-block h-[9px] w-[9px] animate-pulse rounded-full bg-danger shadow-[0_0_12px_var(--c-danger)]" />
                  <span className="font-mono text-[13px] tabular-nums text-fg">{formatRecTime(recTime)}</span>
                  <span className="flex flex-1 items-center gap-[2px]" aria-hidden>
                    {Array.from({ length: 28 }).map((_, i) => (
                      <span
                        key={i}
                        className="block h-3 w-[2px] origin-center animate-pulse rounded bg-danger/70"
                        style={{ animationDelay: `${(i % 6) * 0.08}s` }}
                      />
                    ))}
                  </span>
                  <button
                    className="rounded-[10px] border border-line-strong bg-transparent px-3 py-1.5 text-[13px] font-semibold text-fg-muted transition hover:-translate-y-px hover:bg-bg-3 hover:text-fg"
                    onClick={() => stopVoiceRecording(true)}
                  >
                    Cancel
                  </button>
                  <button
                    className="rounded-[10px] border-0 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:-translate-y-px"
                    style={{
                      background: 'linear-gradient(135deg, var(--c-success), color-mix(in srgb, var(--c-success) 70%, #000))',
                      boxShadow: '0 8px 20px -8px color-mix(in srgb, var(--c-success) 60%, transparent)',
                    }}
                    onClick={() => stopVoiceRecording(false)}
                  >
                    Send
                  </button>
                </div>
              )}

              {showComposerEmoji && (
                <ComposerEmojiPicker
                  activeTab={emojiTab}
                  onTabChange={setEmojiTab}
                  onPick={(e) => insertEmoji(e)}
                  onClose={() => setShowComposerEmoji(false)}
                />
              )}
            </div>
          </>
        )}
      </section>

      {showNew && (
        <NewChannelModal
          onClose={() => setShowNew(false)}
          onCreated={async (ch) => {
            setShowNew(false)
            await loadChannels()
            navigate(`/chat/${ch.id}`)
          }}
        />
      )}
    </div>
  )
}

/* ────────────────────── small primitives ────────────────────── */

function ComposerIconBtn({ children, onClick, disabled, title, ...rest }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="ghost inline-flex h-[46px] w-[46px] shrink-0 items-center justify-center !rounded-[14px] !p-0 text-fg-muted hover:!bg-[color-mix(in_srgb,var(--c-fg)_6%,transparent)] hover:!text-fg"
      style={{ flexShrink: 0 }}
      {...rest}
    >
      {children}
    </button>
  )
}

function CallBtn({ label, onClick, children }) {
  return (
    <button
      onClick={onClick}
      type="button"
      title={label}
      aria-label={label}
      className="grid h-[38px] w-[38px] place-items-center !rounded-full !border-line !bg-surface !p-0 text-fg transition hover:-translate-y-px hover:!border-[color-mix(in_srgb,var(--c-accent)_45%,transparent)] hover:!bg-[color-mix(in_srgb,var(--c-accent)_10%,transparent)] hover:!text-accent"
    >
      {children}
    </button>
  )
}

function SpinnerSm() {
  return (
    <span
      className="inline-block h-[14px] w-[14px] animate-spin rounded-full border-2 border-current/30 border-t-current"
      style={{ borderTopColor: 'currentColor' }}
    />
  )
}

/* ────────────────────── Message Bubble ────────────────────── */

// Memoized: re-renders only when the data it actually displays changes. Function
// props (onReply/onReact/…) are intentionally excluded from the comparison —
// they're recreated every parent render but their behaviour is stable (handlers
// read live state via refs), so ignoring them lets a typing/presence event on
// the parent skip re-rendering every bubble in a long thread.
const MessageBubble = memo(function MessageBubble({
  msg, isMine, isChannelCreator,
  onReply, onReact, onDelete, onRetry, onDiscard,
  emojiPickerOpen, onToggleEmojiPicker,
  readBy, myHandle,
}) {
  const reactionGroups = useMemo(() => {
    const groups = {}
    for (const r of (msg.reactions || [])) {
      if (!groups[r.emoji]) groups[r.emoji] = []
      groups[r.emoji].push(r)
    }
    return groups
  }, [msg.reactions])

  if (msg.deleted_at) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-[16px] border border-dashed border-line-strong bg-bg-3 px-3.5 py-2.5 text-[13px] italic text-fg-muted">
        <Icon name="trash" size={13} />
        <em>This message was deleted</em>
      </div>
    )
  }

  const hasFile = !!msg.file_url
  const isImage = hasFile && isImageType(msg.file_type)
  const isAudio = hasFile && ((msg.file_type || '').startsWith('audio/') || /\.(webm|mp3|wav|ogg|m4a)$/i.test(msg.file_name || ''))
  const fileOnly = hasFile && !msg.body?.trim()

  // Bubble palette: solid for received (theme-aware), gradient for sent.
  const bubbleBase = 'group/bubble relative isolate w-fit max-w-full break-words px-3.5 py-2.5 text-[14.5px] leading-[1.55] transition-[transform,box-shadow] duration-200 hover:-translate-y-px'

  const sentClass = cn(
    bubbleBase,
    'rounded-[18px] rounded-br-[6px] text-white',
    'shadow-[0_1px_0_rgba(255,255,255,0.16)_inset,0_10px_28px_-10px_color-mix(in_srgb,var(--c-accent)_60%,transparent)]',
    'hover:shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_18px_40px_-10px_color-mix(in_srgb,var(--c-accent)_70%,transparent)]'
  )

  const receivedClass = cn(
    bubbleBase,
    'rounded-[18px] rounded-bl-[6px] border border-line text-fg',
    'shadow-[0_1px_2px_color-mix(in_srgb,var(--c-fg)_4%,transparent),0_8px_24px_-16px_color-mix(in_srgb,var(--c-fg)_18%,transparent)]',
    'hover:shadow-[0_4px_8px_color-mix(in_srgb,var(--c-fg)_5%,transparent),0_18px_36px_-14px_color-mix(in_srgb,var(--c-fg)_22%,transparent)]'
  )

  return (
    <div className={cn('flex flex-col gap-1', isMine && 'items-end')}>
      {msg.reply_to_id && msg.reply_preview && (
        <div className="inline-flex max-w-full items-center gap-1.5 rounded-md border-l-2 border-l-accent bg-bg-2 px-2 py-1 text-[12px] text-fg-muted">
          <Icon name="reply" size={12} />
          <span className="truncate">{msg.reply_preview}</span>
        </div>
      )}

      <div
        className={cn(
          isMine ? sentClass : receivedClass,
          fileOnly && '!border-0 !bg-transparent !p-0 !shadow-none',
          msg._pending && 'opacity-70',
          msg._failed && '!border-danger !bg-[color-mix(in_srgb,var(--c-danger)_8%,transparent)] !text-fg'
        )}
        style={
          isMine
            ? { background: 'linear-gradient(135deg, var(--c-accent) 0%, var(--c-accent-2) 55%, var(--c-accent-3) 100%)' }
            : { background: 'var(--c-surface-2)' }
        }
      >
        {hasFile && isImage && (
          <a
            href={`${getApiBase()}${msg.file_url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-md transition-opacity hover:opacity-90"
          >
            <img src={`${getApiBase()}${msg.file_url}`} alt={msg.file_name} className="block max-h-[320px] max-w-full" />
          </a>
        )}
        {hasFile && isAudio && (
          <div
            className="flex min-w-[220px] items-center gap-2.5 rounded-md border px-2.5 py-1.5"
            style={{
              background: 'color-mix(in srgb, var(--c-accent) 10%, transparent)',
              borderColor: 'color-mix(in srgb, var(--c-accent) 22%, transparent)',
            }}
          >
            <Icon name="mic" size={16} />
            <audio controls preload="metadata" src={`${getApiBase()}${msg.file_url}`} className="flex-1" />
          </div>
        )}
        {hasFile && !isImage && !isAudio && (
          <a
            href={`${getApiBase()}${msg.file_url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="-mx-0.5 mb-1 flex items-center gap-2.5 rounded-md border border-line bg-bg-3 px-3 py-2 text-inherit transition hover:border-[color-mix(in_srgb,var(--c-accent)_25%,transparent)] hover:bg-accent-soft"
          >
            <Icon name="file" size={18} />
            <div className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate text-[13px] font-medium">{msg.file_name}</span>
              <span className="text-[11px] text-fg-muted">{formatFileSize(msg.file_size)}</span>
            </div>
            <Icon name="download" size={16} className="opacity-70" />
          </a>
        )}
        {(!hasFile || (msg.body && msg.body !== msg.file_name)) && (
          <span className="whitespace-pre-wrap break-words">
            {renderBodyWithMentions(msg.body, myHandle)}
          </span>
        )}

        {/* Hover actions */}
        <div
          className={cn(
            'absolute -top-3.5 z-10 flex items-center gap-0.5 rounded-[10px] border border-line-strong p-0.5 opacity-0 backdrop-blur-md transition-all duration-200',
            'shadow-[0_10px_22px_-10px_color-mix(in_srgb,var(--c-fg)_30%,transparent)]',
            'group-hover/bubble:translate-y-0 group-hover/bubble:opacity-100',
            isMine ? '-left-1 right-auto' : 'right-1 left-auto'
          )}
          style={{ background: 'color-mix(in srgb, var(--c-surface) 94%, transparent)' }}
        >
          <BubbleAction title="React" onClick={onToggleEmojiPicker}><Icon name="emoji" size={14} /></BubbleAction>
          <BubbleAction title="Reply" onClick={onReply}><Icon name="reply" size={14} /></BubbleAction>
          {(isMine || isChannelCreator) && (
            <BubbleAction title="Delete" onClick={onDelete}><Icon name="trash" size={14} /></BubbleAction>
          )}
        </div>
      </div>

      {/* Quick-react emoji picker */}
      {emojiPickerOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 rounded-full border border-line-strong p-1 shadow-md backdrop-blur-md"
          style={{ background: 'color-mix(in srgb, var(--c-surface) 96%, transparent)' }}
        >
          {QUICK_EMOJIS.map((em) => (
            <button
              key={em}
              onClick={() => onReact(em)}
              className="grid h-8 w-8 place-items-center !rounded-full !border-0 !bg-transparent text-[18px] !shadow-none transition hover:scale-110 hover:!bg-[color-mix(in_srgb,var(--c-fg)_6%,transparent)]"
              style={{ padding: 0 }}
            >
              {em}
            </button>
          ))}
        </div>
      )}

      {/* Reactions display */}
      {Object.keys(reactionGroups).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(reactionGroups).map(([emoji, users]) => (
            <button
              key={emoji}
              onClick={() => onReact(emoji)}
              title={users.map((u) => u.user_name).join(', ')}
              className="inline-flex items-center gap-1 !rounded-full !border-line !bg-bg-3 !px-2 !py-0.5 text-[12.5px] !shadow-none transition hover:!border-accent hover:!bg-accent-soft"
            >
              <span>{emoji}</span>
              <span className="font-semibold tabular-nums text-fg-dim">{users.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Delivery status — sending spinner / failed + retry. Only ever shown on
          the sender's own optimistic bubbles. */}
      {isMine && msg._pending && !msg._failed && (
        <div className="flex items-center gap-1 px-1 text-[11px] text-fg-muted">
          <SpinnerSm />
          <span>Sending…</span>
        </div>
      )}
      {isMine && msg._failed && (
        <div className="flex items-center gap-2 px-1 text-[11px] text-danger">
          <Icon name="close" size={11} />
          <span>Not sent.</span>
          <button onClick={onRetry} className="font-semibold underline underline-offset-2 hover:opacity-80">
            Retry
          </button>
          <button onClick={onDiscard} className="text-fg-muted underline underline-offset-2 hover:opacity-80">
            Discard
          </button>
        </div>
      )}

      {/* Read receipts */}
      {!msg._pending && !msg._failed && readBy && readBy.length > 0 && (
        <div className="flex items-center gap-1 px-1 text-[11px] text-fg-muted" title={readBy.join(', ')}>
          <Icon name="check" size={11} />
          <span>Read by {readBy.length <= 2 ? readBy.join(', ') : `${readBy.length} people`}</span>
        </div>
      )}
    </div>
  )
}, messageBubbleEqual)

// Only the props that affect what's painted. `msg` is compared by reference:
// unchanged messages keep their object identity across parent renders (we spread
// the array, not the items), so they skip; the one changed/new message re-renders.
function messageBubbleEqual(prev, next) {
  return (
    prev.msg === next.msg &&
    prev.isMine === next.isMine &&
    prev.isChannelCreator === next.isChannelCreator &&
    prev.emojiPickerOpen === next.emojiPickerOpen &&
    prev.readBy === next.readBy &&
    prev.myHandle === next.myHandle
  )
}

function BubbleAction({ children, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="grid h-7 w-7 place-items-center !rounded-lg !border-0 !bg-transparent !p-0 text-fg-dim !shadow-none transition hover:scale-110 hover:!bg-accent-soft hover:!text-accent"
    >
      {children}
    </button>
  )
}

/* ─────────────── Composer emoji picker (full) ─────────────── */

function ComposerEmojiPicker({ activeTab, onTabChange, onPick, onClose }) {
  const rootRef = useRef(null)
  useEffect(() => {
    const onDown = (e) => {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const active = EMOJI_CATEGORIES.find((c) => c.key === activeTab) || EMOJI_CATEGORIES[0]
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Emoji picker"
      className="scale-in absolute bottom-[calc(100%+6px)] right-5 z-[60] flex max-h-[360px] w-[340px] flex-col overflow-hidden rounded-2xl border border-line-strong shadow-[0_30px_60px_-20px_color-mix(in_srgb,var(--c-fg)_40%,transparent)] backdrop-blur-md"
      style={{ background: 'color-mix(in srgb, var(--c-surface) 96%, transparent)' }}
    >
      <div className="flex gap-0.5 overflow-x-auto border-b border-line bg-bg-2 px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => onTabChange(c.key)}
            title={c.label}
            aria-label={c.label}
            className={cn(
              'grid h-8 w-8 shrink-0 place-items-center !rounded-md !border-0 !p-0 text-[17px] !shadow-none transition',
              c.key === active.key
                ? '!bg-[color-mix(in_srgb,var(--c-accent)_12%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--c-accent)_32%,transparent)]!'
                : '!bg-transparent hover:!bg-[color-mix(in_srgb,var(--c-fg)_6%,transparent)]'
            )}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-8 gap-0.5 overflow-y-auto px-2.5 pb-3 pt-2">
        <div className="col-span-full px-0.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
          {active.label}
        </div>
        {active.emojis.map((em, i) => (
          <button
            key={`${active.key}-${i}`}
            onClick={() => onPick(em)}
            className="grid h-9 w-9 place-items-center !rounded-md !border-0 !bg-transparent !p-0 text-[20px] !shadow-none transition hover:scale-[1.15] hover:!bg-[color-mix(in_srgb,var(--c-fg)_6%,transparent)]"
          >
            {em}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ─────────────── New channel modal ─────────────── */

function NewChannelModal({ onClose, onCreated }) {
  const [users, setUsers] = useState([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api(`/api/users${query ? `?q=${encodeURIComponent(query)}` : ''}`).then(setUsers).catch(() => {})
  }, [query])

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const create = async () => {
    const ids = Array.from(selected)
    if (!ids.length) { setErr('Pick at least one person.'); return }
    setBusy(true)
    setErr('')
    try {
      const isDirect = ids.length === 1
      const selectedUsers = users.filter((u) => ids.includes(u.id))
      const fallbackName = selectedUsers.map((u) => u.name).join(', ')
      const ch = await api('/api/channels', {
        method: 'POST',
        body: {
          name: name.trim() || fallbackName || 'New channel',
          member_ids: ids,
          is_direct: isDirect,
        },
      })
      onCreated(ch)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-4"
      onClick={onClose}
      style={{ background: 'color-mix(in srgb, var(--c-fg) 45%, transparent)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[440px] flex-col gap-3 rounded-2xl border border-line-strong bg-surface p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="m-0 font-display text-[18px] font-semibold tracking-[-0.02em] text-fg">
            Start a conversation
          </h3>
          <button
            className="ghost"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: '6px 8px' }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {err && (
          <div className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            <Icon name="close" size={14} /> {err}
          </div>
        )}

        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted"
          />
          <input
            placeholder="Search people by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="!h-[38px] !rounded-md !border-line !bg-bg-3 !pl-9 !text-[13.5px] !shadow-none focus:!border-accent focus:!bg-bg-1"
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {users.length === 0 && (
            <div className="px-4 py-4 text-center text-[13px] text-fg-muted">
              No users found.
            </div>
          )}
          {users.map((u) => {
            const isSelected = selected.has(u.id)
            return (
              <button
                key={u.id}
                onClick={() => toggle(u.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md border-0 px-2 py-2 text-left transition',
                  isSelected
                    ? '!bg-accent-soft'
                    : '!bg-transparent hover:!bg-[color-mix(in_srgb,var(--c-fg)_5%,transparent)]'
                )}
              >
                <Avatar name={u.name} color={u.avatar_color} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] text-fg">{u.name}</div>
                  <div className="truncate text-[11px] text-fg-muted">{u.email}</div>
                </div>
                {isSelected && (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
                    <Icon name="check" size={14} />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {selected.size > 1 && (
          <input
            placeholder="Group name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={create} disabled={busy || selected.size === 0}>
            {busy ? 'Creating…' : `Create${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
