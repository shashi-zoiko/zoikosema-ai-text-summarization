import { useCallback, useEffect, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { useOverlayHost } from './OverlayHost.jsx'
import { registerMoreMenuStrings } from './strings.js'
import MoreMenuPanel from './MoreMenuPanel.jsx'
import SpeakerTestDialog from './SpeakerTestDialog.jsx'
import CameraPreviewDialog from './CameraPreviewDialog.jsx'
import ConnectionStatsDialog from './ConnectionStatsDialog.jsx'
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog.jsx'

/**
 * More Menu v2 root (ZS-MTG-IMP-03).
 *
 * Owns the dock trigger and opens/dismisses the menu THROUGH the shared
 * OverlayHost (never its own portal). Composition, geometry, accessibility and
 * navigation live in MoreMenuPanel; action wiring arrives in later phases.
 *
 * Rendered only when `meeting.more_v2` is ON — the dock falls back to the legacy
 * More menu otherwise.
 */

const OVERLAY_ID = 'meeting-more'

// Trigger palette mirrors the dock's RoundBtn (components/meeting/MeetingDock.jsx)
// so the v2 button reads as the same control. Kept local to avoid refactoring the
// dock during this infrastructure phase.
const BTN =
  'relative grid h-12 w-12 sm:h-[52px] sm:w-[52px] place-items-center rounded-full touch-manipulation transition-all duration-200 ' +
  'active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/45 ' +
  '[&_svg]:h-5 [&_svg]:w-5 sm:[&_svg]:h-[22px] sm:[&_svg]:w-[22px]'
const NEUTRAL =
  'bg-gradient-to-b from-white/[0.14] to-white/[0.05] text-[#CBD5E1] ring-1 ring-white/10 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_6px_16px_-8px_rgba(0,0,0,0.6)] ' +
  'hover:from-white/[0.22] hover:to-white/[0.09] hover:text-white'
const ACTIVE =
  'bg-gradient-to-b from-[#10B981]/30 to-[#059669]/12 text-[#6EE7B7] ring-1 ring-[#10B981]/50 ' +
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_18px_-2px_rgba(16,185,129,0.5)]'

export default function MoreMenuRoot() {
  const { openOverlay } = useOverlayHost()
  const btnRef = useRef(null)
  const handleRef = useRef(null) // { close } handle for the open menu overlay
  const [open, setOpen] = useState(false)
  // Bounded subflow dialogs (speaker test / camera preview / connection stats).
  // Hosted here — inside the LiveKit context and outliving the menu overlay — so
  // they reuse the existing media/stats session. Presented via the shared Modal,
  // not OverlayHost.
  const [activeDialog, setActiveDialog] = useState(null) // 'speaker_test' | 'camera_preview' | 'connection' | 'shortcuts' | null

  // Controlled i18n init: register the More-menu strings once when the v2 feature
  // mounts (flag ON), never as an import side effect. Idempotent.
  useEffect(() => { registerMoreMenuStrings() }, [])

  // Closing any subflow dialog returns focus to the More button (§6.3) — the
  // shared Modal doesn't restore focus to the invoking control on its own.
  const closeDialog = useCallback(() => {
    setActiveDialog(null)
    btnRef.current?.focus()
  }, [])

  const toggle = useCallback(() => {
    if (open) {
      handleRef.current?.close()
      return
    }
    handleRef.current = openOverlay({
      id: OVERLAY_ID,
      ignoreRef: btnRef,
      onClose: () => setOpen(false),
      render: ({ close }) => (
        <MoreMenuPanel anchorRef={btnRef} onRequestClose={close} onOpenDialog={setActiveDialog} />
      ),
    })
    setOpen(true)
  }, [open, openOverlay])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'meeting-more-panel' : undefined}
        aria-label="More options"
        title="More options"
        className={`${BTN} ${open ? ACTIVE : NEUTRAL}`}
      >
        <MoreVertical />
      </button>
      {activeDialog === 'speaker_test' && <SpeakerTestDialog onClose={closeDialog} />}
      {activeDialog === 'camera_preview' && <CameraPreviewDialog onClose={closeDialog} />}
      {activeDialog === 'connection' && <ConnectionStatsDialog onClose={closeDialog} />}
      {activeDialog === 'shortcuts' && <KeyboardShortcutsDialog onClose={closeDialog} />}
    </>
  )
}
