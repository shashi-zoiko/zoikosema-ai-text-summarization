import { memo, useEffect, useRef, useState } from 'react'
import {
  Captions, ChevronUp, Disc, Grid3x3, Hand, Info, LayoutPanelLeft,
  MessageSquare, Mic, MicOff, MonitorUp, MoreVertical, PhoneOff, Settings,
  Smile, Square, Users, Video, VideoOff, X,
} from 'lucide-react'

/**
 * Google Meet bottom dock.
 *
 * Layout (left | center | right):
 *   [time · code]                        [mic▾][cam▾] [share][cc][hand][emoji][⋮]  [📞 Leave]                        [info][chat]
 *
 * Visual references:
 *   neutral bg   #3c4043   (Meet's button surface)
 *   muted bg     #ea4335   (mic/cam off)
 *   active bg    #a8c7fa with #202124 text  (toggled on)
 *   leave bg     #ea4335   (always)
 *   stage bg     #202124   (matches the room background)
 *
 * Button anatomy:
 *   - Round controls are 44×44 (touch-friendly, matches Meet's hit target)
 *   - Mic/Cam are combo pills: left half = toggle, right half = caret →
 *     opens device picker. Together they read as one capsule.
 *   - Leave is a 56×96 red pill; phone icon is rotated 135° like Meet's.
 *
 * Props are intentionally a superset of what either room needs — both
 * MeetRoom (mesh) and MeetRoomLivekit feed the same dock so the UI is
 * consistent across the strangler-fig migration. Optional slots
 * (`extraCenterSlot`, `extraRightSlot`) let the LiveKit room hang extras
 * (recording, waiting room, whiteboard) without forking the component.
 */
function MeetingDock({
  clock, code,
  audioOn, toggleAudio, audioDeviceMenu,
  videoOn, toggleVideo, videoDeviceMenu,
  screenOn, screenshareEnabled = true, isHostOrCohost = false,
  showSharePicker, setShowSharePicker, startScreenShare, stopScreenShare,
  captionsOn = false, toggleCaptions,
  isRecording, startRecording, stopRecording,
  handRaised, toggleHand,
  showEmoji, setShowEmoji, sendReaction,
  layout, toggleLayout,
  sidebar, setSidebar,
  waitingList = [],
  onInfo,
  unreadChat = 0,
  extraCenterSlot,
  extraRightSlot,
  leave,
}) {
  const [showMore, setShowMore] = useState(false)
  const sharingBlocked = !screenOn && !screenshareEnabled && !isHostOrCohost

  return (
    <footer
      className="relative z-30 flex h-[80px] shrink-0 items-center justify-between bg-[#202124] px-4 sm:px-6"
      role="toolbar"
      aria-label="Meeting controls"
    >
      {/* ── Left: clock + code ───────────────────────────────────── */}
      <div className="hidden min-w-[200px] items-center gap-3 text-[14px] text-zinc-200 md:flex">
        <span className="font-normal tabular-nums">{clock}</span>
        <span className="text-zinc-500">|</span>
        <span className="text-zinc-300">{code}</span>
      </div>

      {/* ── Center controls ─────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <ComboPill
          on={audioOn}
          onToggle={toggleAudio}
          label={audioOn ? 'Turn off microphone' : 'Turn on microphone'}
          kbd="ctrl+d"
          deviceMenu={audioDeviceMenu}
          iconOn={<Mic />}
          iconOff={<MicOff />}
        />

        <ComboPill
          on={videoOn}
          onToggle={toggleVideo}
          label={videoOn ? 'Turn off camera' : 'Turn on camera'}
          kbd="ctrl+e"
          deviceMenu={videoDeviceMenu}
          iconOn={<Video />}
          iconOff={<VideoOff />}
        />

        <RoundBtn
          label={
            sharingBlocked ? 'Screen sharing disabled by host'
              : screenOn ? 'Stop presenting'
              : 'Present now'
          }
          onClick={screenOn ? stopScreenShare : () => setShowSharePicker?.(!showSharePicker)}
          disabled={sharingBlocked}
          active={screenOn}
          popoverOpen={showSharePicker && !screenOn}
          popover={
            <SharePicker
              onClose={() => setShowSharePicker(false)}
              onPick={(mode) => { startScreenShare(mode); setShowSharePicker(false) }}
            />
          }
        >
          <MonitorUp />
        </RoundBtn>

        {toggleCaptions && (
          <RoundBtn
            label={captionsOn ? 'Turn off captions' : 'Turn on captions'}
            onClick={toggleCaptions}
            active={captionsOn}
          >
            <Captions />
          </RoundBtn>
        )}

        <RoundBtn
          label={handRaised ? 'Lower hand' : 'Raise hand'}
          onClick={toggleHand}
          active={handRaised}
        >
          <Hand />
        </RoundBtn>

        <RoundBtn
          label="Send a reaction"
          onClick={() => setShowEmoji(!showEmoji)}
          active={showEmoji}
          popoverOpen={showEmoji}
          popover={
            <ReactionPicker
              onClose={() => setShowEmoji(false)}
              onPick={(e) => { sendReaction(e); setShowEmoji(false) }}
            />
          }
        >
          <Smile />
        </RoundBtn>

        {extraCenterSlot}

        <MoreMenu
          open={showMore}
          setOpen={setShowMore}
          isRecording={isRecording}
          startRecording={startRecording}
          stopRecording={stopRecording}
          isHostOrCohost={isHostOrCohost}
          layout={layout}
          toggleLayout={toggleLayout}
          sidebar={sidebar}
          setSidebar={setSidebar}
        />

        <LeaveBtn onClick={leave} />
      </div>

      {/* ── Right: info, people, chat ───────────────────────────── */}
      <div className="hidden min-w-[200px] items-center justify-end gap-1 md:flex">
        {extraRightSlot}
        {onInfo && (
          <SideIcon label="Meeting details" onClick={onInfo}>
            <Info />
          </SideIcon>
        )}
        <SideIcon
          label={sidebar === 'people' ? 'Close people' : 'People'}
          onClick={() => setSidebar((s) => (s === 'people' ? null : 'people'))}
          active={sidebar === 'people'}
          badge={waitingList.length || 0}
        >
          <Users />
        </SideIcon>
        <SideIcon
          label={sidebar === 'chat' ? 'Close chat' : 'Chat with everyone'}
          onClick={() => setSidebar((s) => (s === 'chat' ? null : 'chat'))}
          active={sidebar === 'chat'}
          badge={sidebar !== 'chat' ? unreadChat : 0}
        >
          <MessageSquare />
        </SideIcon>
      </div>
    </footer>
  )
}

export default memo(MeetingDock)

/* ────────────────────────────────────────────────────────────────────────
 * Mic / camera combo pill.
 *
 * Visually one capsule, two buttons. Left = the actual toggle; right = the
 * caret that opens the device picker. Skip the caret when no `deviceMenu`
 * is provided (mesh room has nothing to attach right now).
 * ──────────────────────────────────────────────────────────────────────── */

function ComboPill({ on, onToggle, label, deviceMenu, iconOn, iconOff, kbd }) {
  const [open, setOpen] = useState(false)
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
  }, [open])

  const colorOn  = 'bg-[#3c4043] hover:bg-[#4a4f55] text-white'
  const colorOff = 'bg-[#ea4335] hover:bg-[#f25c52] text-white'
  const palette = on ? colorOn : colorOff

  const hasMenu = !!deviceMenu

  return (
    <div ref={wrapRef} className="relative flex items-stretch">
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-pressed={!on}
        title={kbd ? `${label} (${kbd})` : label}
        className={
          'grid h-11 w-12 place-items-center transition active:scale-[0.97] ' +
          'rounded-full [&_svg]:h-5 [&_svg]:w-5 ' +
          (hasMenu ? '!rounded-r-md !rounded-l-full pl-1 w-12' : '') +
          ' ' + palette
        }
      >
        {on ? iconOn : iconOff}
      </button>
      {hasMenu && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={`${label} — device options`}
            aria-haspopup="menu"
            aria-expanded={open}
            className={
              'ml-px grid h-11 w-6 place-items-center transition active:scale-[0.97] ' +
              '!rounded-l-md !rounded-r-full pr-1 ' +
              '[&_svg]:h-4 [&_svg]:w-4 ' + palette
            }
          >
            <ChevronUp />
          </button>
          {open && (
            <div
              role="menu"
              className="absolute bottom-[calc(100%+10px)] left-0 z-20 w-[300px] overflow-hidden rounded-xl border border-white/8 bg-[#2a2c2f] py-1 text-zinc-100 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {typeof deviceMenu === 'function' ? deviceMenu({ close: () => setOpen(false) }) : deviceMenu}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * Round center button (share, captions, hand, emoji, more).
 * ──────────────────────────────────────────────────────────────────────── */

function RoundBtn({ active, disabled, onClick, label, children, popover, popoverOpen, ...rest }) {
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!popoverOpen) return
    const onKey = (e) => { if (e.key === 'Escape' && popover?.props?.onClose) popover.props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popoverOpen, popover])

  const palette = active
    ? 'bg-[#a8c7fa] text-[#202124] hover:bg-[#bdd5fc]'
    : 'bg-[#3c4043] text-white hover:bg-[#4a4f55]'

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        title={label}
        disabled={disabled}
        className={
          'grid h-11 w-11 place-items-center rounded-full transition active:scale-[0.97] ' +
          '[&_svg]:h-5 [&_svg]:w-5 disabled:opacity-40 disabled:cursor-not-allowed ' +
          palette
        }
        {...rest}
      >
        {children}
      </button>
      {popoverOpen && popover}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * Right-side icon button (info, people, chat).
 * Slightly smaller and unfilled by default — matches Meet's right cluster.
 * ──────────────────────────────────────────────────────────────────────── */

function SideIcon({ active, onClick, label, badge = 0, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={
        'relative grid h-10 w-10 place-items-center rounded-full transition active:scale-[0.97] ' +
        '[&_svg]:h-5 [&_svg]:w-5 ' +
        (active
          ? 'bg-[#a8c7fa]/15 text-[#a8c7fa] hover:bg-[#a8c7fa]/22'
          : 'text-zinc-200 hover:bg-white/[0.08]')
      }
    >
      {children}
      {badge > 0 && (
        <span
          aria-label={`${badge} unread`}
          className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#ea4335] px-1 text-[10px] font-bold leading-none text-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * Leave / hangup pill. Wider and rounder than a normal button — same
 * "phone tilted 135°" gesture Meet uses.
 * ──────────────────────────────────────────────────────────────────────── */

function LeaveBtn({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Leave call"
      title="Leave call"
      className="ml-1 grid h-11 w-[68px] place-items-center rounded-full bg-[#ea4335] text-white shadow-sm transition hover:bg-[#f25c52] active:scale-[0.97] [&_svg]:h-5 [&_svg]:w-5"
    >
      <PhoneOff className="rotate-[135deg]" />
    </button>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * Overflow menu — opens above the dock.
 * ──────────────────────────────────────────────────────────────────────── */

function MoreMenu({
  open, setOpen,
  isRecording, startRecording, stopRecording, isHostOrCohost,
  layout, toggleLayout,
  sidebar, setSidebar,
}) {
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

  const canRecord = isHostOrCohost && (startRecording || stopRecording)

  return (
    <div className="relative" ref={wrapRef}>
      <RoundBtn
        label="More options"
        onClick={() => setOpen(!open)}
        active={open}
      >
        <MoreVertical />
      </RoundBtn>
      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+10px)] left-1/2 z-20 w-[240px] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/8 bg-[#2a2c2f] py-1 shadow-2xl"
        >
          {canRecord && (
            <MenuItem
              icon={isRecording ? <Square /> : <Disc />}
              label={isRecording ? 'Stop recording' : 'Start recording'}
              danger={isRecording}
              onClick={() => { (isRecording ? stopRecording : startRecording)?.(); setOpen(false) }}
            />
          )}
          {toggleLayout && (
            <MenuItem
              icon={layout === 'grid' ? <LayoutPanelLeft /> : <Grid3x3 />}
              label={layout === 'grid' ? 'Speaker view' : 'Tiled view'}
              onClick={() => { toggleLayout(); setOpen(false) }}
            />
          )}
          {(canRecord || toggleLayout) && <div aria-hidden className="my-1 mx-2 h-px bg-white/8" />}
          <MenuItem
            icon={<Settings />}
            label={sidebar === 'settings' ? 'Close settings' : 'Settings'}
            active={sidebar === 'settings'}
            onClick={() => { setSidebar?.((s) => (s === 'settings' ? null : 'settings')); setOpen(false) }}
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
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center gap-3 px-3 py-2.5 text-left text-[14px] transition ' +
        (danger
          ? 'text-[#ea4335] hover:bg-[#ea4335]/12'
          : active
            ? 'bg-[#a8c7fa]/12 text-[#a8c7fa]'
            : 'text-zinc-100 hover:bg-white/[0.06]')
      }
    >
      <span className="grid h-6 w-6 place-items-center text-current [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * Share picker popover.
 * ──────────────────────────────────────────────────────────────────────── */

function SharePicker({ onClose, onPick }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        role="menu"
        className="absolute bottom-[calc(100%+10px)] left-1/2 z-20 w-[260px] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/8 bg-[#2a2c2f] p-1.5 shadow-2xl"
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

/* ────────────────────────────────────────────────────────────────────────
 * Reaction picker popover.
 * ──────────────────────────────────────────────────────────────────────── */

const EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🙏', '🔥', '😮']

function ReactionPicker({ onClose, onPick }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        role="menu"
        className="absolute bottom-[calc(100%+10px)] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/8 bg-[#2a2c2f] p-1.5 shadow-2xl"
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
