import { useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { Crown, Hand, MicOff, Pin, ShieldCheck } from 'lucide-react'
import { peerGradient, gradientCss, gradientCssRadial } from '../../lib/peerGradient'
import { cn } from '../../lib/cn'

/**
 * Futuristic participant tile.
 *
 * Behaviour:
 *  - Drives a per-peer "aurora" gradient placeholder when video is off,
 *    based on a stable hash of (name + tint color).
 *  - Speaking state turns on a rotating conic gradient ring + a pulsing
 *    neon halo behind the tile.
 *  - Idle tiles have a very slow vertical float animation so they feel
 *    "alive" instead of static.
 *  - Hover lifts the tile and reveals a soft sheen along the top edge.
 *
 * Props are identical to the legacy PeerTile so it can be swapped in place.
 */
export default function PeerTile({
  peer,
  spotlight = false,
  mini = false,
  speaking = false,
  pinned = false,
  onTogglePin,
}) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current && peer.stream) videoRef.current.srcObject = peer.stream
  }, [peer.stream])

  const videoOff = peer.video === false
  const audioOff = peer.audio === false
  const isScreen = !!peer.screen

  const grad = useMemo(() => peerGradient(peer.name, peer.color), [peer.name, peer.color])
  const initials = useMemo(() => {
    const n = (peer.name || '?').trim()
    if (!n) return '?'
    const parts = n.split(/\s+/)
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }, [peer.name])

  // Subtle perpetual float — keeps the grid "alive" without being distracting.
  const idleFloat = !mini && !speaking
    ? {
        y: [0, -3, 0],
        transition: { duration: 6.5, repeat: Infinity, ease: 'easeInOut' },
      }
    : {}

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1, ...idleFloat }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 280, damping: 28, mass: 0.7 }}
      whileHover={mini ? undefined : { y: -2, transition: { duration: 0.2 } }}
      style={{
        '--peer-from': grad.from,
        '--peer-mid':  grad.mid,
        '--peer-to':   grad.to,
        '--peer-glow': grad.glow,
        '--peer-tint': grad.glow,
      }}
      className={cn(
        'peer-tile group relative isolate overflow-hidden',
        mini ? 'peer-tile-mini rounded-2xl' : 'rounded-[28px]',
        spotlight && 'peer-tile-spotlight',
        speaking && 'peer-tile-speaking',
        pinned && 'peer-tile-pinned',
        isScreen && 'peer-tile-screen',
        !mini && 'aspect-[16/9]'
      )}
    >
      {/* ----- Speaking aura (only when speaking) ----- */}
      {speaking && (
        <>
          <span aria-hidden className="peer-tile-aura" />
          <span aria-hidden className="peer-tile-ring" />
        </>
      )}

      {/* ----- Content: video or gradient placeholder ----- */}
      {!videoOff && peer.stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={cn(
            'absolute inset-0 h-full w-full',
            isScreen ? 'object-contain bg-black' : 'object-cover'
          )}
        />
      ) : (
        <GradientPlaceholder
          grad={grad}
          initials={initials}
          mini={mini}
        />
      )}

      {/* ----- Subtle inner border for depth ----- */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/8"
      />

      {/* ----- Hover sheen ----- */}
      {!mini && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-60"
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.10), transparent 80%)',
          }}
        />
      )}

      {/* ----- Hand raised (top-left) ----- */}
      {peer.hand && (
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{
            scale: 1,
            rotate: [-8, 12, -8],
            transition: { rotate: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' } },
          }}
          className={cn(
            'absolute z-10 flex items-center justify-center rounded-full text-[#fbbf24]',
            'border border-[#fbbf24]/40 bg-[#fbbf24]/15 shadow-[0_8px_22px_-6px_rgba(251,191,36,0.45)]',
            mini ? 'top-2 left-2 h-6 w-6' : 'top-3.5 left-3.5 h-9 w-9'
          )}
          title="Hand raised"
        >
          <Hand className={mini ? 'h-3 w-3' : 'h-4 w-4'} />
        </motion.div>
      )}

      {/* ----- Pin button (top-right, on hover) ----- */}
      {onTogglePin && !mini && (
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin() }}
          className={cn(
            'absolute top-3.5 right-3.5 z-10 flex h-9 w-9 items-center justify-center rounded-full',
            'border backdrop-blur-md transition-all duration-200',
            pinned
              ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-accent)] opacity-100'
              : 'border-white/12 bg-black/45 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-black/65 hover:text-white'
          )}
          title={pinned ? 'Unpin' : 'Pin to main view'}
          aria-label={pinned ? 'Unpin' : 'Pin to main view'}
        >
          <Pin className="h-4 w-4" />
        </button>
      )}

      {/* ----- Bottom name pill (and muted indicator) ----- */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2',
          mini ? 'p-2' : 'p-3.5'
        )}
      >
        <div
          className={cn(
            'pointer-events-auto flex items-center gap-2 rounded-full border text-white',
            'border-white/10 bg-black/55 backdrop-blur-md',
            mini ? 'px-2 py-1 text-[10.5px]' : 'px-3 py-1.5 text-[12px]'
          )}
        >
          {speaking && (
            <span className="flex items-center gap-0.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="block w-0.5 rounded-full bg-[var(--peer-glow)]"
                  style={{ height: '6px' }}
                  animate={{ scaleY: [0.4, 1.4, 0.6, 1.2, 0.5] }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
                />
              ))}
            </span>
          )}
          <span className="truncate font-semibold tracking-tight">
            {peer.name || '…'}{isScreen ? ' · sharing' : ''}
          </span>
          {peer.role === 'host' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/18 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-amber-300 ring-1 ring-amber-300/30">
              <Crown className="h-2.5 w-2.5" /> Host
            </span>
          )}
          {peer.role === 'co_host' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-400/18 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-cyan-300 ring-1 ring-cyan-300/30">
              <ShieldCheck className="h-2.5 w-2.5" /> Co-host
            </span>
          )}
        </div>

        {audioOff && (
          <div
            className={cn(
              'pointer-events-auto flex items-center justify-center rounded-full',
              'bg-[#ef4444] text-white shadow-[0_6px_18px_-4px_rgba(239,68,68,0.55)] ring-2 ring-white/10',
              mini ? 'h-6 w-6' : 'h-8 w-8'
            )}
            title="Muted"
          >
            <MicOff className={mini ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
          </div>
        )}
      </div>
    </motion.div>
  )
}

/**
 * Gradient placeholder with the peer's initials when video is off.
 * Adds: an animated soft particle (the gradient orb subtly drifts),
 * a glowing ring around the avatar, and a noise texture for depth.
 */
function GradientPlaceholder({ grad, initials, mini }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{ background: gradientCssRadial(grad) }}
    >
      {/* drifting orb */}
      <motion.div
        aria-hidden
        className="absolute -inset-10 rounded-full opacity-50 blur-3xl"
        style={{ background: `radial-gradient(closest-side, ${grad.to}, transparent)` }}
        animate={{ x: [-30, 40, -20, 30, -30], y: [-20, 20, -10, 30, -20] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* fine grain overlay */}
      <span aria-hidden className="absolute inset-0 opacity-25 mix-blend-overlay peer-tile-grain" />

      {/* initials */}
      <div className="relative flex flex-col items-center gap-2">
        <motion.div
          className={cn(
            'relative flex aspect-square items-center justify-center rounded-full font-bold text-white',
            mini ? 'h-12 text-[18px]' : 'h-32 text-[56px] xl:h-40 xl:text-[68px]'
          )}
          style={{
            background: gradientCss(grad),
            boxShadow:
              `inset 0 0 0 2px rgba(255,255,255,0.22), 0 24px 60px -16px ${grad.glow}aa`,
          }}
          animate={!mini ? { scale: [1, 1.02, 1] } : undefined}
          transition={!mini ? { duration: 4, repeat: Infinity, ease: 'easeInOut' } : undefined}
        >
          {/* glowing ring */}
          {!mini && (
            <span
              aria-hidden
              className="absolute -inset-3 rounded-full opacity-60 blur-2xl"
              style={{ background: `radial-gradient(closest-side, ${grad.glow}, transparent 70%)` }}
            />
          )}
          {/* inner shine */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(120% 80% at 30% 22%, rgba(255,255,255,0.30), transparent 50%)',
            }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(120% 80% at 70% 80%, rgba(0,0,0,0.20), transparent 55%)',
            }}
          />
          <span
            className="relative"
            style={{
              textShadow: '0 2px 12px rgba(0,0,0,0.30), 0 0 1px rgba(255,255,255,0.20)',
            }}
          >
            {initials}
          </span>
        </motion.div>
      </div>
    </div>
  )
}
