import { memo, useEffect, useRef, useState } from 'react'
import {
  Captions, ChevronUp, Disc, Grid3x3, Hand, Info, LayoutPanelLeft,
  MessageSquare, Mic, MicOff, MonitorUp, MonitorX, MoreVertical, PhoneOff,
  Settings, Smile, Square, Users, Video, VideoOff,
} from 'lucide-react'

/**
 * Meeting bottom dock — elevated light theme, floating glass capsule.
 *
 * Controls live in one frosted-glass capsule (`.zk-dock`) that hovers over the
 * ambient stage. Buttons are 52×52 circles with MEANINGFUL colour states:
 *   mic        green when live, red when muted
 *   camera     blue when on,    red when off
 *   present    purple gradient + glow while sharing
 *   raise hand cyan when raised
 *   reactions  amber when the picker is open
 *   captions / more   neutral glass → Meet-blue when active
 *   leave      red gradient pill, larger than the rest, hover lift
 *
 * Every control lifts on hover and settles on press (`.zk-press`). Mic/camera
 * carry a slim caret that opens the device picker; a hairline divider sets the
 * Leave button apart. Clock/code (left) and people/chat (right) collapse on
 * small screens so the capsule stays centred.
 *
 * Props are a superset of what either room needs — MeetRoom (mesh) and
 * MeetRoomLivekit feed the same dock. Optional slots (`extraCenterSlot`,
 * `extraRightSlot`) let the LiveKit room hang extras without forking.
 */
function MeetingDock({
  clock, code,
  audioOn, toggleAudio, audioDeviceMenu,
  videoOn, toggleVideo, videoDeviceMenu,
  screenOn, screenshareEnabled = true, isHostOrCohost = false,
  startScreenShare, stopScreenShare,
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
      className="relative z-30 grid h-[96px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 bg-transparent px-3 sm:px-5"
      role="toolbar"
      aria-label="Meeting controls"
    >
      {/* ── Left: clock + code ───────────────────────────────────── */}
      <div className="hidden items-center gap-2.5 text-[13.5px] text-[#5f6368] md:flex">
        <span className="font-medium tabular-nums">{clock}</span>
        <span className="text-[#bcc0c6]">|</span>
        <span className="text-[#444746]">{code}</span>
      </div>

      {/* ── Center: floating glass capsule ───────────────────────── */}
      <div className="zk-dock zk-dock-enter flex items-center justify-self-center gap-1 rounded-[26px] p-2">
        <ComboPill
          on={audioOn}
          tone="mic"
          onToggle={toggleAudio}
          label={audioOn ? 'Turn off microphone' : 'Turn on microphone'}
          kbd="ctrl+d"
          deviceMenu={audioDeviceMenu}
          iconOn={<Mic />}
          iconOff={<MicOff />}
        />

        <ComboPill
          on={videoOn}
          tone="cam"
          onToggle={toggleVideo}
          label={videoOn ? 'Turn off camera' : 'Turn on camera'}
          kbd="ctrl+e"
          deviceMenu={videoDeviceMenu}
          iconOn={<Video />}
          iconOff={<VideoOff />}
        />

        {/* Present now → straight to the browser-native share dialog. While
            presenting this glows purple; the icon flips to "stop". */}
        <RoundBtn
          label={
            sharingBlocked ? 'Screen sharing disabled by host'
              : screenOn ? 'Stop presenting'
              : 'Present now'
          }
          onClick={screenOn ? stopScreenShare : startScreenShare}
          disabled={sharingBlocked}
          active={screenOn}
          tone="share"
        >
          {screenOn ? <MonitorX /> : <MonitorUp />}
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
          tone="hand"
        >
          <Hand />
        </RoundBtn>

        <RoundBtn
          label="Send a reaction"
          onClick={() => setShowEmoji(!showEmoji)}
          active={showEmoji}
          tone="react"
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

        {/* Hairline divider, then Leave. */}
        <span aria-hidden className="mx-1.5 h-9 w-px rounded-full bg-black/10" />
        <LeaveBtn onClick={leave} />
      </div>

      {/* ── Right: info, people, chat ───────────────────────────── */}
      <div className="hidden items-center justify-self-end gap-1.5 md:flex">
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
 * Shared button shell + colour palettes. Every control reads as one material;
 * the palette layers meaning on top. `.zk-press` gives the hover-lift / press.
 * ──────────────────────────────────────────────────────────────────────── */

const BTN =
  'zk-press relative grid h-[52px] w-[52px] place-items-center rounded-full ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white ' +
  '[&_svg]:h-[22px] [&_svg]:w-[22px]'

const BTN_NEUTRAL = 'text-[#444746] hover:bg-black/[0.06] hover:text-[#1f1f1f]'
const BTN_ACTIVE  = 'bg-[#c2e7ff] text-[#001d35] hover:bg-[#aed6fb] shadow-[0_0_0_1px_rgba(26,115,232,0.18),0_6px_16px_-8px_rgba(26,115,232,0.5)]'

// Mic live → green; off → red tint. Camera on → blue; off → red tint.
const BTN_MIC = 'bg-emerald-500/[0.14] text-emerald-700 hover:bg-emerald-500/[0.22] shadow-[0_0_0_1px_rgba(16,163,74,0.22),0_6px_18px_-8px_rgba(16,163,74,0.5)]'
const BTN_CAM = 'bg-blue-600/[0.13] text-blue-700 hover:bg-blue-600/[0.2] shadow-[0_0_0_1px_rgba(37,99,235,0.22),0_6px_18px_-8px_rgba(37,99,235,0.5)]'
const BTN_OFF = 'bg-[#ea4335]/[0.14] text-[#d93829] hover:bg-[#ea4335]/[0.22] shadow-[0_0_0_1px_rgba(234,67,53,0.24),0_6px_18px_-8px_rgba(234,67,53,0.5)]'

// Tone palettes for the round center buttons when active.
const BTN_SHARE = 'bg-gradient-to-b from-violet-500 to-violet-600 text-white hover:from-violet-500 hover:to-violet-700 shadow-[0_0_0_1px_rgba(124,58,237,0.35),0_10px_26px_-8px_rgba(124,58,237,0.7)]'
const BTN_HAND  = 'bg-cyan-500/[0.16] text-cyan-700 hover:bg-cyan-500/[0.24] shadow-[0_0_0_1px_rgba(8,145,178,0.24),0_6px_18px_-8px_rgba(8,145,178,0.5)]'
const BTN_REACT = 'bg-amber-500/[0.18] text-amber-700 hover:bg-amber-500/[0.26] shadow-[0_0_0_1px_rgba(217,119,6,0.26),0_6px_18px_-8px_rgba(217,119,6,0.5)]'

/* ────────────────────────────────────────────────────────────────────────
 * Mic / camera combo: a round toggle + a slim caret (device picker).
 * The caret is omitted when no `deviceMenu` is provided.
 * ──────────────────────────────────────────────────────────────────────── */

function ComboPill({ on, tone, onToggle, label, deviceMenu, iconOn, iconOff, kbd }) {
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

  const hasMenu = !!deviceMenu
  const palette = on ? (tone === 'cam' ? BTN_CAM : BTN_MIC) : BTN_OFF

  return (
    <div ref={wrapRef} className="relative flex items-center">
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-pressed={!on}
        title={kbd ? `${label} (${kbd})` : label}
        className={`${BTN} ${palette}`}
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
            title="Device options"
            className={
              'zk-press ml-0.5 grid h-[52px] w-6 place-items-center rounded-full text-[#5f6368] ' +
              'hover:bg-black/[0.06] hover:text-[#1f1f1f] [&_svg]:h-4 [&_svg]:w-4 ' +
              (open ? 'bg-black/[0.06] text-[#1f1f1f]' : '')
            }
          >
            <ChevronUp className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
          {open && (
            <div
              role="menu"
              className="zk-glass zk-pop-in absolute bottom-[calc(100%+14px)] left-0 z-20 w-[300px] origin-bottom-left overflow-hidden rounded-2xl border border-black/[0.06] py-1 text-[#202124]"
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
 * Round center button (present, captions, hand, emoji, more). `tone` picks
 * the active-state palette: share→purple, hand→cyan, react→amber, else Meet
 * blue.
 * ──────────────────────────────────────────────────────────────────────── */

function RoundBtn({ active, tone, danger, disabled, onClick, label, children, popover, popoverOpen, ...rest }) {
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!popoverOpen) return
    const onKey = (e) => { if (e.key === 'Escape' && popover?.props?.onClose) popover.props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popoverOpen, popover])

  const activePalette = danger ? BTN_OFF
    : tone === 'share' ? BTN_SHARE
    : tone === 'hand' ? BTN_HAND
    : tone === 'react' ? BTN_REACT
    : BTN_ACTIVE
  const palette = active ? activePalette : BTN_NEUTRAL

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        title={label}
        disabled={disabled}
        className={`${BTN} ${palette} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:translate-y-0`}
        {...rest}
      >
        {children}
      </button>
      {popoverOpen && popover}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * Right-side icon button (info, people, chat) — frosted glass chip.
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
        'zk-press relative grid h-[52px] w-[52px] place-items-center rounded-full border border-white/70 ' +
        'shadow-[0_6px_18px_-10px_rgba(15,23,42,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]/45 ' +
        '[&_svg]:h-[22px] [&_svg]:w-[22px] backdrop-blur-xl ' +
        (active
          ? 'bg-[#c2e7ff] text-[#001d35] hover:bg-[#aed6fb]'
          : 'bg-white/80 text-[#444746] hover:bg-white hover:text-[#1f1f1f]')
      }
    >
      {children}
      {badge > 0 && (
        <span
          aria-label={`${badge} unread`}
          className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#ea4335] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * Leave / hangup — red gradient pill, larger, phone tilted 135° like Meet.
 * ──────────────────────────────────────────────────────────────────────── */

function LeaveBtn({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Leave call"
      title="Leave call"
      className={
        'zk-press grid h-[52px] w-[72px] place-items-center rounded-full text-white ' +
        'bg-gradient-to-b from-[#f0584c] to-[#d93829] hover:from-[#f0584c] hover:to-[#c5301f] ' +
        'shadow-[0_10px_26px_-8px_rgba(234,67,53,0.8),inset_0_1px_0_rgba(255,255,255,0.25)] ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ea4335]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white [&_svg]:h-[22px] [&_svg]:w-[22px]'
      }
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
        <div className="absolute bottom-[calc(100%+14px)] left-1/2 z-20 -translate-x-1/2">
        <div
          role="menu"
          className="zk-glass zk-pop-in w-[240px] origin-bottom overflow-hidden rounded-2xl border border-black/[0.06] py-1"
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
          {(canRecord || toggleLayout) && <div aria-hidden className="my-1 mx-2 h-px bg-black/[0.06]" />}
          <MenuItem
            icon={<Settings />}
            label={sidebar === 'settings' ? 'Close settings' : 'Settings'}
            active={sidebar === 'settings'}
            onClick={() => { setSidebar?.((s) => (s === 'settings' ? null : 'settings')); setOpen(false) }}
          />
        </div>
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
        'flex w-full items-center gap-3 px-3 py-2.5 text-left text-[14px] transition-colors ' +
        (danger
          ? 'text-[#d93829] hover:bg-[#ea4335]/10'
          : active
            ? 'bg-[#c2e7ff]/45 text-[#0b57d0]'
            : 'text-[#202124] hover:bg-black/[0.05]')
      }
    >
      <span className="grid h-6 w-6 place-items-center text-current [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * Reaction picker popover — glass pill, pop-in, springy emoji.
 * ──────────────────────────────────────────────────────────────────────── */

const EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🙏', '🔥', '😮']

function ReactionPicker({ onClose, onPick }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-[calc(100%+14px)] left-1/2 z-20 -translate-x-1/2">
        <div
          role="menu"
          className="zk-glass zk-pop-in flex items-center gap-1 rounded-full border border-black/[0.06] p-1.5"
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => onPick(e)}
              className="zk-press grid h-10 w-10 place-items-center rounded-full text-xl hover:bg-black/[0.06] hover:scale-110"
            >{e}</button>
          ))}
        </div>
      </div>
    </>
  )
}
