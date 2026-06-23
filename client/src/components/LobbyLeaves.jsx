/**
 * LobbyLeaves — ambient botanical decoration for the meeting lobby.
 *
 * Purely decorative: rendered behind the content, translucent, softly
 * blurred and slowly swaying so it reads as a natural watercolour wash
 * (matching the brand template) without ever stealing attention from the
 * preview or the join controls. `pointer-events-none` + low z-index keep it
 * inert; `aria-hidden` keeps it out of the accessibility tree.
 */

const LEAVES = [
  { x: 70, y: 185, rot: -55, scale: 1.20, tone: 'deep' },
  { x: 102, y: 170, rot: 40, scale: 1.05, tone: 'light' },
  { x: 92, y: 140, rot: -66, scale: 1.00, tone: 'light' },
  { x: 130, y: 126, rot: 54, scale: 0.95, tone: 'deep' },
  { x: 118, y: 100, rot: -58, scale: 0.86, tone: 'light' },
  { x: 146, y: 90, rot: 34, scale: 0.80, tone: 'deep' },
  { x: 150, y: 62, rot: 8, scale: 0.78, tone: 'light' },
]

function leafPath(len = 78, w = 26) {
  return `M0 0 C ${w} ${-len * 0.3} ${w * 0.7} ${-len * 0.82} 0 ${-len} ` +
    `C ${-w * 0.7} ${-len * 0.82} ${-w} ${-len * 0.3} 0 0 Z`
}

function Sprig({ id }) {
  const d = leafPath()
  return (
    <svg viewBox="0 0 240 240" fill="none" className="h-full w-full">
      <defs>
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C2EEDA" />
          <stop offset="100%" stopColor="#7FCBA3" />
        </linearGradient>
        <linearGradient id={`${id}-deep`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7FCBA3" />
          <stop offset="100%" stopColor="#3E9E72" />
        </linearGradient>
      </defs>
      {/* stem */}
      <path
        d="M60 232 C 82 172, 122 150, 152 58"
        stroke="#5FB68C"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
      {LEAVES.map((l, i) => (
        <g key={i} transform={`translate(${l.x} ${l.y}) rotate(${l.rot}) scale(${l.scale})`}>
          <path d={d} fill={`url(#${id}-${l.tone})`} />
          <path d="M0 0 L 0 -78" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2" opacity="0.65" />
        </g>
      ))}
    </svg>
  )
}

export default function LobbyLeaves() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {/* top-left sprig — drapes down into the frame */}
      <div
        className="absolute -left-10 -top-8 h-[230px] w-[230px] opacity-50 [filter:blur(0.4px)] sm:h-[270px] sm:w-[270px]"
        style={{ transform: 'rotate(176deg)' }}
      >
        <div className="zk-leaf-sway h-full w-full" style={{ animationDuration: '11s' }}>
          <Sprig id="leaf-tl" />
        </div>
      </div>

      {/* bottom-right branch — the prominent one, sweeping inward */}
      <div
        className="absolute -bottom-12 -right-10 h-[360px] w-[360px] opacity-70 [filter:blur(0.4px)] sm:h-[460px] sm:w-[460px]"
        style={{ transform: 'scaleX(-1)' }}
      >
        <div className="zk-leaf-sway h-full w-full" style={{ animationDuration: '14s', animationDelay: '-3s' }}>
          <Sprig id="leaf-br" />
        </div>
      </div>
    </div>
  )
}
