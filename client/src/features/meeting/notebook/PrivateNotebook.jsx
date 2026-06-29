import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../../components/Icon'
import { cn } from '../../../lib/cn'
import RichNotes from './RichNotes'
import DrawingCanvas from './DrawingCanvas'
import { useNotebookPersistence } from './useNotebookPersistence'

// The participant's PRIVATE notebook: a resizable bottom panel with two tabs —
// rich-text Notes (TipTap) and a personal drawing Whiteboard. All state is local
// to this user and autosaved to the backend; nothing is shared with the room.

// Only surface save *problems* — routine "Saving…/Saved" is intentionally silent.
const STATUS_LABEL = {
  error: 'Offline · changes cached',
}

export default function PrivateNotebook({ code, userId, onClose }) {
  const { loaded, initialData, version, status, update, saveNow, remove } =
    useNotebookPersistence(code, userId)

  const [tab, setTab] = useState('notes') // 'notes' | 'whiteboard'
  const rootRef = useRef(null)
  const [panelPct, setPanelPct] = useState(55)
  const resizingRef = useRef(false)

  // Ctrl+S → save now (the editor's Ctrl+B/I/Z/Y are handled by TipTap itself).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        saveNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveNow])

  const startResize = useCallback((e) => {
    resizingRef.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }, [])
  const onResize = useCallback((e) => {
    if (!resizingRef.current) return
    const parent = rootRef.current?.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const pct = ((rect.bottom - e.clientY) / rect.height) * 100
    setPanelPct(Math.min(95, Math.max(25, pct)))
  }, [])
  const endResize = useCallback((e) => {
    resizingRef.current = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  const onDelete = useCallback(() => {
    if (window.confirm('Clear your private notebook for this meeting? This cannot be undone.')) {
      remove()
    }
  }, [remove])

  const toggleFull = useCallback(() => setPanelPct(p => (p >= 90 ? 55 : 95)), [])

  return (
    <div
      ref={rootRef}
      className="fade-in pointer-events-auto absolute inset-x-0 bottom-0 flex min-h-0 min-w-0 flex-col border-t border-line shadow-2xl"
      style={{ background: '#06060c', height: `${panelPct}%` }}
    >
      {/* Drag handle */}
      <div
        onPointerDown={startResize}
        onPointerMove={onResize}
        onPointerUp={endResize}
        className="group flex h-4 shrink-0 cursor-ns-resize touch-none items-center justify-center"
        style={{ background: 'rgba(15,15,23,0.9)' }}
        title="Drag to resize"
      >
        <div className="h-1 w-12 rounded-full bg-white/25 transition-colors group-hover:bg-white/45" />
      </div>

      {/* Header: tabs + status + actions */}
      <div
        className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2"
        style={{ background: 'rgba(15,15,23,0.9)' }}
      >
        <div className="flex items-center gap-1">
          <TabBtn active={tab === 'notes'} onClick={() => setTab('notes')}>
            <Icon name="type" size={15} /> Notes
          </TabBtn>
          <TabBtn active={tab === 'whiteboard'} onClick={() => setTab('whiteboard')}>
            <Icon name="pen" size={15} /> Whiteboard
          </TabBtn>
        </div>

        {status === 'error' && (
          <span className="ml-1 text-xs text-danger" aria-live="polite">
            {STATUS_LABEL.error}
          </span>
        )}

        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
          <Icon name="lock" size={11} /> Private
        </span>

        <div className="flex items-center gap-1">
          <ActionBtn onClick={saveNow} title="Save now (Ctrl+S)">
            <Icon name="download" size={15} /> <span className="hidden md:inline">Save</span>
          </ActionBtn>
          <ActionBtn onClick={onDelete} tone="danger" title="Clear notebook">
            <Icon name="trash" size={15} />
          </ActionBtn>
          <ActionBtn onClick={toggleFull} title={panelPct >= 90 ? 'Restore' : 'Maximize'}>
            <Icon name={panelPct >= 90 ? 'layout' : 'grid'} size={15} />
          </ActionBtn>
          <button
            onClick={onClose}
            title="Close notebook"
            className="grid h-8 w-8 place-items-center rounded-sm! border-0! bg-danger! p-0! text-white! shadow-none! transition hover:bg-[color-mix(in_srgb,var(--c-danger)_82%,black)]!"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>

      {/* Body — both tabs stay mounted (visibility toggled) so switching never
          remounts/loses in-session edits. They re-seed only when `version`
          changes (initial backend reconcile or a clear). */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!loaded ? (
          <div className="grid h-full w-full place-items-center text-sm text-fg-muted">
            Loading your notebook…
          </div>
        ) : (
          <>
            <div className={cn('absolute inset-0', tab !== 'notes' && 'hidden')}>
              <RichNotes
                key={`notes-${version}`}
                initialContent={initialData?.notes_json || null}
                onChange={(json) => update({ notes_json: json })}
              />
            </div>
            <div className={cn('absolute inset-0', tab !== 'whiteboard' && 'hidden')}>
              <DrawingCanvas
                key={`wb-${version}`}
                active={tab === 'whiteboard'}
                initialStrokes={initialData?.drawing_json?.strokes || []}
                viewport={initialData?.canvas_state?.viewport}
                onStrokesChange={(strokes) => update({ drawing_json: { strokes } })}
                onViewportChange={(viewport) => update({ canvas_state: { viewport } })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TabBtn({ children, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md! border-transparent! px-3 py-1.5 text-sm shadow-none! transition hover:translate-y-0!',
        active
          ? 'bg-[color-mix(in_srgb,var(--c-accent)_20%,transparent)]! text-accent!'
          : 'bg-transparent! text-fg-muted! hover:bg-white/8! hover:text-fg!'
      )}
    >
      {children}
    </button>
  )
}

function ActionBtn({ children, onClick, title, tone }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-sm! border-transparent! px-2 text-sm shadow-none! transition hover:translate-y-0!',
        tone === 'danger'
          ? 'bg-transparent! text-danger! hover:bg-[color-mix(in_srgb,var(--c-danger)_14%,transparent)]!'
          : 'bg-transparent! text-fg-muted! hover:bg-white/10! hover:text-fg!'
      )}
    >
      {children}
    </button>
  )
}
