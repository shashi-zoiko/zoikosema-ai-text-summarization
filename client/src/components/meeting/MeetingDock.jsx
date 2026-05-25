import { memo, useEffect, useRef, useState } from 'react'
import {
  Disc, Grid3x3, Hand, LayoutPanelLeft, MessageSquare, Mic, MicOff,
  MonitorUp, MoreVertical, PhoneOff, Settings, Smile, Square, Users,
  Video, VideoOff, X,
} from 'lucide-react'

/**
 * Google-Meet-style floating dock.
 *
 * Primary row: Mic · Camera · Screen · Hand · Reactions · Chat · People · More · End call
 * Everything else (recording, layout toggle, settings) lives under More.
 */
function MeetingDock({
  clock, code,
  audioOn, toggleAudio,
  videoOn, toggleVideo,
  screenOn, screenshareEnabled, isHostOrCohost,
  showSharePicker, setShowSharePicker, startScreenShare, stopScreenShare,
  isRecording, startRecording, stopRecording,
  handRaised, toggleHand,
  showEmoji, setShowEmoji, sendReaction,
  layout, toggleLayout,
  sidebar, setSidebar,
  waitingList = [],
  leave,
}) {
  const [showMore, setShowMore] = useState(false)
  const sharingBlocked = !screenOn && !screenshareEnabled && !isHostOrCohost

  return (
    <footer className="relative z-30 flex h-[76px] shrink-0 items-center justify-between border-t border-white/5 bg-[#0f1217] px-4">
      {/* ── Left meta: clock + code ─────────────────────────────── */}
      <div className="hidden min-w-[180px] items-center gap-2 text-[13px] text-zinc-300 sm:flex">
        <span className="font-medium tabular-nums">{clock}</span>
        <span className="text-zinc-600">|</span>
        <span className="font-mono text-zinc-400">{code}</span>
      </div>

      {/* ── Center controls ─────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <DockButton
          label={audioOn ? 'Turn off microphone' : 'Turn on microphone'}
          onClick={toggleAudio}
          variant={audioOn ? 'neutral' : 'danger'}
          aria-pressed={!audioOn}
        >
          {audioOn ? <Mic /> : <MicOff />}
        </DockButton>

        <DockButton
          label={videoOn ? 'Turn off camera' : 'Turn on camera'}
          onClick={toggleVideo}
          variant={videoOn ? 'neutral' : 'danger'}
          aria-pressed={!videoOn}
        >
          {videoOn ? <Video /> : <VideoOff />}
        </DockButton>

        <div className="relative">
          <DockButton
            label={
              sharingBlocked ? 'Screen sharing disabled by host'
                : screenOn ? 'Stop presenting'
                : 'Present now'
            }
            onClick={screenOn ? stopScreenShare : () => setShowSharePicker(!showSharePicker)}
            disabled={sharingBlocked}
            variant={screenOn ? 'active' : 'neutral'}
            aria-pressed={screenOn}
          >
            <MonitorUp />
          </DockButton>
          {showSharePicker && !screenOn && (
            <SharePicker
              onClose={() => setShowSharePicker(false)}
              onPick={(mode) => { startScreenShare(mode); setShowSharePicker(false) }}
            />
          )}
        </div>

        <DockButton
          label={handRaised ? 'Lower hand' : 'Raise hand'}
          onClick={toggleHand}
          variant={handRaised ? 'active' : 'neutral'}
          aria-pressed={handRaised}
        >
          <Hand />
        </DockButton>

        <div className="relative">
          <DockButton
            label="Send a reaction"
            onClick={() => setShowEmoji(!showEmoji)}
            variant={showEmoji ? 'active' : 'neutral'}
            aria-pressed={showEmoji}
          >
            <Smile />
          </DockButton>
          {showEmoji && (
            <ReactionPicker
              onClose={() => setShowEmoji(false)}
              onPick={(e) => { sendReaction(e); setShowEmoji(false) }}
            />
          )}
        </div>

        <span className="mx-1 h-7 w-px bg-white/10" aria-hidden />

        <DockButton
          label={sidebar === 'chat' ? 'Close chat' : 'Open chat'}
          onClick={() => setSidebar((s) => (s === 'chat' ? null : 'chat'))}
          variant={sidebar === 'chat' ? 'active' : 'neutral'}
          aria-pressed={sidebar === 'chat'}
        >
          <MessageSquare />
        </DockButton>

        <div className="relative">
          <DockButton
            label="People"
            onClick={() => setSidebar((s) => (s === 'people' ? null : 'people'))}
            variant={sidebar === 'people' ? 'active' : 'neutral'}
            aria-pressed={sidebar === 'people'}
          >
            <Users />
          </DockButton>
          {waitingList.length > 0 && (
            <span
              aria-label={`${waitingList.length} waiting`}
              className="pointer-events-none absolute right-0 top-0 grid h-4 min-w-4 -translate-y-1 translate-x-1 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-zinc-900"
            >{waitingList.length}</span>
          )}
        </div>

        <MoreMenu
          open={showMore}
          setOpen={setShowMore}
          isRecording={isRecording}
          startRecording={startRecording}
          stopRecording={stopRecording}
          layout={layout}
          toggleLayout={toggleLayout}
          sidebar={sidebar}
          setSidebar={setSidebar}
        />

        <span className="mx-1 h-7 w-px bg-white/10" aria-hidden />

        <button
          onClick={leave}
          aria-label="Leave call"
          title="Leave call"
          className="grid h-12 w-16 place-items-center rounded-full bg-[#ea4335] text-white shadow-sm transition hover:bg-[#d33b2c] active:scale-95 [&_svg]:h-5 [&_svg]:w-5"
        >
          <PhoneOff />
        </button>
      </div>

      {/* ── Right side: balances center ─────────────────────────── */}
      <div className="hidden min-w-[180px] items-center justify-end gap-2 sm:flex" />
    </footer>
  )
}

export default memo(MeetingDock)

function DockButton({ variant = 'neutral', children, label, disabled, ...rest }) {
  const base = 'grid h-12 w-12 place-items-center rounded-full transition active:scale-95 [&_svg]:h-5 [&_svg]:w-5 disabled:opacity-40 disabled:cursor-not-allowed'
  const styles =
    variant === 'danger'  ? 'bg-[#ea4335] text-white hover:bg-[#d33b2c]'
    : variant === 'active' ? 'bg-[#8ab4f8] text-zinc-900 hover:bg-[#a8c7fa]'
    : 'bg-white/[0.06] text-zinc-100 hover:bg-white/[0.12]'
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`${base} ${styles}`}
      {...rest}
    >{children}</button>
  )
}

function MoreMenu({ open, setOpen, isRecording, startRecording, stopRecording, layout, toggleLayout, sidebar, setSidebar }) {
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open, setOpen])

  return (
    <div className="relative" ref={wrapRef}>
      <DockButton
        label="More options"
        onClick={() => setOpen(!open)}
        variant={open ? 'active' : 'neutral'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical />
      </DockButton>
      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+10px)] left-1/2 z-20 w-[240px] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#1f2227] py-1.5 shadow-2xl"
        >
          <MenuItem
            icon={isRecording ? <Square /> : <Disc />}
            label={isRecording ? 'Stop recording' : 'Start recording'}
            danger={isRecording}
            onClick={() => { (isRecording ? stopRecording : startRecording)(); setOpen(false) }}
          />
          <MenuItem
            icon={layout === 'grid' ? <LayoutPanelLeft /> : <Grid3x3 />}
            label={layout === 'grid' ? 'Speaker view' : 'Tiled view'}
            onClick={() => { toggleLayout(); setOpen(false) }}
          />
          <div aria-hidden className="my-1 mx-2 h-px bg-white/8" />
          <MenuItem
            icon={<Settings />}
            label={sidebar === 'settings' ? 'Close settings' : 'Settings'}
            active={sidebar === 'settings'}
            onClick={() => { setSidebar((s) => (s === 'settings' ? null : 'settings')); setOpen(false) }}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, label, active = false, danger = false, onClick }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={
        'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition ' +
        (danger
          ? 'text-[#ea4335] hover:bg-[#ea4335]/12'
          : active
            ? 'bg-[#8ab4f8]/15 text-[#8ab4f8]'
            : 'text-zinc-100 hover:bg-white/[0.06]')
      }
    >
      <span className="grid h-7 w-7 place-items-center text-current [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function SharePicker({ onClose, onPick }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        role="menu"
        className="absolute bottom-[calc(100%+10px)] left-1/2 z-20 w-[260px] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#1f2227] p-1.5 shadow-2xl"
      >
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Share your screen</span>
          <button onClick={onClose} aria-label="Close" className="grid h-6 w-6 place-items-center rounded text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ShareOption icon={<MonitorUp />} title="Your entire screen" onClick={() => onPick('screen')} />
        <ShareOption icon={<LayoutPanelLeft />} title="A window" onClick={() => onPick('window')} />
        <ShareOption icon={<Grid3x3 />} title="A tab" onClick={() => onPick('tab')} />
      </div>
    </>
  )
}

function ShareOption({ icon, title, onClick }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm text-zinc-100 transition hover:bg-white/[0.06]"
    >
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] text-zinc-300 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <span className="flex-1 truncate">{title}</span>
    </button>
  )
}

const EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🙏', '🔥', '😮']

function ReactionPicker({ onClose, onPick }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        role="menu"
        className="absolute bottom-[calc(100%+10px)] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-[#1f2227] p-1.5 shadow-2xl"
      >
        {EMOJIS.map((e) => (
          <button
            key={e}
            onClick={() => onPick(e)}
            className="grid h-10 w-10 place-items-center rounded-full text-xl transition hover:bg-white/[0.08]"
          >{e}</button>
        ))}
      </div>
    </>
  )
}
