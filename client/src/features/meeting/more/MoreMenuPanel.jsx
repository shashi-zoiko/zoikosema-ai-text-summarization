import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../../lib/i18n.js'
import { useRoomStore } from '../state/roomStore.js'
import { resolveMenu } from './resolver.js'
import { useMenuGeometry } from './useMenuGeometry.js'
import { useViewControls } from './ViewControlsContext.jsx'
import { usePlatformViewState } from './usePlatformViewState.js'
import { makeViewActionHandler } from './viewActions.js'
import { makeMediaActionHandler } from './mediaActions.js'
import { makeDiagnosticsActionHandler } from './diagnosticsActions.js'
import { makeSupportActionHandler } from './supportActions.js'
import { makeWindowActionHandler } from './windowActions.js'
import { getMeetingWindowAdapter } from './windowAdapter.js'
import MoreMenuSection from './MoreMenuSection.jsx'
import PersonalControlItem from './PersonalControlItem.jsx'

/**
 * More Menu v2 panel (ZS-MTG-IMP-03 §6, §7.1, §20).
 *
 * Composition + geometry + accessibility + keyboard only — NO action execution
 * (adapters wire behavior in 03.4+). Consumes ONLY the resolver's grouped output;
 * never the registry. Two-column ≥1280px / single-column otherwise (§6.2), one
 * shared scroll container, WAI-ARIA menu semantics and roving-tabindex navigation
 * (§20.1).
 */
export default function MoreMenuPanel({ anchorRef, onRequestClose, onOpenDialog }) {
  const view = useViewControls()
  const platform = usePlatformViewState()
  // Native window capabilities from the single adapter selector (the one place
  // platform is detected). Menu code never imports/inspects Electron directly.
  const windowAdapter = getMeetingWindowAdapter()
  // Presenter availability: is shared content on stage? Read from the existing
  // room store — subscribed only while the menu is mounted.
  const presenting = useRoomStore((s) => s.presenting)

  // Feed the resolver the live view model + actual platform state — it remains the
  // single authority for checked/availability; the panel only renders its output.
  const inputs = useMemo(() => ({
    view: view
      ? {
          mode: view.mode,
          meetingCenterOpen: view.meetingCenterOpen,
          focus: view.focus,
          selfView: view.selfView,
          hasPresentable: presenting,
          fullscreen: platform.fullscreen,
          pip: platform.pip,
          pipSupported: platform.pipSupported,
        }
      : undefined,
    window: {
      keepOnTopSupported: windowAdapter.capabilities.keepOnTop,
      keepOnTopActive: false, // actual state arrives with native IPC (getWindowState)
      moveDisplaySupported: windowAdapter.capabilities.moveDisplay,
    },
  }), [view, platform, presenting, windowAdapter])

  const { sections } = useMemo(() => resolveMenu(inputs), [inputs])
  const onActivate = useMemo(() => {
    const viewHandler = makeViewActionHandler({ view, platform, close: onRequestClose })
    const mediaHandler = makeMediaActionHandler({ view, onOpenDialog, close: onRequestClose })
    const diagHandler = makeDiagnosticsActionHandler({ onOpenDialog, close: onRequestClose })
    const supportHandler = makeSupportActionHandler({ view, onOpenDialog, close: onRequestClose })
    const windowHandler = makeWindowActionHandler({ adapter: windowAdapter, close: onRequestClose })
    // Each handler no-ops for ids outside its section, so composing is safe.
    return (control) => {
      viewHandler(control); mediaHandler(control); diagHandler(control); supportHandler(control); windowHandler(control)
    }
  }, [view, platform, onRequestClose, onOpenDialog, windowAdapter])
  const { mode, style, setPanel } = useMenuGeometry(anchorRef)

  const visible = useMemo(() => sections.filter((s) => s.visible && s.items.length > 0), [sections])
  const leftSections = useMemo(() => visible.filter((s) => s.column === 'left').sort((a, b) => a.columnOrder - b.columnOrder), [visible])
  const rightSections = useMemo(() => visible.filter((s) => s.column === 'right').sort((a, b) => a.columnOrder - b.columnOrder), [visible])
  const singleSections = useMemo(() => [...visible].sort((a, b) => a.singleOrder - b.singleOrder), [visible])

  const columns = useMemo(() => (
    mode === 'two_column'
      ? { left: leftSections.flatMap((s) => s.items), right: rightSections.flatMap((s) => s.items) }
      : { single: singleSections.flatMap((s) => s.items) }
  ), [mode, leftSections, rightSections, singleSections])

  const itemRefs = useRef({ left: [], right: [], single: [] })
  const [active, setActive] = useState(() => ({ col: mode === 'two_column' ? 'left' : 'single', idx: 0 }))

  const focusAt = useCallback((col, idx) => {
    setActive({ col, idx })
    itemRefs.current[col]?.[idx]?.focus()
  }, [])

  // Focus the first item on open (and re-focus first if the column mode flips on
  // resize). Focus only — the item's onFocus re-syncs `active`. No setState here.
  useEffect(() => {
    const col = mode === 'two_column' ? 'left' : 'single'
    itemRefs.current[col]?.[0]?.focus()
  }, [mode])

  const onKeyDown = useCallback((e) => {
    const list = columns[active.col] || []
    if (!list.length) return
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(active.col, (active.idx + 1) % list.length); break
      case 'ArrowUp': e.preventDefault(); focusAt(active.col, (active.idx - 1 + list.length) % list.length); break
      case 'Home': e.preventDefault(); focusAt(active.col, 0); break
      case 'End': e.preventDefault(); focusAt(active.col, list.length - 1); break
      case 'ArrowRight': {
        if (mode !== 'two_column') break
        e.preventDefault()
        const target = columns.right || []
        if (target.length) focusAt('right', Math.min(active.idx, target.length - 1))
        break
      }
      case 'ArrowLeft': {
        if (mode !== 'two_column') break
        e.preventDefault()
        const target = columns.left || []
        if (target.length) focusAt('left', Math.min(active.idx, target.length - 1))
        break
      }
      case 'Tab':
        // Menus do not trap Tab — exit and let OverlayHost restore focus to More.
        e.preventDefault()
        onRequestClose?.()
        break
      default:
        break
    }
  }, [columns, active, mode, focusAt, onRequestClose])

  const renderColumn = (colKey, secs) => {
    let idx = -1
    return secs.map((section) => (
      <MoreMenuSection key={section.id} section={section}>
        {section.items.map((control) => {
          idx += 1
          const i = idx
          return (
            <PersonalControlItem
              key={control.id}
              control={control}
              ref={(el) => { itemRefs.current[colKey][i] = el }}
              tabIndex={active.col === colKey && active.idx === i ? 0 : -1}
              onFocus={() => setActive({ col: colKey, idx: i })}
              onActivate={onActivate}
            />
          )
        })}
      </MoreMenuSection>
    ))
  }

  return (
    <div
      ref={setPanel}
      id="meeting-more-panel"
      role="menu"
      aria-label={t('meeting.more.a11y.menu_label')}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      style={style}
      className="zk-glass zk-pop-in origin-bottom-right overflow-y-auto overscroll-contain rounded-2xl text-white shadow-2xl outline-none"
    >
      {mode === 'two_column' ? (
        <div className="flex gap-1 p-1">
          <div className="min-w-0 flex-1">{renderColumn('left', leftSections)}</div>
          <div aria-hidden className="w-px shrink-0 bg-white/10" />
          <div className="min-w-0 flex-1">{renderColumn('right', rightSections)}</div>
        </div>
      ) : (
        <div className="p-1">{renderColumn('single', singleSections)}</div>
      )}
    </div>
  )
}
