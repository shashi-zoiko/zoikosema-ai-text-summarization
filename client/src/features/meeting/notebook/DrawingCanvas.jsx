import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../../components/Icon'
import { cn } from '../../../lib/cn'

// PRIVATE per-participant drawing canvas. Nothing here is synced — strokes live
// in local state, are surfaced to the parent via onStrokesChange (for autosave),
// and are seeded once from `initialStrokes`. Pan/zoom is a pure view transform
// (`viewport`) applied at draw time; strokes stay stored in logical %-of-canvas
// coordinates so they survive resizes and reloads unchanged.

const COLORS = ['#ffffff', '#ef4f6b', '#fbbf24', '#34d399', '#7c8cff', '#f472b6', '#38bdf8', '#a78bfa']
const STROKE_SIZES = [2, 4, 8, 14]

const textFontSize = (size) => Math.max(16, (size || 4) * 4)
const TEXT_PAD = 10

const TOOLS = [
  { id: 'pen', icon: 'pen', label: 'Draw' },
  { id: 'highlighter', icon: 'pen', label: 'Highlighter' },
  { id: 'line', icon: 'minus', label: 'Line' },
  { id: 'rect', icon: 'square', label: 'Rectangle' },
  { id: 'circle', icon: 'circle', label: 'Circle' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow' },
  { id: 'text', icon: 'type', label: 'Text' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
  { id: 'pan', icon: 'hand', label: 'Pan' },
]

const DEFAULT_VIEWPORT = { scale: 1, x: 0, y: 0 }

function DrawingCanvas({ initialStrokes = [], viewport: viewportProp, onStrokesChange, onViewportChange, active = true }) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#ffffff')
  const [strokeSize, setStrokeSize] = useState(4)
  const [isDrawing, setIsDrawing] = useState(false)
  const [strokes, setStrokes] = useState(() => initialStrokes || [])
  const [undoneStrokes, setUndoneStrokes] = useState([])
  const currentStrokeRef = useRef(null)
  const startPosRef = useRef(null)
  const [showColors, setShowColors] = useState(false)
  const [showSizes, setShowSizes] = useState(false)
  const [textInput, setTextInput] = useState(null)
  const [editingText, setEditingText] = useState('')
  const textareaRef = useRef(null)
  const editingOrigRef = useRef(null)
  const editorClosedRef = useRef(false)

  // Viewport (pan/zoom). Kept in a ref too so pointer/draw callbacks read the
  // live value without re-binding on every pan frame.
  const [viewport, setViewport] = useState(() => ({ ...DEFAULT_VIEWPORT, ...(viewportProp || {}) }))
  const viewportRef = useRef(viewport)
  useEffect(() => { viewportRef.current = viewport }, [viewport])

  const strokesRef = useRef(strokes)
  useEffect(() => { strokesRef.current = strokes }, [strokes])

  // Pan gesture state (space-drag, middle-mouse, or the pan tool).
  const spaceHeldRef = useRef(false)
  const panningRef = useRef(null) // { startX, startY, origX, origY }

  // ── Coordinate transforms (logical % ↔ screen px, viewport-aware) ──────────
  const getCanvasPos = useCallback((e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    const v = viewportRef.current
    const px = clientX - rect.left
    const py = clientY - rect.top
    return {
      x: (((px - v.x) / v.scale) / rect.width) * 100,
      y: (((py - v.y) / v.scale) / rect.height) * 100,
    }
  }, [])

  const toPixel = useCallback((pos) => {
    const canvas = canvasRef.current
    if (!canvas || !pos) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const v = viewportRef.current
    return {
      x: ((pos.x / 100) * rect.width) * v.scale + v.x,
      y: ((pos.y / 100) * rect.height) * v.scale + v.y,
    }
  }, [])

  const drawStroke = useCallback((stroke) => {
    const ctx = ctxRef.current
    if (!ctx || !stroke?.points?.length) return
    // Shapes need two endpoints; text needs one. Skip malformed strokes rather
    // than crash the whole call view on toPixel(undefined) (e.g. a legacy
    // single-point shape persisted from a click-without-drag).
    const need2 = stroke.tool === 'line' || stroke.tool === 'arrow' || stroke.tool === 'rect' || stroke.tool === 'circle'
    if (need2 && stroke.points.length < 2) return
    const v = viewportRef.current
    const scaled = (n) => n * v.scale

    ctx.save()
    if (stroke.tool === 'highlighter') {
      ctx.globalAlpha = 0.35
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = scaled(stroke.size * 3)
    } else {
      ctx.strokeStyle = stroke.tool === 'eraser' ? '#06060c' : stroke.color
      ctx.lineWidth = scaled(stroke.size)
    }
    ctx.fillStyle = stroke.color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (stroke.tool === 'pen' || stroke.tool === 'eraser' || stroke.tool === 'highlighter') {
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
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x)
      const headLen = scaled(12 + stroke.size)
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
      const fontSize = (stroke.fontSize || textFontSize(stroke.size)) * v.scale
      ctx.font = `${fontSize}px system-ui, sans-serif`
      ctx.textBaseline = 'top'
      const canvas = canvasRef.current
      const rectW = canvas ? canvas.getBoundingClientRect().width : 0
      const maxW = Math.max(40, rectW - p.x - TEXT_PAD)
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
    redrawAll(strokesRef.current)
  }, [redrawAll])

  // Keep the backing store in sync with rendered size (window + panel resize).
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

  // Redraw whenever the viewport changes (pan/zoom).
  useEffect(() => { redrawAll(strokesRef.current) }, [viewport, redrawAll])

  // ── Surface changes to the parent (autosave). Skip the initial seed so we
  // don't immediately mark a freshly-loaded notebook dirty. ─────────────────
  const seededStrokes = useRef(false)
  useEffect(() => {
    if (!seededStrokes.current) { seededStrokes.current = true; return }
    onStrokesChange?.(strokes)
  }, [strokes, onStrokesChange])

  const seededViewport = useRef(false)
  useEffect(() => {
    if (!seededViewport.current) { seededViewport.current = true; return }
    onViewportChange?.(viewport)
  }, [viewport, onViewportChange])

  const commitStroke = useCallback((stroke) => {
    setStrokes(prev => [...prev, stroke])
    setUndoneStrokes([])
  }, [])

  const measureTextStroke = useCallback((stroke) => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return null
    const v = viewportRef.current
    const p = toPixel(stroke.points[0])
    const fontSize = (stroke.fontSize || textFontSize(stroke.size)) * v.scale
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

  const openTextEditor = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const v = viewportRef.current
    const rect = canvas.getBoundingClientRect()
    editingOrigRef.current = null
    setEditingText('')
    // Place the editor at the top-left of the *logical* page, accounting for pan.
    setTextInput({
      x: (((TEXT_PAD - v.x) / v.scale) / rect.width) * 100,
      y: (((TEXT_PAD - v.y) / v.scale) / rect.height) * 100,
    })
  }, [])

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

  // ── Pan helpers ────────────────────────────────────────────────────────────
  const beginPan = useCallback((e) => {
    panningRef.current = {
      startX: e.clientX, startY: e.clientY,
      origX: viewportRef.current.x, origY: viewportRef.current.y,
    }
  }, [])

  const handlePointerDown = useCallback((e) => {
    // Pan via the pan tool, held space, or middle-mouse button.
    if (tool === 'pan' || spaceHeldRef.current || e.button === 1) {
      e.preventDefault()
      beginPan(e)
      return
    }
    if (tool === 'text') return
    setIsDrawing(true)
    const pos = getCanvasPos(e)
    startPosRef.current = pos
    currentStrokeRef.current = { tool, color, size: strokeSize, points: [pos] }
  }, [tool, color, strokeSize, getCanvasPos, beginPan])

  const handlePointerMove = useCallback((e) => {
    if (panningRef.current) {
      const p = panningRef.current
      setViewport(v => ({ ...v, x: p.origX + (e.clientX - p.startX), y: p.origY + (e.clientY - p.startY) }))
      return
    }
    if (!isDrawing || !currentStrokeRef.current) return
    const pos = getCanvasPos(e)
    const v = viewportRef.current

    if (tool === 'pen' || tool === 'eraser' || tool === 'highlighter') {
      currentStrokeRef.current.points.push(pos)
      const ctx = ctxRef.current
      const pts = currentStrokeRef.current.points
      if (pts.length < 2) return
      const prev = toPixel(pts[pts.length - 2])
      const curr = toPixel(pts[pts.length - 1])
      ctx.save()
      if (tool === 'highlighter') {
        ctx.globalAlpha = 0.35
        ctx.strokeStyle = color
        ctx.lineWidth = strokeSize * 3 * v.scale
      } else {
        ctx.strokeStyle = tool === 'eraser' ? '#06060c' : color
        ctx.lineWidth = strokeSize * v.scale
      }
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(curr.x, curr.y)
      ctx.stroke()
      ctx.restore()
    } else {
      currentStrokeRef.current.points = [startPosRef.current, pos]
      redrawAll(strokes)
      drawStroke(currentStrokeRef.current)
    }
  }, [isDrawing, tool, color, strokeSize, getCanvasPos, toPixel, redrawAll, drawStroke, strokes])

  const handlePointerUp = useCallback(() => {
    if (panningRef.current) { panningRef.current = null; return }
    if (!isDrawing || !currentStrokeRef.current) return
    setIsDrawing(false)
    const stroke = currentStrokeRef.current
    currentStrokeRef.current = null
    // Free-draw needs ≥2 points; shapes need exactly a start+end. A click with no
    // drag (single point) is not a real stroke — dropping it avoids persisting a
    // degenerate shape that would crash the redraw path.
    if (stroke.points.length >= 2) commitStroke(stroke)
  }, [isDrawing, commitStroke])

  const closeEditor = useCallback((raw) => {
    if (editorClosedRef.current) { editorClosedRef.current = false; return }
    const text = (raw ?? '').replace(/\s+$/, '')
    const orig = editingOrigRef.current
    editingOrigRef.current = null
    if (text.trim() && textInput) {
      const stroke = {
        tool: 'text', color, size: strokeSize,
        fontSize: textFontSize(strokeSize), points: [textInput], text,
      }
      drawStroke(stroke)
      commitStroke(stroke)
    } else if (orig) {
      setStrokes(prev => { const u = [...prev, orig]; redrawAll(u); return u })
    }
    setTextInput(null)
    setEditingText('')
  }, [textInput, color, strokeSize, drawStroke, commitStroke, redrawAll])

  const growTextarea = useCallback((el) => {
    const canvas = canvasRef.current
    if (!el || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const topPx = parseFloat(el.style.top || '0')
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
      setStrokes(s => { const updated = [...s, last]; redrawAll(updated); return updated })
      return prev.slice(0, -1)
    })
  }, [redrawAll])

  const clearAll = useCallback(() => {
    setStrokes([])
    setUndoneStrokes([])
    redrawAll([])
  }, [redrawAll])

  const resetView = useCallback(() => setViewport({ ...DEFAULT_VIEWPORT }), [])

  // Zoom around the cursor on Ctrl/⌘ + wheel.
  const handleWheel = useCallback((e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    setViewport(v => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const scale = Math.min(5, Math.max(0.2, v.scale * factor))
      // Keep the point under the cursor stationary while zooming.
      const k = scale / v.scale
      return { scale, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k }
    })
  }, [])

  // Keyboard: undo/redo + space-to-pan. Only bound while this tab is the active
  // one, so the canvas's Ctrl+Z never fights the TipTap notes editor.
  useEffect(() => {
    if (!active) return undefined
    const down = (e) => {
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo() }
      if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo() }
      if (e.code === 'Space' && !textInput) { spaceHeldRef.current = true }
    }
    const up = (e) => { if (e.code === 'Space') spaceHeldRef.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [active, undo, redo, textInput])

  useEffect(() => {
    if (!textInput) return
    const el = textareaRef.current
    if (!el) return
    growTextarea(el)
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [textInput, growTextarea])

  const editorScreenPos = textInput ? toPixel(textInput) : null

  return (
    <div className="flex h-full min-h-0 w-full flex-col" style={{ background: '#06060c' }}>
      {/* Toolbar */}
      <div
        className="z-[5] flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-2 backdrop-blur-md"
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

        <div className="relative">
          <ToolBtn active={showColors} onClick={() => { setShowColors(!showColors); setShowSizes(false) }} title="Color">
            <span className="block h-4 w-4 rounded-full border-2 border-white/20" style={{ background: color }} />
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
                    c === color ? 'border-white shadow-[0_0_8px_rgba(255,255,255,0.3)]' : 'border-transparent'
                  )}
                />
              ))}
            </Popover>
          )}
        </div>

        <div className="relative">
          <ToolBtn active={showSizes} onClick={() => { setShowSizes(!showSizes); setShowColors(false) }} title="Stroke size">
            <span className="block rounded-full bg-fg" style={{ width: strokeSize + 4, height: strokeSize + 4 }} />
          </ToolBtn>
          {showSizes && (
            <Popover>
              {STROKE_SIZES.map(s => (
                <button
                  key={s}
                  onClick={() => { setStrokeSize(s); setShowSizes(false) }}
                  className={cn(
                    'grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-sm border bg-transparent transition',
                    s === strokeSize ? 'border-accent text-accent' : 'border-transparent text-fg-muted hover:bg-white/6'
                  )}
                >
                  <span style={{ width: s + 2, height: s + 2, borderRadius: '50%', background: 'currentColor' }} />
                </button>
              ))}
            </Popover>
          )}
        </div>

        <Divider />

        <ToolBtn onClick={undo} disabled={strokes.length === 0} title="Undo (Ctrl+Z)">
          <Icon name="undo" size={16} />
        </ToolBtn>
        <ToolBtn onClick={redo} disabled={undoneStrokes.length === 0} title="Redo (Ctrl+Y)">
          <Icon name="redo" size={16} />
        </ToolBtn>

        <Divider />

        <ToolBtn onClick={resetView} title={`Reset view (${Math.round(viewport.scale * 100)}%)`}>
          <Icon name="search" size={16} />
        </ToolBtn>

        <ToolBtn tone="danger" onClick={clearAll} title="Clear all">
          <Icon name="trash" size={16} />
        </ToolBtn>
      </div>

      {/* Canvas */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none"
          onClick={handleCanvasClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
          style={{
            cursor: tool === 'pan' || spaceHeldRef.current ? 'grab'
              : tool === 'text' ? 'text'
              : tool === 'eraser' ? 'cell' : 'crosshair',
          }}
        />

        {textInput && editorScreenPos && (
          <textarea
            ref={textareaRef}
            rows={1}
            defaultValue={editingText}
            className="absolute z-10 m-0 resize-none overflow-hidden border-0 bg-transparent p-0 !shadow-none outline-none"
            style={{
              left: `${editorScreenPos.x}px`,
              top: `${editorScreenPos.y}px`,
              right: `${TEXT_PAD}px`,
              color,
              fontSize: `${textFontSize(strokeSize) * viewport.scale}px`,
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

export default memo(DrawingCanvas)

/* ────────────────────── pieces ────────────────────── */

function ToolBtn({ children, active, disabled, tone, onClick, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active || undefined}
      className={cn(
        'grid h-[34px] w-[34px] place-items-center !rounded-sm border !p-0 !shadow-none transition hover:!translate-y-0',
        'disabled:cursor-default disabled:opacity-30',
        active
          ? '!border-[color-mix(in_srgb,var(--c-accent)_55%,transparent)] !bg-[color-mix(in_srgb,var(--c-accent)_22%,transparent)] !text-accent !shadow-[0_0_0_1px_color-mix(in_srgb,var(--c-accent)_30%,transparent)] hover:!bg-[color-mix(in_srgb,var(--c-accent)_32%,transparent)]'
          : tone === 'danger'
            ? '!border-transparent !bg-transparent !text-danger hover:!bg-[color-mix(in_srgb,var(--c-danger)_14%,transparent)] hover:!text-danger'
            : '!border-transparent !bg-transparent !text-fg-muted hover:!bg-white/10 hover:!text-fg'
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
