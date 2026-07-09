import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import {
  Check, Clock, Copy, Crown, Hand, Loader2, MicOff, MoreVertical, Pin, PinOff,
  Search, ShieldCheck, UserPlus, VideoOff, X,
} from 'lucide-react'
import { useRoomStore } from '../state/roomStore.js'
import DrawerShell from './DrawerShell.jsx'
import GuestBadge, { isGuestParticipant } from './GuestBadge.jsx'

function identityToUserId(identity) {
  if (!identity || !identity.startsWith('u:')) return null
  const n = Number(identity.slice(2))
  return Number.isFinite(n) ? n : null
}

const ROLE_LABEL = {
  host: 'Meeting host',
  co_host: 'Co-host',
  participant: 'Participant',
}

/**
 * Unified Google-Meet-style People panel (dark). Order:
 *   1. Waiting to join   — host/co-host only; card list with per-second timers,
 *      Admit / Reject / ⋯ per row, and a batch "Admit all" (confirm dialog).
 *   2. In the meeting    — LiveKit participants, host → co-host → everyone,
 *      raised hands bubbling within their tier.
 *
 * Waiting rows come from roomStore (authoritative WS list); actions are passed
 * in from the room because they own the REST calls + control WS.
 */
export default function ParticipantsPanel({
  selfUserId, isHost, isHostOrCohost, onClose, onPromote,
  onAdmit, onDeny, onAdmitAll, scrollWaitingSignal,
}) {
  const all = useParticipants()
  const waiting = useRoomStore((s) => s.waiting)
  const pinnedIdentity = useRoomStore((s) => s.pinnedIdentity)
  const togglePinned = useRoomStore((s) => s.togglePinned)
  const raisedHands = useRoomStore((s) => s.raisedHands)
  const roles = useRoomStore((s) => s.roles)

  const showWaiting = isHostOrCohost && waiting.length > 0

  const sorted = useMemo(() => {
    const rank = (p) => {
      const uid = identityToUserId(p.identity)
      const role = roles.get(uid) || 'participant'
      let base = role === 'host' ? 0 : role === 'co_host' ? 1 : 2
      if (uid != null && raisedHands.has(uid)) base -= 0.5
      return base
    }
    return [...all].sort((a, b) => rank(a) - rank(b) || a.name?.localeCompare(b.name || '') || 0)
  }, [all, roles, raisedHands])

  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q
    ? sorted.filter((p) => (p.name || p.identity || '').toLowerCase().includes(q))
    : sorted

  return (
    <DrawerShell title="People" count={sorted.length} onClose={onClose} bodyClassName="px-2 py-2">
      {showWaiting && (
        <WaitingSection
          waiting={waiting}
          onAdmit={onAdmit}
          onDeny={onDeny}
          onAdmitAll={onAdmitAll}
          scrollSignal={scrollWaitingSignal}
        />
      )}

      <div className="relative px-1 pb-1 pt-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className="w-full rounded-full border border-[#263244] bg-[#0B1220] py-2 pl-10 pr-8 text-[13px] text-white placeholder:text-[#64748B] outline-none transition focus:border-[#3B82F6]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-[#64748B] hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <SectionLabel>In the meeting · {sorted.length}</SectionLabel>
      <ul>
        {shown.length === 0 && (
          <li className="px-2 py-6 text-center text-[13px] text-[#64748B]">No people match “{query}”.</li>
        )}
        {shown.map((p) => (
          <ParticipantRow
            key={p.identity}
            participant={p}
            selfUserId={selfUserId}
            isHost={isHost}
            role={roles.get(identityToUserId(p.identity)) || 'participant'}
            raised={raisedHands.has(identityToUserId(p.identity))}
            pinned={pinnedIdentity === p.identity}
            onTogglePin={() => togglePinned(p.identity)}
            onPromote={onPromote}
          />
        ))}
      </ul>
    </DrawerShell>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
      {children}
    </div>
  )
}

/* ── Waiting to join ─────────────────────────────────────────────────────── */

function WaitingSection({ waiting, onAdmit, onDeny, onAdmitAll, scrollSignal }) {
  const [busy, setBusy] = useState(() => new Set())
  const [confirmAll, setConfirmAll] = useState(false)
  const ref = useRef(null)

  // Chip-driven "open People + scroll to waiting" — bump the signal to scroll.
  useEffect(() => {
    if (scrollSignal) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [scrollSignal])

  const runFor = useCallback((uid, fn) => {
    setBusy((prev) => (prev.has(uid) ? prev : new Set(prev).add(uid)))
    Promise.resolve(fn()).finally(() => {
      setBusy((prev) => {
        if (!prev.has(uid)) return prev
        const next = new Set(prev)
        next.delete(uid)
        return next
      })
    })
  }, [])

  // Stable per-id callbacks so memoized rows don't re-render when a sibling's
  // busy state flips or the timer ticks.
  const admitById = useCallback((uid) => runFor(uid, () => onAdmit(uid)), [runFor, onAdmit])
  const denyById = useCallback((uid) => runFor(uid, () => onDeny(uid)), [runFor, onDeny])

  return (
    <div ref={ref} className="mb-2 rounded-2xl border border-[#10B981]/25 bg-[#10B981]/[0.04] p-2">
      <div className="flex items-center justify-between px-1 pb-1.5 pt-0.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#34D399]">
          <UserPlus className="h-3.5 w-3.5" /> Waiting to join · {waiting.length}
        </span>
        {waiting.length > 1 && (
          <button
            type="button"
            onClick={() => setConfirmAll(true)}
            className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-[#34D399] transition hover:bg-[#10B981]/15"
          >
            Admit all
          </button>
        )}
      </div>

      <ul>
        <AnimatePresence initial={false}>
          {waiting.map((w) => (
            <WaitingGuestRow
              key={w.user_id}
              guest={w}
              busy={busy.has(w.user_id)}
              onAdmit={admitById}
              onDeny={denyById}
            />
          ))}
        </AnimatePresence>
      </ul>

      <AdmitAllDialog
        open={confirmAll}
        guests={waiting}
        onCancel={() => setConfirmAll(false)}
        onConfirm={onAdmitAll}
      />
    </div>
  )
}

const WaitingGuestRow = memo(function WaitingGuestRow({ guest, busy, onAdmit, onDeny }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const name = guest.name || 'Guest'
  const initial = name.slice(0, 1).toUpperCase()
  const uid = guest.user_id

  const admit = useCallback(() => onAdmit(uid), [onAdmit, uid])
  const confirmDeny = useCallback(() => {
    // ponytail: native confirm — one line, keyboard-accessible, no modal to trap.
    if (window.confirm(`Reject ${name}? They won’t be able to join.`)) onDeny(uid)
  }, [name, onDeny, uid])

  const copyInfo = useCallback(() => {
    const text = guest.email ? `${name} <${guest.email}>` : name
    navigator.clipboard?.writeText(text).catch(() => {})
    setMenuOpen(false)
  }, [guest.email, name])

  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.04]"
    >
      <div
        className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-[13px] font-semibold text-white"
        style={{ background: guest.color || '#7C3AED' }}
      >
        {guest.avatar_url ? <img src={guest.avatar_url} alt="" className="h-full w-full object-cover" /> : initial}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-white">{name}</span>
          {guest.is_guest && <GuestBadge />}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[#94A3B8]">
          {guest.email ? <span className="truncate">{guest.email}</span> : <WaitingTimer since={guest.joined_at} />}
        </div>
      </div>

      <button
        type="button"
        onClick={confirmDeny}
        disabled={busy}
        aria-label={`Reject ${name}`}
        title="Reject"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 text-[#94A3B8] shadow-none transition hover:bg-[#EF4444]/15 hover:text-[#F87171] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={admit}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-[#34D399] transition hover:bg-[#10B981]/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Admit'}
      </button>

      <RowMenu open={menuOpen} setOpen={setMenuOpen}>
        <MenuItem onClick={() => { setMenuOpen(false); admit() }}><Check className="h-3.5 w-3.5" /> Admit</MenuItem>
        <MenuItem onClick={() => { setMenuOpen(false); confirmDeny() }} destructive><X className="h-3.5 w-3.5" /> Reject</MenuItem>
        <MenuItem onClick={copyInfo}><Copy className="h-3.5 w-3.5" /> Copy guest info</MenuItem>
      </RowMenu>
    </motion.li>
  )
})

/** Live "Waiting Xs / X min" — its own leaf so the tick re-renders only here. */
const WaitingTimer = memo(function WaitingTimer({ since }) {
  const start = useMemo(() => (since ? new Date(since).getTime() : Date.now()), [since])
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((Date.now() - start) / 1000))
  const label = s < 60 ? `Waiting ${s} sec` : `Waiting ${Math.floor(s / 60)} min`
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Clock className="h-3 w-3" /> {label}
    </span>
  )
})

/* ── Row three-dot menu (Google-Meet style) ──────────────────────────────── */

function RowMenu({ open, setOpen, children }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, setOpen])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-8 w-8 place-items-center rounded-full border-0 bg-transparent p-0 text-[#94A3B8] shadow-none transition hover:bg-white/[0.08] hover:text-white"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-50 min-w-44 overflow-hidden rounded-xl border border-[#263244] bg-[#111827] py-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)]"
        >
          {children}
        </div>
      )}
    </div>
  )
}

function MenuItem({ onClick, destructive, children }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition ' +
        (destructive
          ? 'text-[#F87171] hover:bg-[#EF4444]/10'
          : 'text-[#E2E8F0] hover:bg-white/[0.06]')
      }
    >
      {children}
    </button>
  )
}

/* ── Admit-all confirmation dialog ───────────────────────────────────────── */

function AdmitAllDialog({ open, guests, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const panelRef = useRef(null)

  // Focus trap + Escape (Google-Meet style). Focus the confirm button on open,
  // cycle Tab within the dialog, restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return undefined
    const prev = document.activeElement
    const focusables = () => panelRef.current?.querySelectorAll('button:not([disabled])') || []
    setTimeout(() => { const f = focusables(); f[f.length - 1]?.focus() }, 0)
    const onKey = (e) => {
      if (e.key === 'Escape') { onCancel(); return }
      if (e.key !== 'Tab') return
      const f = Array.from(focusables())
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [open, onCancel])

  const confirm = useCallback(async () => {
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false); onCancel() }
  }, [onConfirm, onCancel])

  if (typeof document === 'undefined') return null
  const names = guests.map((g) => g.name || 'Guest')

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel}
          />
          <motion.div
            ref={panelRef}
            role="dialog" aria-modal="true" aria-label="Admit everyone waiting"
            initial={{ opacity: 0, scale: 0.95, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-[#263244] bg-[#111827] p-5 text-white shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)]"
          >
            <h2 className="text-[16px] font-semibold">Admit all?</h2>
            <p className="mt-1 text-[13px] text-[#94A3B8]">
              These {guests.length} guests will join the meeting.
            </p>

            <div className="mt-4 flex items-center">
              {guests.slice(0, 6).map((g, i) => (
                <span
                  key={g.user_id}
                  title={g.name}
                  className="grid h-9 w-9 place-items-center overflow-hidden rounded-full text-[13px] font-semibold text-white ring-2 ring-[#111827]"
                  style={{ background: g.color || '#7C3AED', marginLeft: i === 0 ? 0 : -8 }}
                >
                  {g.avatar_url ? <img src={g.avatar_url} alt="" className="h-full w-full object-cover" /> : (g.name || '?').slice(0, 1).toUpperCase()}
                </span>
              ))}
              {guests.length > 6 && (
                <span className="ml-2 text-[12px] text-[#94A3B8]">+{guests.length - 6} more</span>
              )}
            </div>
            <p className="mt-2 truncate text-[12px] text-[#64748B]">{names.slice(0, 4).join(', ')}{names.length > 4 ? '…' : ''}</p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button" onClick={onCancel} disabled={busy}
                className="inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold text-[#94A3B8] transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button" onClick={confirm} disabled={busy} aria-busy={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#10B981] px-4 text-[13px] font-semibold text-white transition hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Admitting…</> : 'Admit all'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ── In the meeting ──────────────────────────────────────────────────────── */

const ParticipantRow = memo(function ParticipantRow({
  participant, selfUserId, isHost, role, raised, pinned, onTogglePin, onPromote,
}) {
  const uid = identityToUserId(participant.identity)
  const isSelf = uid === selfUserId
  const isRowHost = role === 'host'
  const isRowCohost = role === 'co_host'

  const micPub = participant.getTrackPublication(Track.Source.Microphone)
  const camPub = participant.getTrackPublication(Track.Source.Camera)
  const micMuted = !micPub || micPub.isMuted
  const camOff = !camPub || camPub.isMuted

  const name = participant.name || participant.identity || 'Guest'
  const initial = name.slice(0, 1).toUpperCase()
  const isGuest = isGuestParticipant(participant)
  const avatarColor = pickColor(participant.identity || name)
  const canPromote = isHost && !isSelf && !isRowHost

  return (
    <li className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.04]">
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
        style={{ backgroundColor: avatarColor }}
      >{initial}</div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-white">
          <span className="truncate">{name}{isSelf && ' (you)'}</span>
          {isGuest && <GuestBadge />}
          {isRowHost && <Crown className="h-3 w-3 shrink-0 text-[#FBBF24]" title="Host" />}
          {isRowCohost && <ShieldCheck className="h-3 w-3 shrink-0 text-[#22D3EE]" title="Co-host" />}
          {raised && <Hand className="h-3 w-3 shrink-0 text-[#FBBF24]" title="Hand raised" />}
        </div>
        <div className="text-[11px] text-[#94A3B8]">{ROLE_LABEL[role]}</div>
      </div>

      <div className="flex w-12 shrink-0 items-center justify-end gap-1.5 text-[#64748B]">
        {micMuted && <MicOff className="h-3.5 w-3.5" />}
        {camOff && <VideoOff className="h-3.5 w-3.5" />}
      </div>

      <div className="flex w-22 shrink-0 items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
        <RowBtn onClick={onTogglePin} title={pinned ? 'Unpin' : 'Pin to main view'}>
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </RowBtn>
        {canPromote && (
          <RowBtn onClick={() => onPromote(uid)} title={isRowCohost ? 'Demote' : 'Make co-host'}>
            <UserPlus className="h-3.5 w-3.5" />
          </RowBtn>
        )}
      </div>
    </li>
  )
})

function RowBtn({ onClick, title, destructive, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        'grid h-7 w-7 place-items-center rounded-full border-0 bg-transparent p-0 shadow-none transition ' +
        (destructive
          ? 'text-[#F87171] hover:bg-[#EF4444]/15'
          : 'text-[#94A3B8] hover:bg-white/[0.08] hover:text-white')
      }
    >
      {children}
    </button>
  )
}

const COLORS = ['#7C3AED', '#2563EB', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#3B82F6', '#8B5CF6']
function pickColor(seed) {
  if (!seed) return COLORS[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}
