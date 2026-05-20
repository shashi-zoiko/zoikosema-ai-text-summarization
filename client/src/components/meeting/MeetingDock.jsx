import { AnimatePresence, motion } from 'framer-motion'
import {
  Bot, Captions, Crown, Disc, Grid3x3, Hand, LayoutPanelLeft, MessageSquareText,
  MonitorUp, Mic, MicOff, PenLine, PhoneOff, Settings, Smile, Square,
  Users, Video, VideoOff, Waves, Wand2, X,
} from 'lucide-react'
import IconButton from '../ui/IconButton'

/**
 * Floating glass meeting dock.
 *
 * Visual decisions:
 *  - All buttons are perfect circles (`shape="circle"`).
 *  - Active states use a neon-soft glow ring (driven by IconButton variants).
 *  - Hover lifts each button 2px and adds a subtle gradient halo.
 *  - The bar itself floats with a glass blur + heavy shadow so it reads as
 *    a separate plane above the video canvas.
 */
export default function MeetingDock({
  clock, code,
  audioOn, toggleAudio,
  videoOn, toggleVideo,
  screenOn, screenshareEnabled, isHostOrCohost,
  showSharePicker, setShowSharePicker, startScreenShare, stopScreenShare,
  isRecording, startRecording, stopRecording,
  bgMode, cycleBgMode,
  noiseSupp, toggleNoiseSuppression,
  handRaised, toggleHand,
  captionsSupported, captionsOn, toggleCaptions,
  showEmoji, setShowEmoji, sendReaction,
  showWhiteboard, setShowWhiteboard,
  anyoneSharing, showAnnotations, setShowAnnotations,
  layout, toggleLayout,
  sidebar, setSidebar,
  waitingList = [],
  onOpenHostMenu,
  leave,
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:px-6 sm:pb-5">
      {/* Bottom-left meta pill */}
      <div className="meet-meta-pill pointer-events-auto absolute bottom-3 left-3 hidden items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-medium md:flex sm:bottom-5 sm:left-6">
        <span className="tabular-nums">{clock}</span>
        <span className="meta-sep h-3 w-px" />
        <span className="mono opacity-75">{code}</span>
        {isRecording && (
          <>
            <span className="meta-sep h-3 w-px" />
            <span className="inline-flex items-center gap-1.5 text-[#e11d48] dark:text-[#fb7185]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
              </span>
              REC
            </span>
          </>
        )}
      </div>

      {/* Center dock */}
      <motion.div
        initial={{ y: 28, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { type: 'spring', stiffness: 320, damping: 28 } }}
        className="meet-dock pointer-events-auto relative flex items-center gap-1.5 rounded-full px-2 py-2"
      >
        {/* ambient inner gradient */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full opacity-50"
          style={{
            background:
              'radial-gradient(60% 80% at 50% 0%, color-mix(in srgb, var(--c-accent) 22%, transparent), transparent 70%)',
          }}
        />

        {/* Mic */}
        <IconButton
          size="lg"
          shape="circle"
          variant={audioOn ? 'glass' : 'toggleDanger'}
          label={audioOn ? 'Mute microphone' : 'Unmute microphone'}
          shortcut="⌘ D"
          onClick={toggleAudio}
        >
          {audioOn ? <Mic /> : <MicOff />}
        </IconButton>

        {/* Camera */}
        <IconButton
          size="lg"
          shape="circle"
          variant={videoOn ? 'glass' : 'toggleDanger'}
          label={videoOn ? 'Turn camera off' : 'Turn camera on'}
          shortcut="⌘ E"
          onClick={toggleVideo}
        >
          {videoOn ? <Video /> : <VideoOff />}
        </IconButton>

        <Divider />

        {/* Screen share */}
        <div className="relative">
          <IconButton
            size="lg"
            shape="circle"
            variant={screenOn ? 'toggleCyan' : 'glass'}
            disabled={!screenOn && !screenshareEnabled && !isHostOrCohost}
            onClick={screenOn ? stopScreenShare : () => setShowSharePicker(!showSharePicker)}
            label={
              !screenOn && !screenshareEnabled && !isHostOrCohost
                ? 'Sharing disabled by host'
                : screenOn ? 'Stop sharing' : 'Share screen'
            }
            shortcut="⌘ S"
          >
            <MonitorUp />
          </IconButton>
          <AnimatePresence>
            {showSharePicker && (
              <SharePicker
                onClose={() => setShowSharePicker(false)}
                onPick={(mode) => { startScreenShare(mode); setShowSharePicker(false) }}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Reactions */}
        <div className="relative">
          <IconButton
            size="lg"
            shape="circle"
            variant={showEmoji ? 'toggleOn' : 'glass'}
            onClick={() => setShowEmoji(!showEmoji)}
            label="Send a reaction"
          >
            <Smile />
          </IconButton>
          <AnimatePresence>
            {showEmoji && (
              <ReactionPicker onPick={(e) => { sendReaction(e); setShowEmoji(false) }} />
            )}
          </AnimatePresence>
        </div>

        {/* Hand */}
        <IconButton
          size="lg"
          shape="circle"
          variant={handRaised ? 'toggleOn' : 'glass'}
          onClick={toggleHand}
          label={handRaised ? 'Lower hand' : 'Raise hand'}
          shortcut="⌘ H"
        >
          <Hand />
        </IconButton>

        <Divider />

        {/* Captions */}
        {captionsSupported && (
          <IconButton
            size="lg"
            shape="circle"
            variant={captionsOn ? 'toggleOn' : 'glass'}
            onClick={toggleCaptions}
            label={captionsOn ? 'Turn off captions' : 'Turn on captions'}
            shortcut="⌘ C"
          >
            <Captions />
          </IconButton>
        )}

        {/* Background */}
        <IconButton
          size="lg"
          shape="circle"
          variant={bgMode !== 'none' ? 'toggleOn' : 'glass'}
          onClick={cycleBgMode}
          label={`Background: ${bgMode === 'none' ? 'off' : bgMode}`}
        >
          <Wand2 />
        </IconButton>

        {/* Noise suppression */}
        <IconButton
          size="lg"
          shape="circle"
          variant={noiseSupp ? 'toggleOn' : 'glass'}
          onClick={toggleNoiseSuppression}
          label={noiseSupp ? 'Noise suppression on' : 'Noise suppression off'}
        >
          <Waves />
        </IconButton>

        {/* Recording */}
        <div className="relative">
          <IconButton
            size="lg"
            shape="circle"
            variant={isRecording ? 'toggleDanger' : 'glass'}
            onClick={isRecording ? stopRecording : startRecording}
            label={isRecording ? 'Stop recording' : 'Start recording'}
          >
            {isRecording ? <Square /> : <Disc />}
          </IconButton>
          {isRecording && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full"
              animate={{ boxShadow: ['0 0 0 0 rgba(244,63,94,0.55)', '0 0 0 14px rgba(244,63,94,0)'] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
        </div>

        <Divider />

        {/* Whiteboard */}
        <IconButton
          size="lg"
          shape="circle"
          variant={showWhiteboard ? 'toggleOn' : 'glass'}
          onClick={() => { setShowWhiteboard(!showWhiteboard); if (!showWhiteboard) setShowAnnotations?.(false) }}
          label={showWhiteboard ? 'Close whiteboard' : 'Open whiteboard'}
        >
          <PenLine />
        </IconButton>

        {anyoneSharing && (
          <IconButton
            size="lg"
            shape="circle"
            variant={showAnnotations ? 'toggleOn' : 'glass'}
            onClick={() => { setShowAnnotations(!showAnnotations); if (!showAnnotations) setShowWhiteboard?.(false) }}
            label={showAnnotations ? 'Stop annotating' : 'Annotate the shared screen'}
          >
            <PenLine />
          </IconButton>
        )}

        {/* Layout */}
        <IconButton
          size="lg"
          shape="circle"
          variant={layout === 'speaker' ? 'toggleOn' : 'glass'}
          onClick={toggleLayout}
          label={layout === 'grid' ? 'Speaker view' : 'Grid view'}
        >
          {layout === 'grid' ? <LayoutPanelLeft /> : <Grid3x3 />}
        </IconButton>

        <Divider />

        {/* Chat panel */}
        <IconButton
          size="lg"
          shape="circle"
          variant={sidebar === 'chat' ? 'toggleOn' : 'glass'}
          onClick={() => setSidebar((s) => (s === 'chat' ? null : 'chat'))}
          label="Open chat"
        >
          <MessageSquareText />
        </IconButton>

        {/* Participants */}
        <div className="relative">
          <IconButton
            size="lg"
            shape="circle"
            variant={sidebar === 'people' ? 'toggleOn' : 'glass'}
            onClick={() => setSidebar((s) => (s === 'people' ? null : 'people'))}
            label="Participants"
          >
            <Users />
          </IconButton>
          {waitingList.length > 0 && (
            <span className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f59e0b] px-1 text-[10px] font-bold text-black shadow ring-2 ring-black/55">
              {waitingList.length}
            </span>
          )}
        </div>

        {/* AI assistant */}
        <IconButton
          size="lg"
          shape="circle"
          variant={sidebar === 'ai' ? 'toggleOn' : 'glass'}
          onClick={() => setSidebar((s) => (s === 'ai' ? null : 'ai'))}
          label="AI assistant"
        >
          <Bot />
        </IconButton>

        {/* Settings */}
        <IconButton
          size="lg"
          shape="circle"
          variant={sidebar === 'settings' ? 'toggleOn' : 'glass'}
          onClick={() => setSidebar((s) => (s === 'settings' ? null : 'settings'))}
          label="Settings"
        >
          <Settings />
        </IconButton>

        {/* Host menu */}
        {onOpenHostMenu && (
          <IconButton size="lg" shape="circle" variant="glass" onClick={onOpenHostMenu} label="Host controls">
            <Crown />
          </IconButton>
        )}

        <Divider />

        {/* Leave — pill, distinct color, magnetic */}
        <IconButton
          size="lg"
          shape="pill"
          variant="danger"
          onClick={leave}
          label="Leave meeting"
          shortcut="⌘ ⏎"
          className="!w-16"
        >
          <PhoneOff />
        </IconButton>
      </motion.div>
    </div>
  )
}

function Divider() {
  return <span aria-hidden className="meet-dock-divider mx-0.5 shrink-0" />
}

function SharePicker({ onClose, onPick }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <motion.div
        role="menu"
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="meet-popover absolute bottom-[120%] left-1/2 z-20 w-[280px] -translate-x-1/2 overflow-hidden rounded-2xl p-2"
      >
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--c-fg-muted)]">Share your screen</div>
          <button onClick={onClose} aria-label="Close" className="text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ShareOpt icon={<MonitorUp />} title="Entire screen" sub="Share everything on your display" onClick={() => onPick('screen')} />
        <ShareOpt icon={<LayoutPanelLeft />} title="Application window" sub="Share a specific app" onClick={() => onPick('window')} />
        <ShareOpt icon={<Grid3x3 />} title="Browser tab" sub="Share a single tab with audio" onClick={() => onPick('tab')} />
      </motion.div>
    </>
  )
}

function ShareOpt({ icon, title, sub, onClick }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition hover:bg-[var(--c-accent-soft)]"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--c-fg)_6%,transparent)] text-[var(--c-fg-dim)] transition group-hover:bg-[var(--c-accent-soft)] group-hover:text-[var(--c-accent)] group-hover:scale-110 [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[var(--c-fg)]">{title}</div>
        <div className="text-[11.5px] text-[var(--c-fg-muted)] leading-snug">{sub}</div>
      </div>
    </button>
  )
}

const EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🙏', '🔥', '😮']

function ReactionPicker({ onPick }) {
  return (
    <motion.div
      role="menu"
      initial={{ opacity: 0, y: 12, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.95 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="meet-popover absolute bottom-[120%] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5"
    >
      {EMOJIS.map((e, i) => (
        <motion.button
          key={e}
          initial={{ opacity: 0, y: 6, scale: 0.85 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { delay: i * 0.025, type: 'spring', stiffness: 480, damping: 22 } }}
          whileHover={{ y: -4, scale: 1.25, rotate: [-4, 4, 0] }}
          whileTap={{ scale: 0.9 }}
          onClick={() => onPick(e)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-[20px] transition hover:bg-[var(--c-accent-soft)]"
        >
          {e}
        </motion.button>
      ))}
    </motion.div>
  )
}
