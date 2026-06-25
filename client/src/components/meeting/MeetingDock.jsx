import { memo, useEffect, useRef, useState } from 'react'
import {
  ChevronUp, Disc, Grid3x3, Hand, Info, LayoutPanelLeft, Maximize, Minimize,
  MessageSquare, Mic, MicOff, MonitorUp, MonitorX, MoreVertical, Phone,
  Settings, Smile, Sparkles, Square, Users, Video, VideoOff,
} from 'lucide-react'
import Emoji from '../../features/emoji/Emoji'

/**
 * Meeting control dock — a single floating dark capsule centred over the stage.
 *
 * Sections (left → right), split by hairline dividers:
 *   mic · camera            mic/cam are solid green when live, red-tinted when off
 *   screen · hand · react   center actions glow green when active
 *   people · chat           panel toggles
 *   more · leave            overflow menu (record / layout / settings) + red leave
 *
 * Props are fed by MeetRoomLivekit's <LivekitDockAdapter>. Optional slots
 * (`extraCenterSlot`, `extraRightSlot`) let the room hang extras (whiteboard,
 * waiting-room) without forking the dock.
 */
function MeetingDock({
  audioOn, toggleAudio, audioDeviceMenu,
  videoOn, toggleVideo, videoDeviceMenu,
  screenOn, screenshareEnabled = true, isHostOrCohost = false,
  startScreenShare, stopScreenShare,
  isRecording, startRecording, stopRecording,
  handRaised, toggleHand,
  showEmoji, setShowEmoji, sendReaction,
  layout, toggleLayout,
  sidebar, setSidebar,
  unreadChat = 0,
  peopleBadge = 0,
  peopleAccent = 'emerald',
  openBackgrounds,
  onInfo,
  extraCenterSlot,
  extraRightSlot,
  leave,
}) {
  const [showMore, setShowMore] = useState(false)
  const sharingBlocked = !screenOn && !screenshareEnabled && !isHostOrCohost

  return (
    // One centred control group (Google-Meet style): mic/camera, the
    // collaboration actions, then leave — all together with tight, even
    // spacing. No overflow clipping anywhere — the reaction picker, device
    // menus and More menu all open ABOVE the bar as absolute children.
    <footer
      className="zk-dock-enter relative z-30 flex h-24 shrink-0 items-center justify-center px-4"
      role="toolbar"
      aria-label="Meeting controls"
    >
      <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
        {/* mic + camera (green-outlined when live), each with its own caret */}
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

        {/* present · hand · react · chat · people · more */}
        <RoundBtn
          label={sharingBlocked ? 'Screen sharing disabled by host' : screenOn ? 'Stop presenting' : 'Present now'}
          onClick={screenOn ? stopScreenShare : startScreenShare}
          disabled={sharingBlocked}
          active={screenOn}
          solid={screenOn}
        >
          {screenOn ? <MonitorX /> : <MonitorUp />}
        </RoundBtn>

        <RoundBtn label={handRaised ? 'Lower hand' : 'Raise hand'} onClick={toggleHand} active={handRaised}>
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

        <RoundBtn
          label={sidebar === 'chat' ? 'Close chat' : 'Chat with everyone'}
          onClick={() => setSidebar((s) => (s === 'chat' ? null : 'chat'))}
          active={sidebar === 'chat'}
          badge={sidebar !== 'chat' ? unreadChat : 0}
          accent="red"
          glow={sidebar !== 'chat' && unreadChat > 0}
        >
          <MessageSquare />
        </RoundBtn>
        <RoundBtn
          label={sidebar === 'people' ? 'Close people' : 'People'}
          onClick={() => setSidebar((s) => (s === 'people' ? null : 'people'))}
          active={sidebar === 'people'}
          badge={sidebar !== 'people' ? peopleBadge : 0}
          accent={peopleAccent}
          glow={sidebar !== 'people' && peopleBadge > 0}
        >
          <Users />
        </RoundBtn>

        {extraRightSlot}

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
          openBackgrounds={openBackgrounds}
          onInfo={onInfo}
        />

        {/* leave — a touch of separation from the cluster, like Meet */}
        <span aria-hidden className="w-1.5" />
        <LeaveBtn onClick={leave} />
      </div>
    </footer>
  )
}

export default memo(MeetingDock)

/* ────────────────────────────────────────────────────────────────────────
 * Shared button shell + dark palettes.
 * ──────────────────────────────────────────────────────────────────────── */

const BTN =
  'relative grid h-[52px] w-[52px] place-items-center rounded-full transition-all duration-200 ' +
  'active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/45 ' +
  '[&_svg]:h-[22px] [&_svg]:w-[22px] [&_svg]:relative [&_svg]:z-10'

// Every palette is a soft top-down gradient + inner highlight + outer glow so
// the dock reads like a premium SaaS control bar (Meet / Around / Slack huddle)
// rather than flat translucent chips.
const NEUTRAL =
  'bg-gradient-to-b from-white/[0.14] to-white/[0.05] text-[#CBD5E1] ring-1 ring-white/10 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_16px_-8px_rgba(0,0,0,0.6)] ' +
  'hover:from-white/[0.22] hover:to-white/[0.09] hover:text-white ' +
  'hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_24px_-8px_rgba(0,0,0,0.65)]'
const ACTIVE =
  'bg-gradient-to-b from-[#10B981]/30 to-[#059669]/12 text-[#6EE7B7] ring-1 ring-[#10B981]/50 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_18px_-2px_rgba(16,185,129,0.5)]'
const SOLID =
  'bg-gradient-to-b from-[#34D399] to-[#059669] text-white ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_0_24px_-2px_rgba(16,185,129,0.75),0_8px_22px_-8px_rgba(16,185,129,0.6)] ' +
  'hover:from-[#10B981] hover:to-[#047857]'
const OFF =
  'bg-gradient-to-b from-[#F87171]/30 to-[#B91C1C]/14 text-[#FCA5A5] ring-1 ring-[#EF4444]/55 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_0_18px_-2px_rgba(239,68,68,0.5)] ' +
  'hover:from-[#F87171]/42 hover:to-[#B91C1C]/22 hover:text-[#FECACA]'
// Mic / camera "live" look — a glowing green-rimmed gradient on a dark interior.
const LIVE =
  'bg-gradient-to-b from-[#10B981]/26 to-[#059669]/10 text-[#6EE7B7] ring-1 ring-[#10B981]/60 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_0_18px_-3px_rgba(16,185,129,0.55)] ' +
  'hover:from-[#10B981]/36 hover:to-[#059669]/18'

/* Mic / camera combo: a round toggle (solid green on, red-tint off) + a slim
 * caret that opens the device picker. The caret is omitted with no `deviceMenu`. */
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

  return (
    <div ref={wrapRef} className="relative flex items-center">
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-pressed={!on}
        title={kbd ? `${label} (${kbd})` : label}
        className={`${BTN} ${on ? LIVE : OFF}`}
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
              'ml-0.5 grid h-[52px] w-5 place-items-center rounded-full text-[#94A3B8] transition ' +
              'hover:bg-white/[0.08] hover:text-white [&_svg]:h-4 [&_svg]:w-4 ' +
              (open ? 'bg-white/[0.08] text-white' : '')
            }
          >
            <ChevronUp className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
          {open && (
            <div
              role="menu"
              className="zk-glass zk-pop-in absolute bottom-[calc(100%+14px)] left-0 z-20 w-[300px] origin-bottom-left overflow-hidden rounded-2xl py-1 text-white"
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

/* Accent palettes for the floating badge + button glow. The glow colour is fed
 * to the `zk-unread-glow` keyframe through the `--zk-glow` "R G B" custom prop so
 * one animation serves every colour (chat → red, people → emerald, hand → amber). */
const BADGE_ACCENT = {
  red:     { rgb: '239 68 68',  bg: 'bg-[#EF4444]', ring: 'ring-[#EF4444]/55', shadow: 'shadow-[0_0_20px_rgba(239,68,68,0.45)]' },
  emerald: { rgb: '16 185 129', bg: 'bg-[#10B981]', ring: 'ring-[#10B981]/55', shadow: 'shadow-[0_0_20px_rgba(16,185,129,0.45)]' },
  amber:   { rgb: '245 158 11', bg: 'bg-[#F59E0B]', ring: 'ring-[#F59E0B]/55', shadow: 'shadow-[0_0_20px_rgba(245,158,11,0.45)]' },
}

/* Round center button (present, hand, react, people, chat, more). */
function RoundBtn({ active, solid, danger, disabled, glow = false, accent = 'red', onClick, label, badge = 0, children, popover, popoverOpen, ...rest }) {
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!popoverOpen) return
    const onKey = (e) => { if (e.key === 'Escape' && popover?.props?.onClose) popover.props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popoverOpen, popover])

  const acc = BADGE_ACCENT[accent] || BADGE_ACCENT.red
  const palette = danger ? OFF : solid ? SOLID : active ? ACTIVE : NEUTRAL
  // Unread/attention state — soft accent halo + ring so the icon is impossible
  // to miss without shouting. Suppressed while the button is active (panel open).
  const showGlow = glow && !active
  const glowCls = showGlow ? `zk-unread-glow ring-1 ${acc.ring}` : ''
  // Append the live count to the label so screen readers announce "3 unread".
  const a11yLabel = badge > 0 ? `${label}, ${badge} unread` : label

  return (
    // When a badge is present the wrapper is lifted above its neighbours so the
    // next dock button (later in the DOM) can't paint over the badge's edge —
    // that overlap was what made the counter look like a clipped half-circle.
    <div ref={wrapRef} className={'relative' + (badge > 0 ? ' z-20' : '')}>
      <button
        type="button"
        onClick={onClick}
        aria-label={a11yLabel}
        aria-pressed={active}
        title={label}
        disabled={disabled}
        style={showGlow ? { '--zk-glow': acc.rgb } : undefined}
        className={`${BTN} ${palette} ${glowCls} disabled:opacity-40 disabled:cursor-not-allowed`}
        {...rest}
      >
        {children}
      </button>
      {/* Floating counter — a FULL circle seated on the top-right corner, outside
          the button (Messenger / iOS style). Rendered as a sibling of the button
          (not a child) so the dark 2px ring reads as a separate chip and nothing
          can crop it. Scale-pulses to grab attention. */}
      {badge > 0 && (
        <span
          aria-hidden
          className={
            'zk-badge-pop pointer-events-none absolute -right-1.5 -top-1.5 z-30 grid h-6 min-w-6 ' +
            'place-items-center rounded-full border-2 border-[#0B1220] px-1.5 text-[12px] font-bold ' +
            `leading-none text-white ${acc.bg} ${acc.shadow}`
          }
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {popoverOpen && popover}
    </div>
  )
}

/* Leave / hangup — solid red pill with the Google-Meet "call_end" handset
 * (a plain receiver tilted 135°, not a slashed phone). */
function LeaveBtn({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Leave call"
      title="Leave call"
      className={
        'inline-flex h-[52px] items-center gap-2 rounded-xl bg-gradient-to-b from-[#F87171] to-[#DC2626] px-5 text-[15px] font-semibold text-white transition-all duration-200 ' +
        'hover:from-[#EF4444] hover:to-[#B91C1C] active:scale-[0.96] ' +
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_0_26px_-4px_rgba(239,68,68,0.8),0_10px_26px_-8px_rgba(239,68,68,0.7)] ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EF4444]/50 [&_svg]:h-5 [&_svg]:w-5'
      }
    >
      <Phone className="rotate-135" fill="currentColor" stroke="none" />
      Leave
    </button>
  )
}

/* Overflow menu — Google-Meet-style "More options". Holds every secondary
 * action (record, layout, full screen, backgrounds & effects, meeting details,
 * settings) so the dock itself stays to the core controls. Opens above the dock. */
function MoreMenu({ open, setOpen, isRecording, startRecording, stopRecording, isHostOrCohost, layout, toggleLayout, sidebar, setSidebar, openBackgrounds, onInfo }) {
  const wrapRef = useRef(null)
  const [isFs, setIsFs] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)

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

  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.()
      else document.documentElement.requestFullscreen?.()
    } catch { /* fullscreen blocked — ignore */ }
  }

  const canRecord = isHostOrCohost && (startRecording || stopRecording)

  return (
    <div className="relative" ref={wrapRef}>
      <RoundBtn label="More options" onClick={() => setOpen(!open)} active={open}>
        <MoreVertical />
      </RoundBtn>
      {open && (
        <div className="absolute bottom-[calc(100%+14px)] right-0 z-20">
          <div role="menu" className="zk-glass zk-pop-in w-[268px] origin-bottom-right overflow-hidden rounded-2xl py-1.5">
            {canRecord && (
              <>
                <MenuItem
                  icon={isRecording ? <Square /> : <Disc />}
                  label={isRecording ? 'Stop recording' : 'Start recording'}
                  danger={isRecording}
                  onClick={() => { (isRecording ? stopRecording : startRecording)?.(); setOpen(false) }}
                />
                <Sep />
              </>
            )}
            {toggleLayout && (
              <MenuItem
                icon={layout === 'grid' ? <LayoutPanelLeft /> : <Grid3x3 />}
                label={layout === 'grid' ? 'Speaker view' : 'Tiled view'}
                onClick={() => { toggleLayout(); setOpen(false) }}
              />
            )}
            <MenuItem
              icon={isFs ? <Minimize /> : <Maximize />}
              label={isFs ? 'Exit full screen' : 'Full screen'}
              onClick={() => { toggleFullscreen(); setOpen(false) }}
            />
            {openBackgrounds && (
              <MenuItem
                icon={<Sparkles />}
                label="Backgrounds and effects"
                onClick={() => { openBackgrounds(); setOpen(false) }}
              />
            )}
            <Sep />
            {onInfo && (
              <MenuItem
                icon={<Info />}
                label="Meeting details"
                onClick={() => { onInfo(); setOpen(false) }}
              />
            )}
            <MenuItem
              icon={<Settings />}
              label="Settings"
              active={sidebar === 'settings'}
              onClick={() => { setSidebar?.((s) => (s === 'settings' ? null : 'settings')); setOpen(false) }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Sep() {
  return <div aria-hidden className="my-1.5 mx-3 h-px bg-[#263244]" />
}

function MenuItem({ icon, label, active = false, danger = false, onClick }) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center gap-3.5 px-4 py-2.5 text-left text-[14px] transition-colors ' +
        (danger
          ? 'text-[#F87171] hover:bg-[#EF4444]/12'
          : active
            ? 'bg-[#10B981]/15 text-[#34D399]'
            : 'text-white/90 hover:bg-white/[0.06]')
      }
    >
      <span className="grid h-6 w-6 place-items-center text-current [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

/* Reaction picker popover — dark glass pill, springy emoji. */
const EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🙏', '🔥', '😮']

function ReactionPicker({ onClose, onPick }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-[calc(100%+16px)] left-1/2 z-20 -translate-x-1/2">
        <div role="menu" className="zk-glass zk-pop-in flex items-center gap-0.5 rounded-full px-2 py-1.5">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => onPick(e)}
              aria-label={`React with ${e}`}
              className="grid h-11 w-11 origin-bottom place-items-center !rounded-full !border-0 !bg-transparent !p-0 !shadow-none transition-transform duration-150 hover:!bg-white/[0.08] hover:-translate-y-1 hover:scale-125"
            ><Emoji char={e} size="26px" /></button>
          ))}
        </div>
      </div>
    </>
  )
}
