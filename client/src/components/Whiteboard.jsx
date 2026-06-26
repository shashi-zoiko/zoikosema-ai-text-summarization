import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { cn } from '../lib/cn'

const COLORS = ['#ffffff', '#ef4f6b', '#fbbf24', '#34d399', '#7c8cff', '#f472b6', '#38bdf8', '#a78bfa']
const STROKE_SIZES = [2, 4, 8, 14]

// Document-style text: modest size that scales gently with the stroke size.
const textFontSize = (size) => Math.max(16, (size || 4) * 4)
const TEXT_PAD = 10 // px inset of the text editor from the canvas edges
const TOOLS = [
  { id: 'pen', icon: 'pen', label: 'Draw' },
  { id: 'line', icon: 'minus', label: 'Line' },
  { id: 'rect', icon: 'square', label: 'Rectangle' },
  { id: 'circle', icon: 'circle', label: 'Circle' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow' },
  { id: 'text', icon: 'type', label: 'Text' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
]

export default function Whiteboard({ onDraw, remoteStrokes, onClose }) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#ffffff')
  const [strokeSize, setStrokeSize] = useState(4)
  const [isDrawing, setIsDrawing] = useState(false)
  const [strokes, setStrokes] = useState([])       // completed strokes for undo
  const [undoneStrokes, setUndoneStrokes] = useState([]) // for redo
  const currentStrokeRef = useRef(null)
  const startPosRef = useRef(null)
  const [showColors, setShowColors] = useState(false)
  const [showSizes, setShowSizes] = useState(false)
  const [textInput, setTextInput] = useState(null)  // { x, y } when placing text
  const [editingText, setEditingText] = useState('') // initial value of the text editor
  const textareaRef = useRef(null)
  const editingOrigRef = useRef(null) // original text stroke being re-edited (for restore on cancel)
  const editorClosedRef = useRef(false) // guard so the unmount blur doesn't re-fire after Esc
  const rootRef = useRef(null)
  const [panelPct, setPanelPct] = useState(50) // panel height as % of the stage — opens half-screen
  const resizingRef = useRef(false)
  const strokesRef = useRef(strokes)
  useEffect(() => { strokesRef.current = strokes }, [strokes])

  const getCanvasPos = useCallback((e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    }
  }, [])

  const toPixel = useCallback((pos) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: (pos.x / 100) * rect.width, y: (pos.y / 100) * rect.height }
  }, [])

  const drawStroke = useCallback((stroke) => {
    const ctx = ctxRef.current
    if (!ctx) return

    ctx.save()
    ctx.strokeStyle = stroke.tool === 'eraser' ? '#06060c' : stroke.color
    ctx.fillStyle = stroke.color
    ctx.lineWidth = stroke.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (stroke.tool === 'pen' || stroke.tool === 'eraser') {
      if (stroke.points.length < 2) { ctx.restore(); return }
      ctx.beginPath()
      const p0 = toPixel(stroke.points[0])
      ctx.moveTo(p0.x, p0.y)
      for (let i = 1; i < stroke.points.length; i++) {
        const p = toPixel(stroke.points[i])
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    } else if (stroke.tool === 'line') {
      const p0 = toPixel(stroke.points[0])
      const p1 = toPixel(stroke.points[1])
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
    } else if (stroke.tool === 'arrow') {
      const p0 = toPixel(stroke.points[0])
      const p1 = toPixel(stroke.points[1])
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
      // Arrowhead
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x)
      const headLen = 12 + stroke.size
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p1.x - headLen * Math.cos(angle - 0.4), p1.y - headLen * Math.sin(angle - 0.4))
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p1.x - headLen * Math.cos(angle + 0.4), p1.y - headLen * Math.sin(angle + 0.4))
      ctx.stroke()
    } else if (stroke.tool === 'rect') {
      const p0 = toPixel(stroke.points[0])
      const p1 = toPixel(stroke.points[1])
      ctx.beginPath()
      ctx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y)
      ctx.stroke()
    } else if (stroke.tool === 'circle') {
      const p0 = toPixel(stroke.points[0])
      const p1 = toPixel(stroke.points[1])
      const rx = Math.abs(p1.x - p0.x) / 2
      const ry = Math.abs(p1.y - p0.y) / 2
      const cx = (p0.x + p1.x) / 2
      const cy = (p0.y + p1.y) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (stroke.tool === 'text') {
      const p = toPixel(stroke.points[0])
      const fontSize = stroke.fontSize || textFontSize(stroke.size)
      ctx.font = `${fontSize}px system-ui, sans-serif`
      ctx.textBaseline = 'top'
      const canvas = canvasRef.current
      const rectW = canvas ? canvas.getBoundingClientRect().width : 0
      const maxW = Math.max(40, rectW - p.x - TEXT_PAD) // wrap to the right edge
      const lh = fontSize * 1.35
      let y = p.y
      for (const para of String(stroke.text).split('\n')) {
        let line = ''
        for (const word of para.split(' ')) {
          const test = line ? `${line} ${word}` : word
          if (line && ctx.measureText(test).width > maxW) {
            ctx.fillText(line, p.x, y)
            y += lh
            line = word
          } else {
            line = test
          }
        }
        ctx.fillText(line, p.x, y)
        y += lh
      }
    }

    ctx.restore()
  }, [toPixel])

  const redrawAll = useCallback((allStrokes) => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    for (const s of allStrokes) drawStroke(s)
  }, [drawStroke])

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctxRef.current = ctx
    redrawAll([])
  }, [redrawAll])

  // Keep the canvas backing store in sync with its rendered size — covers both
  // window resizes and the panel being dragged taller/shorter.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctxRef.current = ctx
      redrawAll(strokesRef.current)
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [redrawAll])

  // Render remote strokes — mirror inbound prop into local state so undo/redo
  // and resize redraws treat them the same as locally-drawn strokes.
  useEffect(() => {
    if (!remoteStrokes?.length) return
    const last = remoteStrokes[remoteStrokes.length - 1]
    if (last) {
      drawStroke(last)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStrokes(prev => [...prev, last])
    }
  }, [remoteStrokes, drawStroke])

  const commitStroke = useCallback((stroke) => {
    setStrokes(prev => [...prev, stroke])
    setUndoneStrokes([])
    if (onDraw) onDraw(stroke)
  }, [onDraw])

  // Measure a committed text stroke's on-screen box (mirrors drawStroke's wrapping)
  // so we can hit-test clicks against it.
  const measureTextStroke = useCallback((stroke) => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return null
    const p = toPixel(stroke.points[0])
    const fontSize = stroke.fontSize || textFontSize(stroke.size)
    ctx.save()
    ctx.font = `${fontSize}px system-ui, sans-serif`
    const rectW = canvas.getBoundingClientRect().width
    const maxW = Math.max(40, rectW - p.x - TEXT_PAD)
    const lh = fontSize * 1.35
    let lines = 0
    let widest = 0
    for (const para of String(stroke.text).split('\n')) {
      let line = ''
      for (const word of para.split(' ')) {
        const test = line ? `${line} ${word}` : word
        if (line && ctx.measureText(test).width > maxW) {
          widest = Math.max(widest, ctx.measureText(line).width)
          lines++
          line = word
        } else { line = test }
      }
      widest = Math.max(widest, ctx.measureText(line).width)
      lines++
    }
    ctx.restore()
    return { x: p.x, y: p.y, w: Math.min(maxW, widest), h: lines * lh }
  }, [toPixel])

  // Open a fresh text editor at the top-left of the canvas (Word/Notepad page).
  const openTextEditor = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    editingOrigRef.current = null
    setEditingText('')
    setTextInput({
      x: (TEXT_PAD / rect.width) * 100,
      y: (TEXT_PAD / rect.height) * 100,
    })
  }, [])

  // Clicking the canvas with the text tool: re-edit the clicked text in place
  // (like Word), else start a new text block where you clicked.
  const handleCanvasClick = useCallback((e) => {
    if (tool !== 'text') return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i]
      if (s.tool !== 'text') continue
      const b = measureTextStroke(s)
      if (!b) continue
      if (cx >= b.x - 12 && cx <= b.x + b.w + 16 && cy >= b.y - 6 && cy <= b.y + b.h + 6) {
        editingOrigRef.current = s
        setColor(s.color)
        setStrokeSize(s.size)
        setEditingText(String(s.text))
        setTextInput(s.points[0])
        setStrokes(prev => { const u = prev.filter((_, idx) => idx !== i); redrawAll(u); return u })
        return
      }
    }
    editingOrigRef.current = null
    setEditingText('')
    setTextInput(getCanvasPos(e))
  }, [tool, strokes, measureTextStroke, getCanvasPos, redrawAll])

  const handlePointerDown = useCallback((e) => {
    if (tool === 'text') return   // text is handled by the editor, not drawing
    setIsDrawing(true)
    const pos = getCanvasPos(e)
    startPosRef.current = pos
    currentStrokeRef.current = {
      tool,
      color,
      size: strokeSize,
      points: [pos],
    }
  }, [tool, color, strokeSize, getCanvasPos])

  const handlePointerMove = useCallback((e) => {
    if (!isDrawing || !currentStrokeRef.current) return
    const pos = getCanvasPos(e)

    if (tool === 'pen' || tool === 'eraser') {
      currentStrokeRef.current.points.push(pos)
      // Draw incrementally
      const ctx = ctxRef.current
      const pts = currentStrokeRef.current.points
      if (pts.length < 2) return
      const prev = toPixel(pts[pts.length - 2])
      const curr = toPixel(pts[pts.length - 1])
      ctx.save()
      ctx.strokeStyle = tool === 'eraser' ? '#06060c' : color
      ctx.lineWidth = strokeSize
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(curr.x, curr.y)
      ctx.stroke()
      ctx.restore()
    } else {
      // For shapes, redraw all then preview
      currentStrokeRef.current.points = [startPosRef.current, pos]
      redrawAll(strokes)
      drawStroke(currentStrokeRef.current)
    }
  }, [isDrawing, tool, color, strokeSize, getCanvasPos, toPixel, redrawAll, drawStroke, strokes])

  const handlePointerUp = useCallback(() => {
    if (!isDrawing || !currentStrokeRef.current) return
    setIsDrawing(false)
    const stroke = currentStrokeRef.current
    currentStrokeRef.current = null
    if (stroke.points.length >= 1) {
      commitStroke(stroke)
    }
  }, [isDrawing, commitStroke])

  // Commit (non-empty) or cancel (empty) the text editor. On cancel while
  // re-editing an existing block, the original is restored so it isn't lost.
  const closeEditor = useCallback((raw) => {
    if (editorClosedRef.current) { editorClosedRef.current = false; return }
    const text = (raw ?? '').replace(/\s+$/, '')
    const orig = editingOrigRef.current
    editingOrigRef.current = null
    if (text.trim() && textInput) {
      const stroke = {
        tool: 'text',
        color,
        size: strokeSize,
        fontSize: textFontSize(strokeSize),
        points: [textInput],
        text,
      }
      drawStroke(stroke)
      commitStroke(stroke)
    } else if (orig) {
      setStrokes(prev => { const u = [...prev, orig]; redrawAll(u); return u })
    }
    setTextInput(null)
    setEditingText('')
  }, [textInput, color, strokeSize, drawStroke, commitStroke, redrawAll])

  // Drag the bottom handle to resize the panel (reveals the meeting below).
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
    // Bottom-anchored: panel height = distance from the pointer to the stage bottom.
    const pct = ((rect.bottom - e.clientY) / rect.height) * 100
    setPanelPct(Math.min(95, Math.max(20, pct)))
  }, [])
  const endResize = useCallback((e) => {
    resizingRef.current = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  // Grow the text editor to fit its content, but never past the canvas bottom —
  // once it would overflow, cap the height and let it scroll internally.
  const growTextarea = useCallback((el) => {
    const canvas = canvasRef.current
    if (!el || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const topPx = (parseFloat(el.style.top || '0') / 100) * rect.height
    const maxH = Math.max(24, rect.height - topPx - TEXT_PAD)
    el.style.height = 'auto'
    const h = Math.min(el.scrollHeight, maxH)
    el.style.height = `${h}px`
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden'
  }, [])

  const undo = useCallback(() => {
    setStrokes(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setUndoneStrokes(u => [...u, last])
      const updated = prev.slice(0, -1)
      redrawAll(updated)
      return updated
    })
  }, [redrawAll])

  const redo = useCallback(() => {
    setUndoneStrokes(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setStrokes(s => {
        const updated = [...s, last]
        redrawAll(updated)
        return updated
      })
      return prev.slice(0, -1)
    })
  }, [redrawAll])

  const clearAll = useCallback(() => {
    setStrokes([])
    setUndoneStrokes([])
    redrawAll([])
    if (onDraw) onDraw({ tool: 'clear' })
  }, [redrawAll, onDraw])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo() }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  // When the text editor opens: focus it, size it to its content, and drop the
  // caret at the end so typing continues from there (click inside to reposition).
  useEffect(() => {
    if (!textInput) return
    const el = textareaRef.current
    if (!el) return
    growTextarea(el)
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [textInput, growTextarea])

  return (
    <div
      ref={rootRef}
      className="fade-in pointer-events-auto absolute inset-x-0 bottom-0 flex min-h-0 min-w-0 flex-col border-t border-line shadow-2xl"
      style={{ background: '#06060c', height: `${panelPct}%` }}
    >
      {/* Drag handle (top edge) — pull up to grow the board, down to reveal the meeting */}
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

      {/* Toolbar */}
      <div
        className="z-[5] flex shrink-0 items-center gap-1 border-b border-line px-3 py-2 backdrop-blur-md"
        style={{ background: 'rgba(15,15,23,0.9)' }}
      >
        <div className="flex gap-0.5">
          {TOOLS.map(t => (
            <ToolBtn
              key={t.id}
              active={tool === t.id}
              onClick={() => { setTool(t.id); if (t.id === 'text') openTextEditor() }}
              title={t.label}
            >
              <Icon name={t.icon} size={16} />
            </ToolBtn>
          ))}
        </div>

        <Divider />

        {/* Color picker */}
        <div className="relative">
          <ToolBtn
            onClick={() => { setShowColors(!showColors); setShowSizes(false) }}
            title="Color"
          >
            <span
              className="block h-4 w-4 rounded-full border-2 border-white/20"
              style={{ background: color }}
            />
          </ToolBtn>
          {showColors && (
            <Popover>
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => { setColor(c); setShowColors(false) }}
                  style={{ background: c }}
                  className={cn(
                    'h-6 w-6 cursor-pointer rounded-full border-2 transition-transform duration-150 hover:scale-[1.15]',
                    c === color
                      ? 'border-white shadow-[0_0_8px_rgba(255,255,255,0.3)]'
                      : 'border-transparent'
                  )}
                />
              ))}
            </Popover>
          )}
        </div>

        {/* Stroke size */}
        <div className="relative">
          <ToolBtn
            onClick={() => { setShowSizes(!showSizes); setShowColors(false) }}
            title="Stroke size"
          >
            <span
              className="block rounded-full bg-fg"
              style={{ width: strokeSize + 4, height: strokeSize + 4 }}
            />
          </ToolBtn>
          {showSizes && (
            <Popover>
              {STROKE_SIZES.map(s => (
                <button
                  key={s}
                  onClick={() => { setStrokeSize(s); setShowSizes(false) }}
                  className={cn(
                    'grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-sm border bg-transparent transition',
                    s === strokeSize
                      ? 'border-accent text-accent'
                      : 'border-transparent text-fg-muted hover:bg-white/6'
                  )}
                >
                  <span
                    style={{
                      width: s + 2,
                      height: s + 2,
                      borderRadius: '50%',
                      background: 'currentColor',
                    }}
                  />
                </button>
              ))}
            </Popover>
          )}
        </div>

        <Divider />

        {/* Undo / Redo */}
        <ToolBtn onClick={undo} disabled={strokes.length === 0} title="Undo (Ctrl+Z)">
          <Icon name="undo" size={16} />
        </ToolBtn>
        <ToolBtn onClick={redo} disabled={undoneStrokes.length === 0} title="Redo (Ctrl+Y)">
          <Icon name="redo" size={16} />
        </ToolBtn>

        <Divider />

        <ToolBtn tone="danger" onClick={clearAll} title="Clear all">
          <Icon name="trash" size={16} />
        </ToolBtn>

        <div className="flex-1" />

        <button
          onClick={onClose}
          title="Close whiteboard"
          className="grid h-[34px] w-[34px] place-items-center !rounded-sm !border-0 !bg-danger !p-0 !text-white !shadow-none transition hover:!bg-[color-mix(in_srgb,var(--c-danger)_82%,black)]"
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      {/* Canvas + overlays — relative wrapper so % coords match the canvas, not the toolbar */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          onClick={handleCanvasClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{ cursor: tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair' }}
        />

        {/* Document-style text editor — borderless, starts top-left, multi-line.
            Enter = new line; click away (blur) commits; Esc cancels. */}
        {textInput && (
          <textarea
            ref={textareaRef}
            rows={1}
            defaultValue={editingText}
            className="absolute z-10 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 !shadow-none outline-none"
            style={{
              left: `${textInput.x}%`,
              top: `${textInput.y}%`,
              right: `${TEXT_PAD}px`,
              color: color,
              fontSize: `${textFontSize(strokeSize)}px`,
              lineHeight: 1.35,
              fontFamily: 'system-ui, sans-serif',
            }}
            onInput={(e) => growTextarea(e.target)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') { e.preventDefault(); closeEditor(''); editorClosedRef.current = true }
            }}
            onBlur={(e) => closeEditor(e.target.value)}
          />
        )}
      </div>
    </div>
  )
}

/* ────────────────────── pieces ────────────────────── */

function ToolBtn({ children, active, disabled, tone, onClick, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'grid h-[34px] w-[34px] place-items-center !rounded-sm border !p-0 !shadow-none transition',
        'disabled:cursor-default disabled:opacity-30',
        active
          ? '!border-[color-mix(in_srgb,var(--c-accent)_30%,transparent)] !bg-[var(--accent-gradient-soft)] !text-accent'
          : tone === 'danger'
            ? '!border-transparent !bg-transparent !text-danger hover:!bg-[color-mix(in_srgb,var(--c-danger)_10%,transparent)]'
            : '!border-transparent !bg-transparent !text-fg-muted hover:!bg-white/6 hover:!text-fg'
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="mx-1.5 h-[22px] w-px shrink-0 bg-line" />
}

function Popover({ children }) {
  return (
    <div className="fade-in-up absolute left-1/2 top-10 z-20 flex -translate-x-1/2 gap-1 rounded-md border border-line-strong bg-bg-2 p-1.5 shadow-lg">
      {children}
    </div>
  )
}
