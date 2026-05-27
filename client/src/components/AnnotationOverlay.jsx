import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { cn } from '../lib/cn'

const COLORS = ['#ef4f6b', '#fbbf24', '#34d399', '#7c8cff', '#ffffff']

/**
 * Transparent annotation overlay that sits on top of a shared screen tile.
 * Supports freehand drawing, arrows, and highlighting.
 * All coordinates are normalised to 0–100 so they sync across different screen sizes.
 */
export default function AnnotationOverlay({ onAnnotate, remoteAnnotations, onClear, onClose }) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const [tool, setTool] = useState('pen')    // 'pen' | 'highlight' | 'arrow' | 'pointer'
  const [color, setColor] = useState('#ef4f6b')
  const [isDrawing, setIsDrawing] = useState(false)
  const [annotations, setAnnotations] = useState([])
  const currentRef = useRef(null)
  const startRef = useRef(null)
  const [pointerPos, setPointerPos] = useState(null) // for laser pointer

  const toPixel = useCallback((pos) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return { x: (pos.x / 100) * rect.width, y: (pos.y / 100) * rect.height }
  }, [])

  const getPos = useCallback((e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const cx = e.touches ? e.touches[0].clientX : e.clientX
    const cy = e.touches ? e.touches[0].clientY : e.clientY
    return { x: ((cx - rect.left) / rect.width) * 100, y: ((cy - rect.top) / rect.height) * 100 }
  }, [])

  const drawAnnotation = useCallback((ann) => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.save()

    if (ann.tool === 'pen') {
      ctx.strokeStyle = ann.color
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 1
      ctx.beginPath()
      const p0 = toPixel(ann.points[0])
      ctx.moveTo(p0.x, p0.y)
      for (let i = 1; i < ann.points.length; i++) {
        const p = toPixel(ann.points[i])
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    } else if (ann.tool === 'highlight') {
      ctx.strokeStyle = ann.color
      ctx.lineWidth = 18
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.3
      ctx.beginPath()
      const p0 = toPixel(ann.points[0])
      ctx.moveTo(p0.x, p0.y)
      for (let i = 1; i < ann.points.length; i++) {
        const p = toPixel(ann.points[i])
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    } else if (ann.tool === 'arrow') {
      const p0 = toPixel(ann.points[0])
      const p1 = toPixel(ann.points[1])
      ctx.strokeStyle = ann.color
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x)
      const hl = 16
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p1.x - hl * Math.cos(angle - 0.4), p1.y - hl * Math.sin(angle - 0.4))
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p1.x - hl * Math.cos(angle + 0.4), p1.y - hl * Math.sin(angle + 0.4))
      ctx.stroke()
    }

    ctx.restore()
  }, [toPixel])

  const redrawAll = useCallback((all) => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    for (const a of all) drawAnnotation(a)
  }, [drawAnnotation])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctxRef.current = ctx
      redrawAll(annotations)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [annotations, redrawAll])

  // Render remote annotations — mirror inbound prop into local state so
  // redrawAll (on resize) can replay every annotation, local or remote.
  useEffect(() => {
    if (!remoteAnnotations?.length) return
    const last = remoteAnnotations[remoteAnnotations.length - 1]
    if (last) {
      if (last.tool === 'clear') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAnnotations([])
        redrawAll([])
      } else if (last.tool === 'pointer') {
        // Just show remote pointer momentarily
        setPointerPos(last.pos)
        setTimeout(() => setPointerPos(null), 2000)
      } else {
        drawAnnotation(last)
        setAnnotations(prev => [...prev, last])
      }
    }
  }, [remoteAnnotations, drawAnnotation, redrawAll])

  const handleDown = useCallback((e) => {
    e.stopPropagation()
    if (tool === 'pointer') {
      const pos = getPos(e)
      setPointerPos(pos)
      if (onAnnotate) onAnnotate({ tool: 'pointer', pos })
      setTimeout(() => setPointerPos(null), 2000)
      return
    }
    setIsDrawing(true)
    const pos = getPos(e)
    startRef.current = pos
    currentRef.current = { tool, color, points: [pos] }
  }, [tool, color, getPos, onAnnotate])

  const handleMove = useCallback((e) => {
    e.stopPropagation()
    if (!isDrawing || !currentRef.current) return
    const pos = getPos(e)

    if (tool === 'pen' || tool === 'highlight') {
      currentRef.current.points.push(pos)
      // Incremental
      const ctx = ctxRef.current
      const pts = currentRef.current.points
      if (pts.length < 2) return
      const p0 = toPixel(pts[pts.length - 2])
      const p1 = toPixel(pts[pts.length - 1])
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = tool === 'highlight' ? 18 : 3
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = tool === 'highlight' ? 0.3 : 1
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.lineTo(p1.x, p1.y)
      ctx.stroke()
      ctx.restore()
    } else if (tool === 'arrow') {
      currentRef.current.points = [startRef.current, pos]
      redrawAll(annotations)
      drawAnnotation(currentRef.current)
    }
  }, [isDrawing, tool, color, getPos, toPixel, redrawAll, drawAnnotation, annotations])

  const handleUp = useCallback(() => {
    if (!isDrawing || !currentRef.current) return
    setIsDrawing(false)
    const ann = currentRef.current
    currentRef.current = null
    if (ann.points.length >= 1) {
      setAnnotations(prev => [...prev, ann])
      if (onAnnotate) onAnnotate(ann)
    }
  }, [isDrawing, onAnnotate])

  const handleClear = () => {
    setAnnotations([])
    redrawAll([])
    if (onClear) onClear()
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-[15]">
      <div className="absolute left-1/2 top-2.5 z-20 flex -translate-x-1/2 items-center gap-[3px] rounded-pill border border-line-strong px-2 py-1 shadow-lg backdrop-blur-md"
           style={{ background: 'rgba(15,15,23,0.9)' }}>
        {[
          { id: 'pen', icon: 'pen', label: 'Draw' },
          { id: 'highlight', icon: 'palette', label: 'Highlight' },
          { id: 'arrow', icon: 'arrow', label: 'Arrow' },
          { id: 'pointer', icon: 'pointer', label: 'Laser pointer' },
        ].map(t => (
          <ToolBtn
            key={t.id}
            active={tool === t.id}
            onClick={() => setTool(t.id)}
            title={t.label}
          >
            <Icon name={t.icon} size={15} />
          </ToolBtn>
        ))}

        <Divider />

        {COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            style={{ background: c }}
            className={cn(
              'h-[18px] w-[18px] cursor-pointer rounded-full border-2 transition-transform duration-150',
              'hover:scale-[1.2]',
              c === color
                ? 'border-white shadow-[0_0_6px_rgba(255,255,255,0.3)]'
                : 'border-transparent'
            )}
          />
        ))}

        <Divider />

        <ToolBtn onClick={handleClear} title="Clear annotations">
          <Icon name="trash" size={15} />
        </ToolBtn>
        <ToolBtn onClick={onClose} title="Stop annotating">
          <Icon name="close" size={15} />
        </ToolBtn>
      </div>

      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
        style={{ cursor: tool === 'pointer' ? 'none' : 'crosshair' }}
      />

      {/* Laser pointer dot — pulsing red glow via zk-pointer-pulse (index.css). */}
      {pointerPos && (
        <div
          className="zk-pointer-pulse pointer-events-none absolute z-[25] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${pointerPos.x}%`,
            top: `${pointerPos.y}%`,
            background: '#ef4f6b',
            boxShadow: '0 0 16px 4px rgba(239,79,107,0.5)',
          }}
        />
      )}
    </div>
  )
}

/* ────────────────────── pieces ────────────────────── */

function ToolBtn({ children, active, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'grid h-[30px] w-[30px] place-items-center !rounded-sm !border-0 !p-0 !shadow-none transition',
        active
          ? '!bg-[var(--accent-gradient-soft)] !text-accent'
          : '!bg-transparent !text-fg-muted hover:!bg-white/8 hover:!text-fg'
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-[18px] w-px bg-line" />
}
