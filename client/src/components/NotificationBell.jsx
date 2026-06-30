import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { meetingPath } from '../lib/meetingUrls.js'
import { api, getWsBase } from '../api/client'
import Icon from './Icon'
import { cn } from '../lib/cn'

/* ─────────────────────────────────────────────────────────────────────────
 * NotificationBell — bell button + popover with realtime notifications.
 * Companion NotificationBell.css gone; everything's Tailwind. Logic
 * unchanged from the previous version.
 * ──────────────────────────────────────────────────────────────────────── */

function timeAgo(iso) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const mins = Math.floor((now - d) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  } catch {
    return ''
  }
}

const NOTIF_ICONS = {
  meeting_invite: 'mail',
  meeting_reminder: 'clock',
  meeting_started: 'video',
  org_invite: 'building',
  chat_mention: 'chat',
  system: 'bell',
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [invitesByCode, setInvitesByCode] = useState({})
  const dropdownRef = useRef(null)
  const wsRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [notifs, countData, invites] = await Promise.all([
          api('/api/notifications?limit=20'),
          api('/api/notifications/unread-count'),
          api('/api/meetings/invites/mine').catch(() => []),
        ])
        if (cancelled) return
        setNotifications(notifs)
        setUnreadCount(countData.count)
        const map = {}
        for (const inv of invites) {
          if (inv.meeting_code) map[inv.meeting_code] = inv
        }
        setInvitesByCode(map)
      } catch {}
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('zoiko_token')
    if (!token) return
    const ws = new WebSocket(`${getWsBase()}/ws/notifications?token=${encodeURIComponent(token)}`)
    wsRef.current = ws
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'notification') {
          setNotifications(prev => [data.notification, ...prev].slice(0, 20))
          setUnreadCount(prev => prev + 1)
        }
      } catch {}
    }
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      } else {
        clearInterval(keepalive)
      }
    }, 30000)
    return () => {
      clearInterval(keepalive)
      try { ws.close() } catch {}
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markRead = async (id) => {
    try {
      await api(`/api/notifications/${id}/read`, { method: 'POST' })
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch {}
  }

  const markAllRead = async () => {
    try {
      await api('/api/notifications/read-all', { method: 'POST' })
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch {}
  }

  const handleClick = (notif) => {
    if (!notif.is_read) markRead(notif.id)
    try {
      const data = notif.data ? JSON.parse(notif.data) : {}
      if (data.meeting_code) {
        navigate(meetingPath(data.meeting_code))
        setOpen(false)
      } else if (data.org_slug) {
        navigate(`/org/${data.org_slug}`)
        setOpen(false)
      }
    } catch {}
  }

  const parseData = (notif) => {
    try { return notif.data ? JSON.parse(notif.data) : {} } catch { return {} }
  }

  const acceptInvite = async (e, notif, invite) => {
    e.stopPropagation()
    try {
      await api(`/api/meetings/invites/${invite.id}/accept`, { method: 'POST' })
      setInvitesByCode(prev => {
        const next = { ...prev }
        delete next[invite.meeting_code]
        return next
      })
      if (!notif.is_read) markRead(notif.id)
      navigate(meetingPath(invite.meeting_code))
      setOpen(false)
    } catch {}
  }

  const declineInvite = async (e, notif, invite) => {
    e.stopPropagation()
    try {
      await api(`/api/meetings/invites/${invite.id}/decline`, { method: 'POST' })
      setInvitesByCode(prev => {
        const next = { ...prev }
        delete next[invite.meeting_code]
        return next
      })
      if (!notif.is_read) markRead(notif.id)
    } catch {}
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        title="Notifications"
        className="relative grid h-9 w-9 cursor-pointer place-items-center rounded-md border border-transparent bg-transparent text-fg-dim transition active:translate-y-0 active:scale-95 hover:-translate-y-px hover:border-line hover:bg-[color-mix(in_srgb,var(--c-fg)_5%,transparent)] hover:text-fg"
      >
        <Icon name={unreadCount > 0 ? 'bellDot' : 'bell'} size={18} />
        {unreadCount > 0 && (
          <span
            className="pulse-ring absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-lg px-1 text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--c-bg-1)]"
            style={{ background: 'var(--c-danger)' }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="scale-in absolute right-0 top-[calc(100%+8px)] z-[200] flex max-h-[440px] w-[360px] origin-top-right flex-col overflow-hidden rounded-lg border border-line bg-bg-1 shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 pt-3.5 pb-2.5">
            <span className="text-[14px] font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                className="ghost text-[12px] text-accent"
                style={{ padding: '2px 6px' }}
                onClick={markAllRead}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[380px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-[13px] text-fg-muted">
                <Icon name="inbox" size={28} />
                <span>No notifications yet</span>
              </div>
            ) : (
              notifications.map((n) => {
                const data = parseData(n)
                const invite = n.type === 'meeting_invite' && data.meeting_code
                  ? invitesByCode[data.meeting_code]
                  : null
                return (
                  <NotifItem
                    key={n.id}
                    notif={n}
                    invite={invite}
                    onClick={() => handleClick(n)}
                    onAccept={(e) => acceptInvite(e, n, invite)}
                    onDecline={(e) => declineInvite(e, n, invite)}
                  />
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ────────────────────── pieces ────────────────────── */

function NotifItem({ notif, invite, onClick, onAccept, onDecline }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-start gap-3 border-b border-line px-4 py-3 text-left transition last:border-b-0',
        notif.is_read
          ? 'bg-transparent hover:bg-[color-mix(in_srgb,var(--c-fg)_4%,transparent)]'
          : 'bg-[rgba(124,140,255,0.06)] hover:bg-[rgba(124,140,255,0.10)]'
      )}
    >
      <div
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-sm border bg-accent-soft text-accent"
        style={{ borderColor: 'color-mix(in srgb, var(--c-accent) 15%, transparent)' }}
      >
        <Icon name={NOTIF_ICONS[notif.type] || 'bell'} size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[13px] font-medium leading-[1.4]">{notif.title}</div>
        {notif.body && (
          <div
            className="overflow-hidden text-[12px] leading-[1.4] text-fg-muted"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
          >
            {notif.body}
          </div>
        )}
        <div className="mt-1 text-[11px] text-fg-muted/70">{timeAgo(notif.created_at)}</div>
        {invite && (
          <div className="mt-2 flex gap-1.5">
            <InviteAction tone="accept" onClick={onAccept}>Accept</InviteAction>
            <InviteAction tone="decline" onClick={onDecline}>Decline</InviteAction>
          </div>
        )}
      </div>
      {!notif.is_read && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
      )}
    </button>
  )
}

function InviteAction({ children, tone, onClick }) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(e) }}
      className={cn(
        'inline-flex cursor-pointer select-none items-center justify-center rounded-sm border px-2.5 py-1 text-[12px] font-semibold transition',
        tone === 'accept'
          ? 'border-transparent bg-accent text-white hover:brightness-110'
          : 'border-line bg-transparent text-fg-dim hover:bg-[color-mix(in_srgb,var(--c-fg)_5%,transparent)] hover:text-fg'
      )}
    >
      {children}
    </span>
  )
}
