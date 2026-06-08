import { memo, useEffect, useRef, useState } from 'react'
import {
  Captions, ChevronUp, Disc, Grid3x3, Hand, Info, LayoutPanelLeft,
  MessageSquare, Mic, MicOff, MonitorUp, MonitorX, MoreVertical, PhoneOff,
  Settings, Smile, Square, Users, Video, VideoOff,
} from 'lucide-react'

/**
 * Meeting bottom dock — light theme, floating capsule.
 *
 * Controls live in one floating white capsule that hovers over the (light)
 * stage. Buttons are large 52×52 circles — flush (transparent on the capsule,
 * filling on hover) like Meet / Teams / Zoom — with crisp dark icons. Mic and
 * camera each carry a slim caret that opens the device picker; a hairline
 * divider sets the red Leave button apart on the right. The clock/code (left)
 * and people/chat (right) sit as quiet side clusters and collapse on small
 * screens so the capsule stays centred.
 *
 * Design tokens (single, light theme — no dark variant):
 *   capsule       white/85 + blur, hairline ring, soft elevation
 *   button        flush transparent → black/6 on hover, ink-grey icon
 *   active         Meet selected blue  (#c2e7ff / #001d35)
 *   muted/off     solid red (#ea4335) — the one safety signal we keep
 *   leave         solid red pill, phone tilted 135°
 *
 * Props are a superset of what either room needs — MeetRoom (mesh) and
 * MeetRoomLivekit feed the same dock. Optional slots (`extraCenterSlot`,
 * `extraRightSlot`) let the LiveKit room hang extras (recording, waiting room,
 * whiteboard) without forking the component.
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
      className="relative z-30 grid h-[92px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 bg-transparent px-3 sm:px-5"
      role="toolbar"
      aria-label="Meeting controls"
    >
      {/* ── Left: clock + code ───────────────────────────────────── */}
      <div className="hidden items-center gap-2.5 text-[13.5px] text-[#5f6368] md:flex">
        <span className="font-medium tabular-nums">{clock}</span>
        <span className="text-[#9aa0a6]">|</span>
        <span className="text-[#444746]">{code}</span>
      </div>

      {/* ── Center: floating capsule ─────────────────────────────── */}
      <div
        className={
          'flex items-center justify-self-center gap-1 rounded-full border border-black/[0.06] bg-white/85 p-2 ' +
          'backdrop-blur-xl backdrop-saturate-150 ' +
          'shadow-[0_14px_38px_-12px_rgba(0,0,0,0.28),0_2px_6px_-2px_rgba(0,0,0,0.12)]'
        }
      >
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

        {/* Present now → straight to the browser-native share dialog. While
            presenting this turns red as "Stop presenting". */}
        <RoundBtn
          label={
            sharingBlocked ? 'Screen sharing disabled by host'
              : screenOn ? 'Stop presenting'
              : 'Present now'
          }
          onClick={screenOn ? stopScreenShare : startScreenShare}
          disabled={sharingBlocked}
          active={screenOn}
          danger={screenOn}
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

        {/* Hairline divider, then Leave. */}
        <span aria-hidden className="mx-1.5 h-8 w-px rounded-full bg-black/10" />
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
 * Shared button class strings — every control in the capsule reads as one
 * material. `BTN` is the 52px round shell; the palettes layer on top.
 * ──────────────────────────────────────────────────────────────────────── */

const BTN =
  'relative grid h-[52px] w-[52px] place-items-center rounded-full ' +
  'transition-[background,color,box-shadow,transform] duration-150 active:scale-[0.94] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]/45 ' +
  '[&_svg]:h-[22px] [&_svg]:w-[22px]'

const BTN_NEUTRAL = 'text-[#444746] hover:bg-black/[0.06] hover:text-[#1f1f1f]'
const BTN_ACTIVE  = 'bg-[#c2e7ff] text-[#001d35] hover:bg-[#aed6fb]'
const BTN_DANGER  = 'bg-[#ea4335] text-white shadow-[0_4px_12px_-4px_rgba(234,67,53,0.6)] hover:bg-[#d93829]'

/* ────────────────────────────────────────────────────────────────────────
 * Mic / camera combo: a round toggle + a slim caret (device picker).
 * The caret is omitted when no `deviceMenu` is provided.
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

  const hasMenu = !!deviceMenu
  const palette = on ? BTN_NEUTRAL : BTN_DANGER

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
              'ml-0.5 grid h-[52px] w-6 place-items-center rounded-full text-[#5f6368] transition ' +
              'hover:bg-black/[0.06] hover:text-[#1f1f1f] active:scale-95 [&_svg]:h-4 [&_svg]:w-4 ' +
              (open ? 'bg-black/[0.06] text-[#1f1f1f]' : '')
            }
          >
            <ChevronUp />
          </button>
          {open && (
            <div
              role="menu"
              className="absolute bottom-[calc(100%+14px)] left-0 z-20 w-[300px] overflow-hidden rounded-2xl border border-black/[0.06] bg-white py-1 text-[#202124] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)]"
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
 * Round center button (present, captions, hand, emoji, more).
 * ──────────────────────────────────────────────────────────────────────── */

function RoundBtn({ active, danger, disabled, onClick, label, children, popover, popoverOpen, ...rest }) {
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!popoverOpen) return
    const onKey = (e) => { if (e.key === 'Escape' && popover?.props?.onClose) popover.props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popoverOpen, popover])

  const palette = danger ? BTN_DANGER : active ? BTN_ACTIVE : BTN_NEUTRAL

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        title={label}
        disabled={disabled}
        className={`${BTN} ${palette} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
        {...rest}
      >
        {children}
      </button>
      {popoverOpen && popover}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * Right-side icon button (info, people, chat) — matches the capsule buttons.
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
        'relative grid h-[52px] w-[52px] place-items-center rounded-full border border-black/[0.06] transition active:scale-[0.94] ' +
        'shadow-[0_2px_8px_-3px_rgba(0,0,0,0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]/45 ' +
        '[&_svg]:h-[22px] [&_svg]:w-[22px] ' +
        (active
          ? 'bg-[#c2e7ff] text-[#001d35] hover:bg-[#aed6fb]'
          : 'bg-white/85 text-[#444746] backdrop-blur-xl hover:bg-white hover:text-[#1f1f1f]')
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
 * Leave / hangup — solid red pill, phone tilted 135° like Meet.
 * ──────────────────────────────────────────────────────────────────────── */

function LeaveBtn({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Leave call"
      title="Leave call"
      className={
        'grid h-[52px] w-[64px] place-items-center rounded-full bg-[#ea4335] text-white transition ' +
        'shadow-[0_8px_20px_-6px_rgba(234,67,53,0.7)] hover:bg-[#d93829] active:scale-[0.94] ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ea4335]/50 [&_svg]:h-[22px] [&_svg]:w-[22px]'
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
        <div
          role="menu"
          className="absolute bottom-[calc(100%+14px)] left-1/2 z-20 w-[240px] -translate-x-1/2 overflow-hidden rounded-2xl border border-black/[0.06] bg-white py-1 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)]"
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
 * Reaction picker popover.
 * ──────────────────────────────────────────────────────────────────────── */

const EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🙏', '🔥', '😮']

function ReactionPicker({ onClose, onPick }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div
        role="menu"
        className="absolute bottom-[calc(100%+14px)] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-black/[0.06] bg-white p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)]"
      >
        {EMOJIS.map((e) => (
          <button
            key={e}
            onClick={() => onPick(e)}
            className="grid h-10 w-10 place-items-center rounded-full text-xl transition hover:bg-black/[0.06] active:scale-95"
          >{e}</button>
        ))}
      </div>
    </>
  )
}
