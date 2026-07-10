import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useConnectionState, useLocalParticipant } from '@livekit/components-react'
import { ConnectionQuality, ConnectionState } from 'livekit-client'
import { Check, Copy, Info, Pencil, Star, UserPlus } from 'lucide-react'
import HostMenu from './HostMenu.jsx'
import { useRoomStore } from '../state/roomStore.js'
import { meetingShareText } from '../../../lib/meetingUrls.js'

/**
 * Sticky enterprise meeting header (64px). Dark, chromeless, information-dense:
 *
 *   ● Live  |  hss-jkvf-zeu  [REC] [Locked]      08:42  · Excellent · HD  Copy link  ⓘ  ⋯
 *
 * Lives inside <LiveKitRoom> so it can read live connection state + the local
 * participant's connection quality straight from the SFU.
 */
export default function MeetingHeader({
  code,
  ctrlConnected,
  recording,
  locked,
  joinedAt,
  isHostOrCohost,
  meeting,
  onLock,
  onChatEnabled,
  onScreenEnabled,
  onOpenInfo,
  onOpenPeople,
  onEdit = () => {},
}) {
  const state = useConnectionState()
  const reconnecting = state === ConnectionState.Reconnecting
  const connecting = state === ConnectionState.Connecting

  return (
    <header
      className="z-30 flex min-h-16 shrink-0 items-center justify-between gap-2 border-b border-[#263244] bg-[#0B1220]/85 px-3 py-2 backdrop-blur-md sm:gap-3 sm:px-5"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
      }}
    >
      {/* ── Left: live state + room id + status chips ───────────────────── */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-white">
          <span className="relative grid h-2 w-2 place-items-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10B981] opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#10B981]" />
          </span>
          Live
        </span>

        <span aria-hidden className="hidden h-4 w-px bg-[#263244] sm:block" />

        <span className="hidden truncate font-mono text-[13px] tracking-wide text-[#94A3B8] sm:inline">
          {code}
        </span>

        {recording && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EF4444]/15 px-2.5 py-1 text-[11px] font-semibold text-[#F87171]">
            <span className="relative grid h-1.5 w-1.5 place-items-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            REC
          </span>
        )}
        {locked && (
          <span className="hidden items-center gap-1.5 rounded-full bg-[#F59E0B]/15 px-2.5 py-1 text-[11px] font-semibold text-[#FBBF24] sm:inline-flex" title="Meeting is locked">
            🔒 Locked
          </span>
        )}
        {(reconnecting || (!ctrlConnected && !connecting)) && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F59E0B]/15 px-2.5 py-1 text-[11px] font-semibold text-[#FBBF24]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            Reconnecting…
          </span>
        )}
      </div>

      {/* ── Right: admit chip · duration · quality · HD · copy · info · host ─ */}
      <div className="flex items-center gap-2">
        {isHostOrCohost && <AdmitChip onClick={onOpenPeople} />}

        <div className="hidden items-center gap-2.5 rounded-full border border-[#263244] bg-[#111827] px-3 py-1.5 text-[12.5px] md:flex">
          <Duration joinedAt={joinedAt} />
          <span aria-hidden className="h-3.5 w-px bg-[#263244]" />
          <ConnectionQualityChip />
          <span aria-hidden className="h-3.5 w-px bg-[#263244]" />
          <span className="font-semibold tracking-wide text-[#34D399]">HD</span>
        </div>

        <CopyLinkButton code={code} />

        <button
          type="button"
          onClick={onOpenInfo}
          aria-label="Meeting details"
          title="Meeting details"
          className="grid h-9 w-9 place-items-center rounded-full border border-[#263244] bg-[#111827] text-[#94A3B8] transition hover:bg-[#1E293B] hover:text-white"
        >
          <Info className="h-4 w-4" />
        </button>

        {isHostOrCohost && (
          <HostMenu
            meeting={meeting}
            onToggleLock={onLock}
            onToggleChat={onChatEnabled}
            onToggleScreenshare={onScreenEnabled}
          />
        )}

        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit"
          title="Edit"
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 px-3 text-white shadow-sm transition hover:brightness-110"
        >
          <Pencil className="h-4 w-4" />
          <Star className="h-3 w-3 fill-current" />
        </button>
      </div>
    </header>
  )
}

/**
 * Google-Meet-style "Admit N guest(s)" pill (host/co-host). Reads the waiting
 * count straight from roomStore so it never re-renders the header on every
 * waiting change. Fades in when someone arrives, fades out at zero (no flash),
 * and the count slides on change. Click opens the People panel at the waiting
 * section.
 */
function AdmitChip({ onClick }) {
  const count = useRoomStore((s) => s.waiting.length)
  const label = `Admit ${count} ${count === 1 ? 'guest' : 'guests'}`
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.button
          type="button"
          onClick={onClick}
          aria-label={label}
          title={label}
          initial={{ opacity: 0, scale: 0.85, width: 0 }}
          animate={{ opacity: 1, scale: 1, width: 'auto' }}
          exit={{ opacity: 0, scale: 0.85, width: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full bg-[#10B981]/15 px-3.5 text-[13px] font-semibold text-[#34D399] ring-1 ring-[#10B981]/30 transition hover:bg-[#10B981]/25"
        >
          <UserPlus className="h-4 w-4 shrink-0" />
          <span>Admit</span>
          <span className="relative inline-flex tabular-nums">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={count}
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -8, opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {count}
              </motion.span>
            </AnimatePresence>
          </span>
          <span>{count === 1 ? 'guest' : 'guests'}</span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}

/** Live meeting duration counting up from the join time (mm:ss / h:mm:ss). */
function Duration({ joinedAt }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!joinedAt) return <span className="tabular-nums font-medium text-white">00:00</span>
  const s = Math.max(0, Math.floor((now - joinedAt) / 1000))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  const text = hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
  return <span className="tabular-nums font-medium text-white">{text}</span>
}

const QUALITY = {
  [ConnectionQuality.Excellent]: { label: 'Excellent', tone: '#34D399', bars: 3 },
  [ConnectionQuality.Good]: { label: 'Good', tone: '#34D399', bars: 2 },
  [ConnectionQuality.Poor]: { label: 'Poor', tone: '#FBBF24', bars: 1 },
  [ConnectionQuality.Lost]: { label: 'Lost', tone: '#F87171', bars: 0 },
}

/** Local connection-quality readout — signal bars + label. */
function ConnectionQualityChip() {
  const { localParticipant } = useLocalParticipant()
  const [q, setQ] = useState(localParticipant?.connectionQuality)
  useEffect(() => {
    if (!localParticipant) return undefined
    setQ(localParticipant.connectionQuality)
    const onChange = () => setQ(localParticipant.connectionQuality)
    localParticipant.on('connectionQualityChanged', onChange)
    return () => { localParticipant.off('connectionQualityChanged', onChange) }
  }, [localParticipant])

  const info = QUALITY[q] || { label: 'Connecting', tone: '#94A3B8', bars: 0 }
  return (
    <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: info.tone }} title={`Connection: ${info.label}`}>
      <span className="flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className="block w-[3px] rounded-sm"
            style={{
              height: `${i * 3 + 3}px`,
              background: i <= info.bars ? info.tone : '#334155',
            }}
          />
        ))}
      </span>
      {info.label}
    </span>
  )
}

function CopyLinkButton({ code }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meetingShareText(code))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked — ignore */ }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy invite link"
      aria-label="Copy invite link"
      className={
        'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition ' +
        (copied
          ? 'border-[#10B981]/40 bg-[#10B981]/15 text-[#34D399]'
          : 'border-[#263244] bg-[#111827] text-[#94A3B8] hover:bg-[#1E293B] hover:text-white')
      }
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy link'}</span>
    </button>
  )
}
