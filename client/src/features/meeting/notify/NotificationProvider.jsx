import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import {
  AlertTriangle, Check, Crown, Disc, Hand, Info, LogIn, LogOut,
  MessageSquare, MonitorUp, X,
} from 'lucide-react'
import Emoji from '../../emoji/Emoji'
import { soundManager } from './sounds.js'

/**
 * Centralised meeting notification engine.
 *
 *   <NotificationProvider>            owns toast queue + floating chat cards +
 *                                     sound prefs, and renders the on-screen
 *                                     overlays.
 *   useNotifications()                { notify, toast, notifyChat, prefs, ... }
 *
 * `notify(type, opts)` is the one call site for every event: it plays the right
 * sound (throttled, mute/volume-aware) AND shows a toast. Join requests are NOT
 * surfaced here — the host manages them solely via the People panel + header
 * "Admit N" chip (Google-Meet model); this engine owns only transient overlays.
 */

const NotificationContext = createContext(null)

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationProvider>')
  return ctx
}

// type → sound voice + visual treatment. `null` sound = silent (info/error).
const TYPE_META = {
  join:           { sound: 'join',          accent: 'green', Icon: LogIn },
  leave:          { sound: 'leave',         accent: 'slate', Icon: LogOut },
  hand:           { sound: 'hand',          accent: 'amber', Icon: Hand },
  screenshare:    { sound: 'screenshare',   accent: 'green', Icon: MonitorUp },
  recording:      { sound: 'recording',     accent: 'red',   Icon: Disc },
  'host-transfer':{ sound: 'host-transfer', accent: 'green', Icon: Crown },
  chat:           { sound: 'chat',          accent: 'green', Icon: MessageSquare },
  info:           { sound: null,            accent: 'slate', Icon: Info },
  success:        { sound: null,            accent: 'green', Icon: Check },
  error:          { sound: null,            accent: 'red',   Icon: AlertTriangle },
}

const EXIT_MS = 220 // fade-out before unmount

// Floating chat cards (bottom-right, Teams style): how many show at once, and
// how long each lingers before auto-dismissing.
const MAX_CHAT_CARDS = 3
const CHAT_TTL_MS = 7000

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([])   // { id, accent, Icon, title, text, emoji, leaving }
  const [chatCards, setChatCards] = useState([]) // { id, name, color, body, mention, at, leaving }
  const [muted, setMutedState] = useState(soundManager.muted)
  const [volume, setVolumeState] = useState(soundManager.volume)

  const idRef = useRef(0)
  const timersRef = useRef(new Map())        // toastId → timeout handle
  // Chat-card actions are owned by the room; registered here.
  const chatActionsRef = useRef({ onChatRead: null, onOpenChat: null })

  // ── Toasts ────────────────────────────────────────────────────────────────
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    const h = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      timersRef.current.delete(id)
    }, EXIT_MS)
    timersRef.current.set(`exit-${id}`, h)
  }, [])

  const pushToast = useCallback((toast) => {
    const id = ++idRef.current
    const duration = toast.duration ?? 3000
    setToasts((prev) => [...prev.slice(-3), { id, ...toast }]) // cap at 4 on screen
    if (duration > 0) {
      const h = setTimeout(() => dismissToast(id), duration)
      timersRef.current.set(id, h)
    }
    return id
  }, [dismissToast])

  // ── Unified dispatcher ──────────────────────────────────────────────────────
  const notify = useCallback((type, opts = {}) => {
    const meta = TYPE_META[type] || TYPE_META.info
    if (meta.sound && !opts.silent) soundManager.play(meta.sound)
    if (opts.noToast) return null
    return pushToast({
      accent: opts.accent || meta.accent,
      Icon: meta.Icon,
      emoji: opts.emoji,
      title: opts.title,
      text: opts.text,
      duration: opts.duration,
    })
  }, [pushToast])

  // ── Floating chat cards (bottom-right, Microsoft Teams style) ────────────────
  // A richer surface than a plain toast: avatar, sender, message preview,
  // timestamp, close + "mark as read". Newest stacks at the bottom; only the
  // last MAX_CHAT_CARDS render, the rest wait their turn as older ones expire.
  const dismissChat = useCallback((id) => {
    setChatCards((prev) => prev.map((c) => (c.id === id ? { ...c, leaving: true } : c)))
    const h = setTimeout(() => {
      setChatCards((prev) => prev.filter((c) => c.id !== id))
      timersRef.current.delete(`chat-exit-${id}`)
    }, EXIT_MS)
    timersRef.current.set(`chat-exit-${id}`, h)
  }, [])

  const dismissAllChat = useCallback(() => {
    setChatCards((prev) => prev.map((c) => ({ ...c, leaving: true })))
    const h = setTimeout(() => setChatCards([]), EXIT_MS)
    timersRef.current.set('chat-clear', h)
  }, [])

  const markChatRead = useCallback(() => {
    dismissAllChat()
    chatActionsRef.current.onChatRead?.()
  }, [dismissAllChat])

  // Plays the (throttled) chat sound AND shows a floating card. Callers decide
  // *whether* to fire — typically only when the chat drawer is closed, or on an
  // @mention while it's open.
  const notifyChat = useCallback((opts = {}) => {
    if (!opts.silent) soundManager.play('chat')
    const id = ++idRef.current
    setChatCards((prev) => [...prev, {
      id,
      name: opts.name || 'New message',
      color: opts.color || colorFor(opts.name),
      body: opts.body || '',
      mention: !!opts.mention,
      at: Date.now(),
    }])
    const h = setTimeout(() => dismissChat(id), CHAT_TTL_MS)
    timersRef.current.set(`chat-${id}`, h)
    return id
  }, [dismissChat])

  const registerChatActions = useCallback((actions) => {
    chatActionsRef.current = { ...chatActionsRef.current, ...actions }
  }, [])

  // ── Sound preferences ───────────────────────────────────────────────────────
  const setMuted = useCallback((v) => { soundManager.setMuted(v); setMutedState(!!v) }, [])
  const setVolume = useCallback((v) => { soundManager.setVolume(v); setVolumeState(soundManager.volume) }, [])
  const previewSound = useCallback((kind) => { soundManager.unlock(); soundManager.play(kind, { force: true }) }, [])

  // Unlock audio on the first user gesture anywhere (browsers gate WebAudio).
  useEffect(() => {
    const unlock = () => soundManager.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // Clear pending timers on unmount.
  useEffect(() => () => { for (const h of timersRef.current.values()) clearTimeout(h) }, [])

  const value = useMemo(() => ({
    notify,
    notifyChat,
    markChatRead,
    toast: pushToast,
    dismissToast,
    registerChatActions,
    prefs: { muted, volume },
    setMuted,
    setVolume,
    previewSound,
  }), [notify, notifyChat, markChatRead, pushToast, dismissToast, registerChatActions, muted, volume, setMuted, setVolume, previewSound])

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <ChatToastStack
        cards={chatCards}
        onDismiss={dismissChat}
        onMarkRead={markChatRead}
        onOpenChat={() => chatActionsRef.current.onOpenChat?.()}
      />
    </NotificationContext.Provider>
  )
}

/* ── Transient toasts (top-right) ───────────────────────────────────────────── */

function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[clamp(280px,92vw,340px)] flex-col gap-2.5">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

const ACCENT = {
  green: 'bg-[#10B981]/15 text-[#34D399]',
  amber: 'bg-[#F59E0B]/15 text-[#FBBF24]',
  red:   'bg-[#EF4444]/15 text-[#F87171]',
  slate: 'bg-white/[0.06] text-[#94A3B8]',
}

function Toast({ toast, onDismiss }) {
  const { accent = 'slate', Icon, emoji, title, text, leaving } = toast
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        'pointer-events-auto flex items-start gap-3 rounded-2xl border border-[#263244] bg-[#111827]/97 p-3 pr-2.5 ' +
        'shadow-[0_18px_40px_-12px_rgba(0,0,0,0.75)] backdrop-blur ' +
        (leaving ? 'zk-notif-out' : 'zk-notif-in')
      }
    >
      <span className={'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ' + (ACCENT[accent] || ACCENT.slate)}>
        {emoji ? <Emoji char={emoji} size="18px" /> : Icon ? <Icon className="h-[18px] w-[18px]" /> : null}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {title && <div className="truncate text-[13px] font-semibold text-white">{title}</div>}
        {text && <div className="mt-0.5 break-words text-[12.5px] leading-snug text-[#94A3B8]">{text}</div>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg !border-0 !bg-transparent !p-0 !shadow-none text-[#64748B] transition hover:!bg-white/[0.06] hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/* ── Floating chat cards (bottom-right, Microsoft-Teams desktop style) ───────── */

function ChatToastStack({ cards, onDismiss, onMarkRead, onOpenChat }) {
  if (cards.length === 0) return null
  // Render the newest MAX_CHAT_CARDS; older ones wait (or have expired).
  const visible = cards.slice(-MAX_CHAT_CARDS)
  const hidden = cards.filter((c) => !c.leaving).length - visible.filter((c) => !c.leaving).length

  return (
    // Desktop: docked bottom-right (360–380px). Mobile: 90vw, centred above the
    // meeting toolbar. Safe-area inset keeps it clear of the iOS home bar, and
    // the bottom offset keeps it from ever overlapping the dock controls.
    <div
      className={
        'pointer-events-none fixed z-[60] flex flex-col gap-2.5 ' +
        'left-1/2 -translate-x-1/2 w-[90vw] ' +
        'sm:left-auto sm:translate-x-0 sm:right-4 sm:w-[320px] ' +
        'lg:w-[clamp(360px,30vw,380px)]'
      }
      style={{ bottom: 'calc(7rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {hidden > 0 && (
        <button
          type="button"
          onClick={onMarkRead}
          className="zk-chat-card zk-chat-focus pointer-events-auto self-center sm:self-end rounded-full px-3.5 py-1.5 text-[11.5px] font-medium text-[var(--zk-notif-msg)] transition hover:text-white"
          style={{ borderRadius: 9999 }}
        >
          +{hidden} more — mark all read
        </button>
      )}
      {visible.map((c) => (
        <ChatCard key={c.id} card={c} onDismiss={onDismiss} onMarkRead={onMarkRead} onOpenChat={onOpenChat} />
      ))}
    </div>
  )
}

function ChatCard({ card, onDismiss, onMarkRead, onOpenChat }) {
  const { id, name, body, mention, at, leaving } = card
  return (
    // Wrapper owns the enter/exit transform so the inner card's transform is
    // free for the GPU-friendly :hover lift (no animation/transform conflict).
    <div className={'pointer-events-auto ' + (leaving ? 'zk-card-out' : 'zk-card-in')}>
      <div
        role="status"
        aria-live="polite"
        className={
          'zk-chat-card p-4 ' +
          (mention ? 'ring-1 ring-[#FFC56B]/25 ' : '')
        }
      >
        <div className="flex items-start gap-3">
          <span className="zk-chat-avatar relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-semibold text-white">
            {(name || '?').slice(0, 1).toUpperCase()}
            {/* Unread indicator — gentle 2s pulse. */}
            <span
              className="zk-unread-pulse absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-[#283255]"
              style={{ background: 'var(--zk-notif-badge)' }}
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--zk-notif-name)]">
                {mention ? `${name} mentioned you` : name}
              </span>
              <span className="shrink-0 text-[11px] text-[var(--zk-notif-time)]">{relTime(at)}</span>
              <button
                type="button"
                onClick={() => onDismiss(id)}
                aria-label="Dismiss notification"
                className="zk-chat-focus grid h-6 w-6 shrink-0 place-items-center rounded-lg !border-0 !bg-transparent !p-0 !shadow-none text-[var(--zk-notif-time)] transition hover:!bg-white/[0.08] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {body && (
              <button
                type="button"
                onClick={onOpenChat}
                title="Open chat"
                className="zk-chat-focus mt-1 block w-full rounded !border-0 !bg-transparent !p-0 !shadow-none text-left text-[12.5px] leading-snug text-[var(--zk-notif-msg)] line-clamp-2 hover:text-white"
              >
                {body}
              </button>
            )}
          </div>
        </div>
        <div className="mt-3.5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onMarkRead}
            className="zk-chat-btn-2 zk-chat-focus inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold text-[var(--zk-notif-msg)] hover:text-white"
          >
            <Check className="h-3.5 w-3.5" /> Mark as read
          </button>
          <button
            type="button"
            onClick={onOpenChat}
            className="zk-chat-btn zk-chat-focus inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold text-white"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Reply
          </button>
        </div>
      </div>
    </div>
  )
}

// Stable per-name avatar colour (same palette feel as the lobby cards).
const AVATAR_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#06B6D4', '#EF4444']
function colorFor(name) {
  const s = String(name || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// Compact relative timestamp — chat cards are short-lived so this is almost
// always "Just now", but mark-as-read can keep one around a little longer.
function relTime(at) {
  const diff = Date.now() - (at || 0)
  if (diff < 60_000) return 'Just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}
