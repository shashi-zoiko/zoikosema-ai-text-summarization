import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { cn } from '../lib/cn'

const COLORS = ['#ffffff', '#ef4f6b', '#fbbf24', '#34d399', '#7c8cff', '#f472b6', '#38bdf8', '#a78bfa']
const STROKE_SIZES = [2, 4, 8, 14]
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
      ctx.font = `${Math.max(14, stroke.size * 4)}px sans-serif`
      ctx.fillText(stroke.text, p.x, p.y)
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

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
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
      redrawAll(strokes)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [strokes, redrawAll])

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

  const handlePointerDown = useCallback((e) => {
    if (tool === 'text') {
      const pos = getCanvasPos(e)
      setTextInput(pos)
      return
    }
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

  const handleTextSubmit = useCallback((text) => {
    if (!text.trim() || !textInput) return
    const stroke = {
      tool: 'text',
      color,
      size: strokeSize,
      points: [textInput],
      text: text.trim(),
    }
    drawStroke(stroke)
    commitStroke(stroke)
    setTextInput(null)
  }, [textInput, color, strokeSize, drawStroke, commitStroke])

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

  return (
    <div
      className="fade-in relative flex min-h-0 min-w-0 flex-1 flex-col"
      style={{ background: '#06060c' }}
    >
      {/* Toolbar */}
      <div
        className="z-[5] flex shrink-0 items-center gap-1 border-b border-line px-3 py-2 backdrop-blur-md"
        style={{ background: 'rgba(15,15,23,0.9)' }}
      >
        <div className="flex gap-0.5">
          {TOOLS.map(t => (
            <ToolBtn key={t.id} active={tool === t.id} onClick={() => setTool(t.id)} title={t.label}>
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

        <ToolBtn onClick={onClose} title="Close whiteboard">
          <Icon name="close" size={16} />
        </ToolBtn>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="block w-full flex-1 touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ cursor: tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair' }}
      />

      {/* Text input overlay */}
      {textInput && (
        <div
          className="absolute z-10"
          style={{ left: `${textInput.x}%`, top: `${textInput.y}%` }}
        >
          <input
            autoFocus
            placeholder="Type text…"
            className="!min-w-[180px] !rounded-sm !border-accent !px-2.5 !py-1.5 !text-[14px] !text-white !outline-none"
            style={{ background: 'rgba(0,0,0,0.7)' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { handleTextSubmit(e.target.value); }
              if (e.key === 'Escape') setTextInput(null)
            }}
            onBlur={(e) => { if (e.target.value.trim()) handleTextSubmit(e.target.value); else setTextInput(null) }}
          />
        </div>
      )}
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
