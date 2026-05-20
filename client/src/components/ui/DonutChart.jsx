import { motion } from 'framer-motion'

const SIZE = 168
const R = 70
const STROKE = 18
const C = 2 * Math.PI * R

/**
 * Animated SVG donut chart.
 *
 * @param {Array<{label: string, value: number, color: string}>} segments
 * @param {string} centerLabel — large number in the middle
 * @param {string} centerSub — small label under it
 */
export default function DonutChart({ segments = [], centerLabel, centerSub }) {
  const total = Math.max(1, segments.reduce((s, x) => s + (x.value || 0), 0))
  let offset = 0

  return (
    <div className="relative flex items-center justify-center">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="-rotate-90"
        role="img"
        aria-label="Distribution chart"
      >
        {/* Track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="var(--c-line)"
          strokeWidth={STROKE}
        />
        {segments.map((seg, i) => {
          const fraction = (seg.value || 0) / total
          const len = C * fraction
          // Small gap between segments for clarity
          const gap = segments.length > 1 ? 2 : 0
          const dash = `${Math.max(0, len - gap)} ${C}`
          const rotate = (offset / C) * 360
          offset += len
          return (
            <motion.circle
              key={i}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={dash}
              style={{ transformOrigin: `${SIZE / 2}px ${SIZE / 2}px`, transform: `rotate(${rotate}deg)` }}
              initial={{ pathLength: 0, opacity: 0.4 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.9, delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] }}
            />
          )
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {centerLabel != null && (
          <div className="text-[26px] font-bold leading-none tracking-tight tabular-nums text-[var(--c-fg)]">
            {centerLabel}
          </div>
        )}
        {centerSub && (
          <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--c-fg-muted)]">
            {centerSub}
          </div>
        )}
      </div>
    </div>
  )
}
