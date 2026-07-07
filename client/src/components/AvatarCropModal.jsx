import { useEffect, useRef, useState, useCallback } from 'react'
import { Check, X, ZoomIn } from 'lucide-react'

const VIEW = 288   // on-screen crop viewport (px)
const OUT = 512    // exported image size (px)

// Keep the image covering the viewport at all times: offset is the image's
// top-left corner relative to the viewport, clamped so no gap shows. Pure so
// the drag handler and export share identical math.
function clampOffset(x, y, drawW, drawH) {
  return {
    x: Math.min(0, Math.max(VIEW - drawW, x)),
    y: Math.min(0, Math.max(VIEW - drawH, y)),
  }
}

/* Circular crop/zoom picker. Reads a File, lets the user drag + zoom, and calls
 * onDone(blob) with a square JPEG of the visible circle. No dependencies. */
export default function AvatarCropModal({ file, onCancel, onDone }) {
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef(null)

  // baseScale makes the image just cover the viewport at zoom=1 (cover fit).
  const baseScale = useRef(1)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      baseScale.current = VIEW / Math.min(img.naturalWidth, img.naturalHeight)
      const drawW = img.naturalWidth * baseScale.current
      const drawH = img.naturalHeight * baseScale.current
      setOffset({ x: (VIEW - drawW) / 2, y: (VIEW - drawH) / 2 })
      setReady(true)
    }
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const draw = useCallback(() => {
    const img = imgRef.current
    const cvs = canvasRef.current
    if (!img || !cvs) return
    const scale = baseScale.current * zoom
    const drawW = img.naturalWidth * scale
    const drawH = img.naturalHeight * scale
    const ctx = cvs.getContext('2d')
    ctx.clearRect(0, 0, VIEW, VIEW)
    ctx.drawImage(img, offset.x, offset.y, drawW, drawH)
  }, [zoom, offset])

  useEffect(() => { if (ready) draw() }, [ready, draw])

  const scaledSize = () => {
    const img = imgRef.current
    const scale = baseScale.current * zoom
    return { drawW: img.naturalWidth * scale, drawH: img.naturalHeight * scale }
  }

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y }
  }
  const onPointerMove = (e) => {
    if (!drag.current) return
    const { drawW, drawH } = scaledSize()
    const nx = drag.current.ox + (e.clientX - drag.current.startX)
    const ny = drag.current.oy + (e.clientY - drag.current.startY)
    setOffset(clampOffset(nx, ny, drawW, drawH))
  }
  const onPointerUp = () => { drag.current = null }

  const onZoom = (z) => {
    setZoom(z)
    const img = imgRef.current
    const scale = baseScale.current * z
    const drawW = img.naturalWidth * scale
    const drawH = img.naturalHeight * scale
    // Re-clamp around the viewport centre so zooming doesn't expose a gap.
    setOffset((o) => clampOffset(o.x, o.y, drawW, drawH))
  }

  const confirm = () => {
    const img = imgRef.current
    const r = OUT / VIEW
    const scale = baseScale.current * zoom
    const out = document.createElement('canvas')
    out.width = OUT; out.height = OUT
    out.getContext('2d').drawImage(
      img, offset.x * r, offset.y * r,
      img.naturalWidth * scale * r, img.naturalHeight * scale * r,
    )
    out.toBlob((blob) => { if (blob) onDone(blob) }, 'image/jpeg', 0.9)
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-[360px] rounded-2xl border border-[var(--c-line)] bg-[var(--c-bg-1)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[var(--c-fg)]">Adjust photo</h3>
          <button onClick={onCancel} className="text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]">
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div
          className="relative mx-auto touch-none overflow-hidden rounded-full ring-1 ring-[var(--c-line-strong)]"
          style={{ width: VIEW, height: VIEW, maxWidth: '100%' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <canvas ref={canvasRef} width={VIEW} height={VIEW} className="cursor-grab active:cursor-grabbing" />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <ZoomIn className="h-4 w-4 shrink-0 text-[var(--c-fg-muted)]" />
          <input
            type="range" min="1" max="3" step="0.01" value={zoom}
            onChange={(e) => onZoom(Number(e.target.value))}
            className="w-full accent-[var(--c-accent)]"
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="!rounded-[10px] !border-[var(--c-line-strong)] !bg-[var(--c-bg-1)] px-4 py-2 text-[13.5px] font-medium text-[var(--c-fg-dim)]">
            Cancel
          </button>
          <button onClick={confirm} disabled={!ready} className="primary !rounded-[10px]">
            <Check className="h-4 w-4" /> Save photo
          </button>
        </div>
      </div>
    </div>
  )
}
