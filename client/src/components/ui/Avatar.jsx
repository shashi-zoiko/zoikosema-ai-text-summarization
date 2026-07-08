import { useEffect, useState } from 'react'
import { cn } from '../../lib/cn'
import { assetUrl } from '../../api/client'

const SIZES = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-[13px]',
  lg: 'h-14 w-14 text-[16px]',
  xl: 'h-20 w-20 text-[22px]',
}

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6']

function pickColor(seed) {
  if (!seed) return COLORS[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function Avatar({ name, color, src, size = 'md', presence, className, ...rest }) {
  const bg = color || pickColor(name)
  src = assetUrl(src)
  // Fall back to initials if the photo fails to load (e.g. an uploaded avatar
  // that didn't persist in production) instead of showing an empty circle.
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  const showImg = src && !failed
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'font-semibold tracking-tight text-white',
        'ring-1 ring-white/10',
        SIZES[size],
        className
      )}
      style={{
        background: showImg ? undefined : `linear-gradient(135deg, ${bg} 0%, color-mix(in srgb, ${bg} 70%, #000) 100%)`,
      }}
      {...rest}
    >
      {showImg ? (
        <img
          src={src}
          alt={name || ''}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      <span aria-hidden className="absolute inset-0 rounded-full bg-gradient-to-b from-white/15 to-transparent" />
      {presence && (
        <span
          className={cn(
            'absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--c-bg)]',
            presence === 'online' && 'bg-[var(--c-success)]',
            presence === 'away' && 'bg-[var(--c-warn)]',
            presence === 'busy' && 'bg-[var(--c-danger)]',
            presence === 'offline' && 'bg-[var(--c-fg-muted)]'
          )}
        />
      )}
    </span>
  )
}
